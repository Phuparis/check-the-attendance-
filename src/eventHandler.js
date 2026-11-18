const msg = require('./messages');
const { verifyDeviceMessage } = require('./beaconToken');
const { bangkokParts, thaiDate } = require('./time');

const CHECKOUT_WORDS = ['เลิกงาน', 'ออกงาน', 'เช็คเอาท์', 'เช็กเอาต์', 'checkout', 'check out'];
const STATUS_WORDS = ['สถานะ', 'วันนี้', 'status'];
const HELP_WORDS = ['ช่วยเหลือ', 'help', 'วิธีใช้'];

/**
 * รับ event จาก LINE (หรือจากหน้าเว็บจำลอง) แล้วตัดสินใจว่าจะบันทึกและตอบอะไร
 *
 * client = ตัวส่งข้อความของ LINE SDK (ตอนเทสต์ใส่ตัวปลอมแทนได้)
 * store  = สมุดลงเวลา (AttendanceStore)
 * sync   = ตัวเขียนลง Google Sheets (ไม่ได้ตั้งค่าก็ใช้ noopSync)
 * onUser = เรียกทุกครั้งที่มีคนแอดเพื่อนหรือทักแชทเข้ามา (ใช้จำผู้รับข้อความของหน้าเว็บจำลอง)
 */
function createEventHandler({ client, store, sync, config, onUser = () => {}, now = () => new Date(), logger = console }) {
  // จำ webhookEventId ที่ทำไปแล้ว กัน LINE ส่ง event เดิมซ้ำ (redelivery)
  const seenEventIds = new Set();
  const MAX_SEEN = 1000;

  function alreadySeen(event) {
    const id = event.webhookEventId;
    if (!id) return false;
    if (seenEventIds.has(id)) return true;
    seenEventIds.add(id);
    if (seenEventIds.size > MAX_SEEN) seenEventIds.delete(seenEventIds.values().next().value);
    return false;
  }

  // ถ้ามี replyToken (event จริงจาก LINE) ตอบกลับฟรี
  // ถ้าไม่มี (event จากหน้าเว็บจำลอง) ส่งแบบ push ซึ่งนับโควตาข้อความ
  async function send(event, messages) {
    if (event.replyToken) {
      await client.replyMessage({ replyToken: event.replyToken, messages });
      return 'reply';
    }
    await client.pushMessage({ to: event.source.userId, messages });
    return 'push';
  }

  const sent = async (event, messages, extra = {}) => ({ status: 'sent', via: await send(event, messages), messages, ...extra });

  async function handleBeacon(event) {
    // LINE ยกเลิก event "leave" ไปแล้ว เหลือ enter, banner, stay
    // เราบันทึกเวลาเข้างานตอนเจอ beacon (enter)
    if (event.beacon?.type !== 'enter') return { status: 'skipped', reason: 'not-enter' };

    const userId = event.source?.userId;
    if (!userId) return { status: 'skipped', reason: 'no-user' };

    // รับเฉพาะ beacon ที่บริษัทลงทะเบียนไว้
    const beacon = config.findBeacon(event.beacon.hwid);
    if (!beacon) return { status: 'skipped', reason: 'unknown-beacon' };

    // ตรวจรหัสหมุนเวียน กันคนก๊อปสัญญาณไปปล่อยจากที่บ้าน
    if (beacon.requireToken) {
      const check = verifyDeviceMessage({
        secret: config.beaconSecret,
        hwid: beacon.hwid,
        dm: event.beacon.dm,
        now: now().getTime(),
      });
      if (!check.ok) {
        logger.warn(`[beacon] รหัสไม่ผ่าน user=${userId} beacon=${beacon.name} เหตุผล=${check.reason}`);
        return sent(event, msg.tokenRejected(), { status: 'rejected', reason: `token-${check.reason}` });
      }
    }

    const employee = store.getEmployee(userId);
    if (!employee) return sent(event, msg.needRegister(), { reason: 'not-registered' });

    const at = now();
    const { date, time, minutes } = bangkokParts(at);
    const late = minutes > config.workStartMinutes;
    const result = store.checkIn(date, userId, { time, branch: beacon.branch, beacon: beacon.name, late });

    if (!result.ok) {
      // เช็คอินไปแล้ววันนี้: ไม่ตอบ จะได้ไม่มีข้อความรัว ๆ ทุกครั้งที่เดินเข้าออกระยะ
      store.touchBeacon(date, userId, time);
      return { status: 'skipped', reason: 'already-checked-in' };
    }

    sync.recordCheckIn({
      at: at.toISOString(),
      date,
      time,
      name: employee.name,
      userId,
      branch: beacon.branch,
      beacon: beacon.name,
      late,
    });
    return sent(event, msg.checkedIn({ name: employee.name, time, branch: beacon.branch, late, workStart: config.workStart }));
  }

  async function handleRegister(event, rawName) {
    const name = rawName.replace(/\s+/g, ' ').trim();
    if (!name) return sent(event, msg.askName());
    if (name.length < 2 || name.length > 60) return sent(event, msg.badName());

    const { employee, isNew } = store.registerEmployee(event.source.userId, name, now());
    sync.recordEmployee(event.source.userId, employee);
    return sent(event, msg.registered(name, isNew));
  }

  async function handleCheckOut(event) {
    const userId = event.source.userId;
    const employee = store.getEmployee(userId);
    if (!employee) return sent(event, msg.notRegistered());

    const at = now();
    const { date, time } = bangkokParts(at);
    const result = store.checkOut(date, userId, { time });
    if (!result.ok) return sent(event, msg.notCheckedIn(), { reason: result.reason });

    sync.recordCheckOut({
      at: at.toISOString(),
      date,
      time,
      name: employee.name,
      userId,
      branch: result.record.branch,
      lastBeaconAt: result.record.lastBeaconAt,
    });
    return sent(event, msg.checkedOut({ name: employee.name, checkIn: result.record.checkIn, time, updated: result.updated }));
  }

  async function handleStatus(event) {
    const userId = event.source.userId;
    const employee = store.getEmployee(userId);
    if (!employee) return sent(event, msg.notRegistered());
    const at = now();
    const record = store.getRecord(bangkokParts(at).date, userId);
    return sent(event, msg.status({ name: employee.name, dateText: thaiDate(at), record }));
  }

  async function handleText(event) {
    const raw = event.message.text.trim();
    const lower = raw.toLowerCase();

    if (lower === 'myid') {
      // คำสั่งสำหรับนักพัฒนา: ดู user ID ของตัวเองโดยไม่ต้องเข้า LINE Developers Console
      return sent(event, [{ type: 'text', text: `User ID ของคุณ:\n${event.source.userId}` }]);
    }
    const register = /^ลงทะเบียน(.*)$/s.exec(raw);
    if (register) return handleRegister(event, register[1]);
    if (CHECKOUT_WORDS.includes(lower)) return handleCheckOut(event);
    if (STATUS_WORDS.includes(lower)) return handleStatus(event);
    if (!store.getEmployee(event.source.userId)) return sent(event, msg.notRegistered());
    // คำว่า "ช่วยเหลือ" และข้อความอื่น ๆ ที่ไม่ใช่คำสั่ง ตอบด้วยวิธีใช้
    return sent(event, msg.help(), { reason: HELP_WORDS.includes(lower) ? 'help' : 'unknown-command' });
  }

  return async function handleEvent(event) {
    if (alreadySeen(event)) return { status: 'skipped', reason: 'duplicate-event' };

    switch (event.type) {
      case 'beacon':
        return handleBeacon(event);
      case 'follow':
        if (event.source?.userId) onUser(event.source.userId);
        return sent(event, msg.welcome(config.companyName));
      case 'message':
        if (event.source?.userId) onUser(event.source.userId);
        if (event.message?.type === 'text') return handleText(event);
        return { status: 'skipped', reason: 'non-text-message' };
      default:
        return { status: 'skipped', reason: `unhandled-${event.type}` };
    }
  };
}

module.exports = { createEventHandler };

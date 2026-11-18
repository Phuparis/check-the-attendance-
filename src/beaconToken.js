const crypto = require('crypto');

/**
 * รหัสหมุนเวียนที่ beacon ปล่อยออกมา (ใส่ในช่อง device message ของ LINE Simple Beacon)
 *
 * ปัญหา: LINE Simple Beacon ปล่อยแค่ HWID ซึ่งใครก็อ่านแล้วปล่อยซ้ำจากที่บ้านได้
 * วิธีแก้: ให้ ESP32 ใส่ "รหัสที่เปลี่ยนทุก 30 วินาที" ลงไปด้วย คล้ายรหัส OTP ของแอปธนาคาร
 * รหัสสร้างจากกุญแจลับ (BEACON_SECRET) ที่มีแค่ beacon กับเซิร์ฟเวอร์ คนก๊อปไปก็ใช้ได้ไม่นาน
 *
 * device message 12 ไบต์ = counter 4 ไบต์ + ลายเซ็น 8 ไบต์
 *   counter   = floor(เวลา Unix / 30 วินาที)
 *   ลายเซ็น   = HMAC-SHA256(secret, HWID 5 ไบต์ + counter 4 ไบต์) ตัดเหลือ 8 ไบต์แรก
 */
const STEP_SECONDS = 30;
// ยอมรับรหัสย้อนหลังได้ 2 รอบ (60 วินาที) เผื่อ LINE ส่ง event ช้าหรือนาฬิกา ESP32 คลาดเล็กน้อย
const ACCEPT_PAST_STEPS = 2;
const ACCEPT_FUTURE_STEPS = 1;

function parseSecret(secret) {
  if (Buffer.isBuffer(secret)) return secret;
  const s = String(secret || '').trim();
  if (!/^[0-9a-fA-F]{32,}$/.test(s) || s.length % 2 !== 0) {
    throw new Error('BEACON_SECRET ต้องเป็นเลขฐานสิบหกอย่างน้อย 32 ตัว (สร้างด้วย npm run secret)');
  }
  return Buffer.from(s, 'hex');
}

function counterAt(ms, step = STEP_SECONDS) {
  return Math.floor(ms / 1000 / step);
}

function signature(secret, hwid, counter) {
  const data = Buffer.alloc(9);
  Buffer.from(hwid, 'hex').copy(data, 0);
  data.writeUInt32BE(counter, 5);
  return crypto.createHmac('sha256', parseSecret(secret)).update(data).digest().subarray(0, 8);
}

/** สร้าง device message (hex 24 ตัว) แบบเดียวกับที่ ESP32 สร้าง ใช้ในหน้าเว็บจำลองและเทสต์ */
function makeDeviceMessage({ secret, hwid, now = Date.now(), step = STEP_SECONDS }) {
  const counter = counterAt(now, step);
  const buf = Buffer.alloc(12);
  buf.writeUInt32BE(counter, 0);
  signature(secret, hwid, counter).copy(buf, 4);
  return buf.toString('hex');
}

/**
 * ตรวจ device message ที่ได้จาก webhook
 * คืน { ok: true, ageSeconds } หรือ { ok: false, reason }
 *   reason: missing | bad-format | bad-signature | expired | future
 */
function verifyDeviceMessage({ secret, hwid, dm, now = Date.now(), step = STEP_SECONDS }) {
  if (!dm) return { ok: false, reason: 'missing' };
  if (!/^[0-9a-fA-F]{24}$/.test(dm)) return { ok: false, reason: 'bad-format' };

  const buf = Buffer.from(dm, 'hex');
  const counter = buf.readUInt32BE(0);
  const expected = signature(secret, hwid.toLowerCase(), counter);
  // เทียบแบบใช้เวลาเท่ากันทุกครั้ง กันการเดารหัสจากเวลาที่ใช้ตรวจ
  if (!crypto.timingSafeEqual(buf.subarray(4), expected)) return { ok: false, reason: 'bad-signature' };

  const current = counterAt(now, step);
  if (counter < current - ACCEPT_PAST_STEPS) return { ok: false, reason: 'expired' };
  if (counter > current + ACCEPT_FUTURE_STEPS) return { ok: false, reason: 'future' };
  return { ok: true, ageSeconds: (current - counter) * step };
}

function generateSecret() {
  return crypto.randomBytes(16).toString('hex');
}

module.exports = {
  STEP_SECONDS,
  parseSecret,
  counterAt,
  makeDeviceMessage,
  verifyDeviceMessage,
  generateSecret,
};

/** ข้อความทั้งหมดที่บอทส่ง รวมไว้ที่เดียว แก้คำได้ง่าย */

const action = (label, text = label) => ({ type: 'action', action: { type: 'message', label, text } });

/** ปุ่มลัดใต้ข้อความ กดแล้วพิมพ์คำสั่งให้เอง ไม่ต้องจำคำสั่ง */
const quick = (...labels) => ({ items: labels.map((l) => action(l)) });

function text(t, quickReply) {
  return quickReply ? { type: 'text', text: t, quickReply } : { type: 'text', text: t };
}

function formatDuration(fromHHMM, toHHMM) {
  const toMin = (s) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3, 5));
  const diff = toMin(toHHMM) - toMin(fromHHMM);
  if (diff < 0) return null;
  const h = Math.floor(diff / 60);
  const m = diff % 60;
  return h ? `${h} ชม. ${m} นาที` : `${m} นาที`;
}

const SETUP_STEPS =
  'ให้ระบบเช็คชื่ออัตโนมัติได้ 2 ขั้น:\n' +
  '1. เปิด Bluetooth ในมือถือไว้\n' +
  '2. ใน LINE ไปที่ ตั้งค่า > ความเป็นส่วนตัว > เปิด "LINE Beacon"';

module.exports = {
  welcome: (company) => [
    text(
      `สวัสดีครับ นี่คือระบบลงเวลาของ ${company} 👋\n\n` +
        'ลงทะเบียนครั้งแรกโดยพิมพ์\nลงทะเบียน ชื่อ นามสกุล\n\nเช่น: ลงทะเบียน สมชาย ใจดี'
    ),
    text(SETUP_STEPS),
  ],

  askName: () => [text('พิมพ์ชื่อต่อท้ายคำว่าลงทะเบียนด้วยครับ\nเช่น: ลงทะเบียน สมชาย ใจดี')],

  badName: () => [text('ชื่อต้องยาว 2-60 ตัวอักษรครับ ลองใหม่อีกครั้ง\nเช่น: ลงทะเบียน สมชาย ใจดี')],

  registered: (name, isNew) => [
    text(isNew ? `ลงทะเบียนเรียบร้อย ✅\nชื่อ: ${name}` : `เปลี่ยนชื่อเป็น "${name}" แล้วครับ ✅`),
    ...(isNew ? [text(`${SETUP_STEPS}\n\nพรุ่งนี้เดินเข้าออฟฟิศ ระบบจะเช็คชื่อให้เองครับ`, quick('สถานะ', 'ช่วยเหลือ'))] : []),
  ],

  notRegistered: () => [text('ยังไม่ได้ลงทะเบียนครับ พิมพ์\nลงทะเบียน ชื่อ นามสกุล\n\nเช่น: ลงทะเบียน สมชาย ใจดี')],

  needRegister: () => [text('เจอสัญญาณ beacon แล้ว แต่ยังไม่ได้ลงทะเบียนครับ\nพิมพ์: ลงทะเบียน ชื่อ นามสกุล')],

  checkedIn: ({ name, time, branch, late, workStart }) => [
    text(
      `✅ เช็คอินแล้ว ${time} น.\n${name} · ${branch}` + (late ? `\n\n⏰ เลยเวลาเข้างาน (${workStart} น.)` : '\n\nขอให้เป็นวันที่ดีครับ'),
      quick('เลิกงาน', 'สถานะ')
    ),
  ],

  checkedOut: ({ name, checkIn, time, updated }) => {
    const duration = formatDuration(checkIn, time);
    return [
      text(
        `${updated ? 'อัปเดตเวลาเลิกงานเป็น' : '👋 บันทึกเลิกงานแล้ว'} ${time} น.\n${name}\n` +
          `เข้า ${checkIn} - ออก ${time}` +
          (duration ? ` (${duration})` : '') +
          '\n\nเดินทางกลับปลอดภัยครับ'
      ),
    ];
  },

  notCheckedIn: () => [
    text('วันนี้ยังไม่มีเวลาเข้างานครับ เลยบันทึกเลิกงานไม่ได้\n\nถ้าอยู่ที่ออฟฟิศแล้วแต่ระบบไม่เช็คชื่อ ลองเช็ก Bluetooth และ LINE Beacon แล้วเดินออกไปนอกระยะแล้วเข้ามาใหม่', quick('ช่วยเหลือ')),
  ],

  status: ({ name, dateText, record }) => {
    if (!record) return [text(`${name}\n${dateText}\n\nยังไม่ได้เช็คอินวันนี้`, quick('ช่วยเหลือ'))];
    const lines = [
      `${name}`,
      dateText,
      '',
      `เข้างาน: ${record.checkIn} น.${record.late ? ' (สาย)' : ''}`,
      `เลิกงาน: ${record.checkOut ? `${record.checkOut} น.` : '-'}`,
      `สาขา: ${record.branch}`,
    ];
    return [text(lines.join('\n'), record.checkOut ? undefined : quick('เลิกงาน'))];
  },

  tokenRejected: () => [
    text('ตรวจสอบสัญญาณ beacon ไม่ผ่านครับ ระบบยังไม่ได้บันทึกเวลา\nลองเดินออกนอกระยะแล้วเข้ามาใหม่ ถ้ายังไม่ได้ให้แจ้ง HR'),
  ],

  help: () => [
    text(
      'คำสั่งที่ใช้ได้\n\n' +
        '• ลงทะเบียน ชื่อ นามสกุล\n' +
        '• สถานะ - ดูเวลาเข้า-ออกวันนี้\n' +
        '• เลิกงาน - บันทึกเวลาออก\n\n' +
        'เวลาเข้างานระบบบันทึกให้เองเมื่อเดินเข้าระยะ beacon\n\n' +
        SETUP_STEPS,
      quick('สถานะ', 'เลิกงาน')
    ),
  ],

  formatDuration,
};

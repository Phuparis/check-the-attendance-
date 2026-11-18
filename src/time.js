/** วันที่และเวลาตามเวลาประเทศไทย ไม่ว่าเซิร์ฟเวอร์จะตั้งเขตเวลาไว้ที่ไหน (Render ใช้ UTC) */
const TIME_ZONE = 'Asia/Bangkok';

function bangkokParts(date) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: TIME_ZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    })
      .formatToParts(date)
      .map((p) => [p.type, p.value])
  );
  const hour = parts.hour === '24' ? '00' : parts.hour;
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`, // 2026-11-18
    time: `${hour}:${parts.minute}`, // 08:52
    minutes: Number(hour) * 60 + Number(parts.minute),
  };
}

/** "09:00" -> 540 */
function parseHHMM(text) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(text || '').trim());
  if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) throw new Error(`เวลา "${text}" ต้องอยู่ในรูป HH:MM เช่น 09:00`);
  return Number(m[1]) * 60 + Number(m[2]);
}

/** วันที่แบบไทยสั้น ๆ เช่น 18 พ.ย. 2569 */
function thaiDate(date) {
  return new Intl.DateTimeFormat('th-TH', { timeZone: TIME_ZONE, dateStyle: 'medium' }).format(date);
}

module.exports = { TIME_ZONE, bangkokParts, parseHHMM, thaiDate };

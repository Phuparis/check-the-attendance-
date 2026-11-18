#!/usr/bin/env node
/** สร้าง BEACON_SECRET ใหม่ ใส่ค่าเดียวกันทั้งใน Render และใน secrets.h ของ ESP32 */
const { generateSecret } = require('../src/beaconToken');

console.log(`
BEACON_SECRET ใหม่ (เก็บเป็นความลับ ห้ามส่งในแชทหรือ commit ขึ้น GitHub)

${generateSecret()}

ใส่ค่านี้ 2 ที่:
  1. Render > Environment > BEACON_SECRET
  2. esp32/attendance_beacon/secrets.h > BEACON_SECRET
`);

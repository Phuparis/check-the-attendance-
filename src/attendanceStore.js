const fs = require('fs');
const path = require('path');

/**
 * สมุดลงเวลา: เก็บรายชื่อพนักงาน และเวลาเข้า-ออกของแต่ละวัน
 *
 * โครงสร้างข้อมูล
 *   employees: { [userId]: { name, registeredAt } }
 *   days:      { 'YYYY-MM-DD': { [userId]: { checkIn, checkOut, branch, beacon, lastBeaconAt, late } } }
 *
 * เก็บลงไฟล์ JSON (ถ้า filePath เป็น null เก็บในหน่วยความจำอย่างเดียว ใช้ตอนเทสต์)
 * Render แบบฟรีลบไฟล์ทุกครั้งที่รีสตาร์ต ข้อมูลจริงจึงเขียนลง Google Sheets ด้วย (ดู sheetsSync.js)
 * แล้วโหลดกลับมาตอนเริ่มรัน
 */
class AttendanceStore {
  constructor(filePath = null) {
    this.filePath = filePath;
    this.data = { employees: {}, days: {}, demoUserId: null };
    if (filePath && fs.existsSync(filePath)) {
      this.data = { ...this.data, ...JSON.parse(fs.readFileSync(filePath, 'utf8')) };
    }
  }

  getEmployee(userId) {
    return this.data.employees[userId] || null;
  }

  listEmployees() {
    return Object.entries(this.data.employees).map(([userId, e]) => ({ userId, ...e }));
  }

  /** ลงทะเบียนหรือเปลี่ยนชื่อ คืนค่า { employee, isNew } */
  registerEmployee(userId, name, now = new Date()) {
    const existing = this.data.employees[userId];
    const employee = { name, registeredAt: existing?.registeredAt || now.toISOString() };
    this.data.employees[userId] = employee;
    this.save();
    return { employee, isNew: !existing };
  }

  getRecord(date, userId) {
    return this.data.days[date]?.[userId] || null;
  }

  getDay(date) {
    return this.data.days[date] || {};
  }

  /** จดว่าเห็น beacon ล่าสุดเมื่อไหร่ (ใช้ประกอบเวลาเลิกงาน ให้ HR ตรวจย้อนหลังได้) */
  touchBeacon(date, userId, time) {
    const record = this.getRecord(date, userId);
    if (!record) return;
    record.lastBeaconAt = time;
    this.save();
  }

  /**
   * บันทึกเข้างาน ครั้งแรกของวันเท่านั้น
   * จดก่อนส่งข้อความ เพื่อกัน event ที่มาติดกันในเสี้ยววินาทีบันทึกซ้ำ
   */
  checkIn(date, userId, { time, branch, beacon, late }) {
    const day = (this.data.days[date] ||= {});
    if (day[userId]?.checkIn) return { ok: false, record: day[userId] };
    day[userId] = { checkIn: time, checkOut: null, branch, beacon, lastBeaconAt: time, late: Boolean(late) };
    this.save();
    return { ok: true, record: day[userId] };
  }

  /** บันทึกเลิกงาน กดซ้ำได้ ใช้เวลาล่าสุด */
  checkOut(date, userId, { time }) {
    const record = this.getRecord(date, userId);
    if (!record?.checkIn) return { ok: false, reason: 'not-checked-in' };
    const updated = Boolean(record.checkOut);
    record.checkOut = time;
    this.save();
    return { ok: true, updated, record };
  }

  /** โหลดข้อมูลที่อ่านมาจาก Google Sheets ทับลงไป (ตอนเริ่มรัน) */
  hydrate({ employees = {}, days = {} }) {
    Object.assign(this.data.employees, employees);
    for (const [date, records] of Object.entries(days)) {
      this.data.days[date] = { ...(this.data.days[date] || {}), ...records };
    }
    this.save();
  }

  /** ผู้รับข้อความของหน้าเว็บจำลอง (คนล่าสุดที่แอดเพื่อนหรือทักแชท) */
  setDemoUser(userId) {
    if (this.data.demoUserId === userId) return;
    this.data.demoUserId = userId;
    this.save();
  }

  getDemoUser() {
    return this.data.demoUserId || null;
  }

  /** ล้างการลงเวลาของวันนั้น (ใช้ในหน้าเว็บจำลองเท่านั้น) */
  resetDay(date, userId) {
    if (this.data.days[date]) delete this.data.days[date][userId];
    this.save();
  }

  save() {
    if (!this.filePath) return;
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    fs.writeFileSync(this.filePath, JSON.stringify(this.data, null, 2));
  }
}

module.exports = { AttendanceStore };

/**
 * เขียนการลงเวลาลง Google Sheets ให้ HR เปิดดูได้ และโหลดกลับมาตอนเซิร์ฟเวอร์รีสตาร์ต
 *
 * แท็บ "พนักงาน"    : 1 แถวต่อ 1 คน (เปลี่ยนชื่อแล้วแก้แถวเดิม)
 * แท็บ "บันทึกเวลา" : 1 แถวต่อ 1 เหตุการณ์ (เข้างาน / เลิกงาน) เพิ่มต่อท้ายเรื่อย ๆ ไม่แก้ของเก่า
 *                     ทำ pivot หรือสรุปรายเดือนในชีตได้เลย
 */
const EMPLOYEE_SHEET = 'พนักงาน';
const LOG_SHEET = 'บันทึกเวลา';
const EMPLOYEE_HEADER = ['LINE user ID', 'ชื่อ', 'ลงทะเบียนเมื่อ'];
const LOG_HEADER = ['บันทึกเมื่อ', 'วันที่', 'เวลา', 'ประเภท', 'ชื่อ', 'LINE user ID', 'สาขา', 'beacon', 'สาย', 'หมายเหตุ'];
const TYPE_IN = 'เข้างาน';
const TYPE_OUT = 'เลิกงาน';

function createSheetsSync({ sheets, logger = console }) {
  const employeeRows = new Map(); // userId -> เลขแถวในแท็บพนักงาน
  let queue = Promise.resolve();

  // เขียนทีละคำสั่งตามลำดับ และไม่ให้ Google ช้าหรือล่มแล้วทำให้บอทตอบช้าตาม
  function enqueue(label, task) {
    queue = queue.then(task).catch((err) => logger.error(`[sheets] ${label} ไม่สำเร็จ:`, err.message));
    return queue;
  }

  /** สร้างแท็บและหัวตารางถ้ายังไม่มี */
  async function setup() {
    const titles = await sheets.listSheetTitles();
    for (const [title, header] of [
      [EMPLOYEE_SHEET, EMPLOYEE_HEADER],
      [LOG_SHEET, LOG_HEADER],
    ]) {
      if (!titles.includes(title)) await sheets.addSheet(title);
      const first = await sheets.getValues(title, 'A1:J1');
      if (!first.length) await sheets.updateValues(title, 'A1', [header]);
    }
  }

  /** อ่านรายชื่อพนักงาน และการลงเวลาของวันนี้ กลับมาเป็นข้อมูลแบบเดียวกับ AttendanceStore */
  async function load(today) {
    const employees = {};
    const empRows = await sheets.getValues(EMPLOYEE_SHEET, 'A2:C');
    empRows.forEach(([userId, name, registeredAt], i) => {
      if (!userId) return;
      employees[userId] = { name, registeredAt };
      employeeRows.set(userId, i + 2);
    });

    const records = {};
    const logRows = await sheets.getValues(LOG_SHEET, 'A2:J');
    for (const [, date, time, type, , userId, branch, beacon, late] of logRows) {
      if (date !== today || !userId) continue;
      if (type === TYPE_IN && !records[userId]) {
        records[userId] = { checkIn: time, checkOut: null, branch, beacon, lastBeaconAt: time, late: late === 'สาย' };
      } else if (type === TYPE_OUT && records[userId]) {
        records[userId].checkOut = time;
      }
    }
    return { employees, days: { [today]: records } };
  }

  return {
    setup,
    load,
    flush: () => queue,

    recordEmployee(userId, { name, registeredAt }) {
      return enqueue('บันทึกพนักงาน', async () => {
        const row = [userId, name, registeredAt];
        const existing = employeeRows.get(userId);
        if (existing) {
          await sheets.updateValues(EMPLOYEE_SHEET, `A${existing}:C${existing}`, [row]);
        } else {
          const added = await sheets.appendRows(EMPLOYEE_SHEET, [row]);
          if (added) employeeRows.set(userId, added);
        }
      });
    },

    recordCheckIn({ at, date, time, name, userId, branch, beacon, late }) {
      return enqueue('บันทึกเข้างาน', () =>
        sheets.appendRows(LOG_SHEET, [[at, date, time, TYPE_IN, name, userId, branch, beacon, late ? 'สาย' : '', '']])
      );
    },

    recordCheckOut({ at, date, time, name, userId, branch, lastBeaconAt }) {
      const note = lastBeaconAt ? `เห็น beacon ล่าสุด ${lastBeaconAt}` : '';
      return enqueue('บันทึกเลิกงาน', () =>
        sheets.appendRows(LOG_SHEET, [[at, date, time, TYPE_OUT, name, userId, branch, '', '', note]])
      );
    },
  };
}

/** ใช้ตอนไม่ได้ตั้งค่า Google Sheets: ไม่ทำอะไร */
const noopSync = {
  setup: async () => {},
  load: async () => ({ employees: {}, days: {} }),
  flush: async () => {},
  recordEmployee: async () => {},
  recordCheckIn: async () => {},
  recordCheckOut: async () => {},
};

module.exports = { createSheetsSync, noopSync, EMPLOYEE_SHEET, LOG_SHEET, LOG_HEADER, EMPLOYEE_HEADER };

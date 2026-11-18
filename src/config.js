const fs = require('fs');
const path = require('path');
const { parseSecret } = require('./beaconToken');
const { parseHHMM } = require('./time');

const ROOT = path.join(__dirname, '..');

/**
 * รายชื่อ beacon ของบริษัท (config/beacons.json)
 *   hwid          Hardware ID 10 ตัวที่ได้จาก LINE
 *   name          ชื่อจุดติดตั้ง เช่น "ประตูหน้า"
 *   branch        สาขา
 *   requireToken  true = ต้องมีรหัสหมุนเวียนจาก ESP32 ถึงเช็คอินได้ (ค่าเริ่มต้น)
 *                 false = รับแค่ HWID ใช้ตอนทดสอบด้วยแอป nRF Connect เท่านั้น เพราะปลอมได้
 */
function loadBeacons(file = path.join(ROOT, 'config', 'beacons.json')) {
  const list = JSON.parse(fs.readFileSync(file, 'utf8'));
  return list.map((b) => {
    if (!/^[0-9a-fA-F]{10}$/.test(b.hwid)) throw new Error(`hwid "${b.hwid}" ต้องเป็นเลขฐานสิบหก 10 ตัว`);
    return { ...b, hwid: b.hwid.toLowerCase(), requireToken: b.requireToken !== false };
  });
}

function parseServiceAccount(raw) {
  if (!raw) return null;
  const text = raw.trim().startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf8');
  try {
    return JSON.parse(text);
  } catch {
    throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON อ่านไม่ออก ให้วางเนื้อหาไฟล์ JSON ทั้งไฟล์');
  }
}

function loadConfig(env = process.env, { beacons = loadBeacons() } = {}) {
  const beaconSecret = env.BEACON_SECRET ? parseSecret(env.BEACON_SECRET) : null;
  if (!beaconSecret && beacons.some((b) => b.requireToken)) {
    throw new Error('มี beacon ที่ต้องใช้รหัสหมุนเวียน แต่ยังไม่ได้ใส่ BEACON_SECRET (สร้างด้วย npm run secret)');
  }

  const workStart = env.WORK_START || '09:00';
  return {
    port: Number(env.PORT || 3000),
    channelId: env.LINE_CHANNEL_ID || '',
    channelSecret: env.LINE_CHANNEL_SECRET || '',
    channelAccessToken: env.LINE_CHANNEL_ACCESS_TOKEN || '',
    // URL สาธารณะของเซิร์ฟเวอร์ Render ใส่ RENDER_EXTERNAL_URL ให้อัตโนมัติ
    publicUrl: (env.PUBLIC_URL || env.RENDER_EXTERNAL_URL || '').replace(/\/$/, ''),
    autoSetWebhook: env.AUTO_SET_WEBHOOK !== 'false',
    demoUserId: env.LINE_DEMO_USER_ID || '',
    companyName: env.COMPANY_NAME || 'บริษัทของเรา',
    workStart,
    workStartMinutes: parseHHMM(workStart),
    beaconSecret,
    simulatorEnabled: env.SIMULATOR_ENABLED === 'true',
    spreadsheetId: env.GOOGLE_SHEET_ID || '',
    serviceAccount: parseServiceAccount(env.GOOGLE_SERVICE_ACCOUNT_JSON),
    dataFile: path.join(ROOT, 'data', 'attendance.json'),
    beacons,
    findBeacon: (hwid) => beacons.find((b) => b.hwid === String(hwid || '').toLowerCase()),
  };
}

module.exports = { loadConfig, loadBeacons, parseServiceAccount };

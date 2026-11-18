const test = require('node:test');
const assert = require('node:assert');
const { makeDeviceMessage, verifyDeviceMessage, counterAt, parseSecret } = require('../src/beaconToken');

const secret = '00112233445566778899aabbccddeeff';
const hwid = '0123456789';
const t0 = Date.parse('2026-11-18T01:52:10Z');

test('รหัสที่เพิ่งสร้างตรวจผ่าน', () => {
  const dm = makeDeviceMessage({ secret, hwid, now: t0 });
  assert.match(dm, /^[0-9a-f]{24}$/);
  assert.deepStrictEqual(verifyDeviceMessage({ secret, hwid, dm, now: t0 }), { ok: true, ageSeconds: 0 });
});

test('ตรงกับค่าที่คำนวณด้วยมือ (ใช้เทียบกับ ESP32)', () => {
  // counter = floor(t0 / 30s) เขียนเป็น 4 ไบต์แรก
  const dm = makeDeviceMessage({ secret, hwid, now: t0 });
  assert.strictEqual(parseInt(dm.slice(0, 8), 16), counterAt(t0));
  const crypto = require('crypto');
  const data = Buffer.concat([Buffer.from(hwid, 'hex'), Buffer.from(dm.slice(0, 8), 'hex')]);
  const mac = crypto.createHmac('sha256', Buffer.from(secret, 'hex')).update(data).digest('hex').slice(0, 16);
  assert.strictEqual(dm.slice(8), mac);
});

test('LINE ส่ง event ช้า 50 วินาที ยังผ่าน', () => {
  const dm = makeDeviceMessage({ secret, hwid, now: t0 });
  assert.strictEqual(verifyDeviceMessage({ secret, hwid, dm, now: t0 + 50_000 }).ok, true);
});

test('สัญญาณที่ก๊อปไว้ 5 นาทีก่อน ใช้ไม่ได้', () => {
  const dm = makeDeviceMessage({ secret, hwid, now: t0 - 5 * 60_000 });
  assert.deepStrictEqual(verifyDeviceMessage({ secret, hwid, dm, now: t0 }), { ok: false, reason: 'expired' });
});

test('รหัสจากอนาคตไกล ๆ ใช้ไม่ได้', () => {
  const dm = makeDeviceMessage({ secret, hwid, now: t0 + 10 * 60_000 });
  assert.strictEqual(verifyDeviceMessage({ secret, hwid, dm, now: t0 }).reason, 'future');
});

test('รหัสของ beacon อื่น หรือกุญแจอื่น ใช้ไม่ได้', () => {
  const other = makeDeviceMessage({ secret, hwid: 'abcdef0123', now: t0 });
  assert.strictEqual(verifyDeviceMessage({ secret, hwid, dm: other, now: t0 }).reason, 'bad-signature');
  const wrongKey = makeDeviceMessage({ secret: 'ff'.repeat(16), hwid, now: t0 });
  assert.strictEqual(verifyDeviceMessage({ secret, hwid, dm: wrongKey, now: t0 }).reason, 'bad-signature');
});

test('แก้ counter เองเพื่อต่ออายุรหัส ไม่ผ่าน', () => {
  const dm = makeDeviceMessage({ secret, hwid, now: t0 - 5 * 60_000 });
  const fresh = counterAt(t0).toString(16).padStart(8, '0');
  assert.strictEqual(verifyDeviceMessage({ secret, hwid, dm: fresh + dm.slice(8), now: t0 }).reason, 'bad-signature');
});

test('ไม่มีรหัส หรือรูปแบบผิด', () => {
  assert.strictEqual(verifyDeviceMessage({ secret, hwid, dm: undefined }).reason, 'missing');
  assert.strictEqual(verifyDeviceMessage({ secret, hwid, dm: '00' }).reason, 'bad-format');
});

test('กุญแจสั้นหรือไม่ใช่ฐานสิบหก แจ้ง error', () => {
  assert.throws(() => parseSecret('abc'), /BEACON_SECRET/);
  assert.throws(() => parseSecret('z'.repeat(32)), /BEACON_SECRET/);
});

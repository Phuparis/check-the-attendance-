const test = require('node:test');
const assert = require('node:assert');
const { createEventHandler } = require('../src/eventHandler');
const { AttendanceStore } = require('../src/attendanceStore');
const { buildSimulatedBeaconEvent } = require('../src/simulator');
const { makeDeviceMessage, parseSecret } = require('../src/beaconToken');

const MIN = 60 * 1000;
const secret = parseSecret('00112233445566778899aabbccddeeff');
const beacons = [
  { hwid: '0123456789', name: 'ประตูหน้า', branch: 'สำนักงานใหญ่', requireToken: true },
  { hwid: 'abcdef0123', name: 'ทดสอบ', branch: 'สาขา 2', requireToken: false },
];

function setup({ start = '2026-11-18T01:52:00Z' } = {}) {
  const sent = [];
  const synced = [];
  const client = {
    replyMessage: async (req) => sent.push({ via: 'reply', ...req }),
    pushMessage: async (req) => sent.push({ via: 'push', ...req }),
  };
  const sync = {
    recordEmployee: (userId, e) => synced.push({ kind: 'employee', userId, ...e }),
    recordCheckIn: (r) => synced.push({ kind: 'in', ...r }),
    recordCheckOut: (r) => synced.push({ kind: 'out', ...r }),
  };
  let clock = new Date(start); // 08:52 เวลาไทย
  const config = {
    companyName: 'ACME',
    workStart: '09:00',
    workStartMinutes: 540,
    beaconSecret: secret,
    findBeacon: (hwid) => beacons.find((b) => b.hwid === hwid),
  };
  const store = new AttendanceStore(null);
  const logger = { warn: () => {}, error: () => {}, log: () => {} };
  const handle = createEventHandler({ client, store, sync, config, now: () => clock, logger });
  return {
    handle,
    sent,
    synced,
    store,
    now: () => clock,
    advance: (ms) => (clock = new Date(clock.getTime() + ms)),
  };
}

const say = (text, userId = 'U1') => ({
  type: 'message',
  replyToken: 'r-' + Math.random(),
  webhookEventId: 'evt-' + Math.random(),
  source: { type: 'user', userId },
  message: { type: 'text', text },
});

const enter = (ctx, { hwid = '0123456789', userId = 'U1', dm } = {}) => ({
  type: 'beacon',
  replyToken: 'r-' + Math.random(),
  webhookEventId: 'evt-' + Math.random(),
  source: { type: 'user', userId },
  beacon: {
    hwid,
    type: 'enter',
    dm: dm === undefined ? makeDeviceMessage({ secret, hwid, now: ctx.now().getTime() }) : dm,
  },
});

async function registered(opts) {
  const ctx = setup(opts);
  await ctx.handle(say('ลงทะเบียน   สมชาย   ใจดี'));
  ctx.sent.length = 0;
  ctx.synced.length = 0;
  return ctx;
}

test('แอดเพื่อนแล้วได้วิธีลงทะเบียน', async () => {
  const ctx = setup();
  const r = await ctx.handle({ type: 'follow', replyToken: 'x', source: { type: 'user', userId: 'U1' } });
  assert.strictEqual(r.status, 'sent');
  assert.match(ctx.sent[0].messages[0].text, /ลงทะเบียน ชื่อ นามสกุล/);
});

test('ลงทะเบียน: ตัดช่องว่างเกิน และบันทึกลงชีต', async () => {
  const ctx = setup();
  await ctx.handle(say('ลงทะเบียน   สมชาย   ใจดี'));
  assert.strictEqual(ctx.store.getEmployee('U1').name, 'สมชาย ใจดี');
  assert.match(ctx.sent[0].messages[0].text, /ลงทะเบียนเรียบร้อย/);
  assert.strictEqual(ctx.synced[0].kind, 'employee');
});

test('ลงทะเบียนโดยไม่ใส่ชื่อ ระบบถามชื่อ', async () => {
  const ctx = setup();
  await ctx.handle(say('ลงทะเบียน'));
  assert.strictEqual(ctx.store.getEmployee('U1'), null);
  assert.match(ctx.sent[0].messages[0].text, /พิมพ์ชื่อต่อท้าย/);
});

test('ลงทะเบียนซ้ำ = เปลี่ยนชื่อ', async () => {
  const ctx = await registered();
  await ctx.handle(say('ลงทะเบียน สมชาย ดีมาก'));
  assert.strictEqual(ctx.store.getEmployee('U1').name, 'สมชาย ดีมาก');
  assert.match(ctx.sent[0].messages[0].text, /เปลี่ยนชื่อ/);
});

test('เดินเข้าระยะ beacon: เช็คอินและตอบแบบ reply', async () => {
  const ctx = await registered();
  const r = await ctx.handle(enter(ctx));
  assert.strictEqual(r.status, 'sent');
  assert.strictEqual(ctx.sent[0].via, 'reply');
  assert.match(ctx.sent[0].messages[0].text, /เช็คอินแล้ว 08:52/);
  assert.doesNotMatch(ctx.sent[0].messages[0].text, /เลยเวลา/);
  assert.deepStrictEqual(
    ctx.sent[0].messages[0].quickReply.items.map((i) => i.action.text),
    ['เลิกงาน', 'สถานะ']
  );
  assert.strictEqual(ctx.synced[0].kind, 'in');
  assert.strictEqual(ctx.synced[0].date, '2026-11-18');
  assert.strictEqual(ctx.synced[0].late, false);
});

test('เข้าหลัง 09:00 ถือว่าสาย', async () => {
  const ctx = await registered({ start: '2026-11-18T02:15:00Z' }); // 09:15
  await ctx.handle(enter(ctx));
  assert.match(ctx.sent[0].messages[0].text, /เลยเวลาเข้างาน/);
  assert.strictEqual(ctx.store.getRecord('2026-11-18', 'U1').late, true);
});

test('เดินเข้าระยะซ้ำวันเดียวกัน ไม่ส่งข้อความรัว แต่จดเวลาที่เห็นล่าสุด', async () => {
  const ctx = await registered();
  await ctx.handle(enter(ctx));
  ctx.advance(3 * 60 * MIN);
  const r = await ctx.handle(enter(ctx));
  assert.strictEqual(r.reason, 'already-checked-in');
  assert.strictEqual(ctx.sent.length, 1);
  assert.strictEqual(ctx.store.getRecord('2026-11-18', 'U1').lastBeaconAt, '11:52');
  assert.strictEqual(ctx.synced.filter((s) => s.kind === 'in').length, 1);
});

test('วันใหม่เช็คอินได้อีก', async () => {
  const ctx = await registered();
  await ctx.handle(enter(ctx));
  ctx.advance(24 * 60 * MIN);
  const r = await ctx.handle(enter(ctx));
  assert.strictEqual(r.status, 'sent');
  assert.strictEqual(ctx.synced[1].date, '2026-11-19');
});

test('ยังไม่ลงทะเบียนแต่เจอ beacon: บอกให้ลงทะเบียน ไม่บันทึกเวลา', async () => {
  const ctx = setup();
  const r = await ctx.handle(enter(ctx));
  assert.strictEqual(r.reason, 'not-registered');
  assert.match(ctx.sent[0].messages[0].text, /ยังไม่ได้ลงทะเบียน/);
  assert.strictEqual(ctx.synced.length, 0);
});

test('กันโกง: สัญญาณที่ก๊อปไว้ 5 นาทีก่อน ถูกปฏิเสธ', async () => {
  const ctx = await registered();
  const old = makeDeviceMessage({ secret, hwid: '0123456789', now: ctx.now().getTime() - 5 * MIN });
  const r = await ctx.handle(enter(ctx, { dm: old }));
  assert.strictEqual(r.status, 'rejected');
  assert.strictEqual(r.reason, 'token-expired');
  assert.strictEqual(ctx.store.getRecord('2026-11-18', 'U1'), null);
  assert.match(ctx.sent[0].messages[0].text, /ไม่ผ่าน/);
});

test('กันโกง: ปล่อยแค่ HWID ไม่มีรหัส ถูกปฏิเสธ', async () => {
  const ctx = await registered();
  const r = await ctx.handle(enter(ctx, { dm: '00' }));
  assert.strictEqual(r.reason, 'token-bad-format');
  assert.strictEqual(ctx.store.getRecord('2026-11-18', 'U1'), null);
});

test('beacon โหมดทดสอบ (requireToken: false) รับแค่ HWID', async () => {
  const ctx = await registered();
  const r = await ctx.handle(enter(ctx, { hwid: 'abcdef0123', dm: '00' }));
  assert.strictEqual(r.status, 'sent');
  assert.strictEqual(ctx.store.getRecord('2026-11-18', 'U1').branch, 'สาขา 2');
});

test('beacon ที่ไม่ได้ลงทะเบียน ไม่ตอบ', async () => {
  const ctx = await registered();
  const r = await ctx.handle(enter(ctx, { hwid: 'ffffffffff' }));
  assert.strictEqual(r.reason, 'unknown-beacon');
  assert.strictEqual(ctx.sent.length, 0);
});

test('ตอบเฉพาะ enter', async () => {
  const ctx = await registered();
  const e = enter(ctx);
  e.beacon.type = 'banner';
  assert.strictEqual((await ctx.handle(e)).reason, 'not-enter');
});

test('เลิกงาน: บันทึกเวลาออกและชั่วโมงทำงาน', async () => {
  const ctx = await registered();
  await ctx.handle(enter(ctx));
  ctx.advance(9 * 60 * MIN + 8 * MIN); // 18:00
  await ctx.handle(say('เลิกงาน'));
  const text = ctx.sent[1].messages[0].text;
  assert.match(text, /บันทึกเลิกงานแล้ว 18:00/);
  assert.match(text, /9 ชม. 8 นาที/);
  const out = ctx.synced.find((s) => s.kind === 'out');
  assert.strictEqual(out.time, '18:00');
  assert.strictEqual(out.lastBeaconAt, '08:52');
});

test('กดเลิกงานซ้ำ ใช้เวลาล่าสุด', async () => {
  const ctx = await registered();
  await ctx.handle(enter(ctx));
  ctx.advance(8 * 60 * MIN);
  await ctx.handle(say('เลิกงาน'));
  ctx.advance(30 * MIN);
  await ctx.handle(say('เลิกงาน'));
  assert.match(ctx.sent[2].messages[0].text, /อัปเดตเวลาเลิกงานเป็น 17:22/);
  assert.strictEqual(ctx.store.getRecord('2026-11-18', 'U1').checkOut, '17:22');
});

test('เลิกงานโดยยังไม่เช็คอิน: ไม่บันทึก', async () => {
  const ctx = await registered();
  const r = await ctx.handle(say('เลิกงาน'));
  assert.strictEqual(r.reason, 'not-checked-in');
  assert.strictEqual(ctx.synced.length, 0);
});

test('สถานะ: ก่อนและหลังเช็คอิน', async () => {
  const ctx = await registered();
  await ctx.handle(say('สถานะ'));
  assert.match(ctx.sent[0].messages[0].text, /ยังไม่ได้เช็คอินวันนี้/);
  await ctx.handle(enter(ctx));
  await ctx.handle(say('สถานะ'));
  assert.match(ctx.sent[2].messages[0].text, /เข้างาน: 08:52/);
  assert.match(ctx.sent[2].messages[0].text, /เลิกงาน: -/);
});

test('ข้อความอื่นตอบวิธีใช้ / ยังไม่ลงทะเบียนให้ลงทะเบียน', async () => {
  const ctx = setup();
  await ctx.handle(say('สวัสดี'));
  assert.match(ctx.sent[0].messages[0].text, /ยังไม่ได้ลงทะเบียน/);
  await ctx.handle(say('ลงทะเบียน สมชาย ใจดี'));
  await ctx.handle(say('ช่วยเหลือ'));
  assert.match(ctx.sent[2].messages[0].text, /คำสั่งที่ใช้ได้/);
});

test('คำสั่ง myid ตอบ user ID', async () => {
  const ctx = setup();
  await ctx.handle(say('MyID'));
  assert.match(ctx.sent[0].messages[0].text, /U1/);
});

test('LINE ส่ง event เดิมซ้ำ ไม่ทำซ้ำ', async () => {
  const ctx = await registered();
  const e = enter(ctx);
  await ctx.handle(e);
  const r = await ctx.handle(e);
  assert.strictEqual(r.reason, 'duplicate-event');
});

test('หน้าเว็บจำลอง: สัญญาณจริงผ่าน (ส่งแบบ push) ก๊อปและปลอมไม่ผ่าน', async () => {
  const ctx = await registered();
  const ev = (signal) => buildSimulatedBeaconEvent({ hwid: '0123456789', userId: 'U1', secret, signal, now: ctx.now() });
  assert.strictEqual((await ctx.handle(ev('copied'))).reason, 'token-expired');
  assert.strictEqual((await ctx.handle(ev('fake'))).reason, 'token-bad-format');
  const r = await ctx.handle(ev('real'));
  assert.strictEqual(r.status, 'sent');
  assert.strictEqual(r.via, 'push');
});

const test = require('node:test');
const assert = require('node:assert');
const { bangkokParts, parseHHMM } = require('../src/time');

test('แปลงเวลา UTC เป็นวันที่และเวลาไทย', () => {
  assert.deepStrictEqual(bangkokParts(new Date('2026-11-18T01:52:00Z')), { date: '2026-11-18', time: '08:52', minutes: 532 });
  // 18:30 UTC = ตีหนึ่งครึ่งของวันถัดไปในไทย
  assert.deepStrictEqual(bangkokParts(new Date('2026-11-18T18:30:00Z')), { date: '2026-11-19', time: '01:30', minutes: 90 });
  assert.strictEqual(bangkokParts(new Date('2026-11-18T17:00:00Z')).time, '00:00');
});

test('อ่านเวลา HH:MM', () => {
  assert.strictEqual(parseHHMM('09:00'), 540);
  assert.strictEqual(parseHHMM('8:30'), 510);
  assert.throws(() => parseHHMM('25:00'));
  assert.throws(() => parseHHMM('nine'));
});

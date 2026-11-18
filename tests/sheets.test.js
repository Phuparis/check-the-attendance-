const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const { createSheetsClient, buildJwt, quoteSheet } = require('../src/sheets');
const { createSheetsSync, LOG_SHEET, EMPLOYEE_SHEET } = require('../src/sheetsSync');

const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const credentials = {
  client_email: 'bot@example.iam.gserviceaccount.com',
  private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }),
};

test('JWT เซ็นถูกต้องด้วย private key ของ service account', () => {
  const jwt = buildJwt({ clientEmail: credentials.client_email, privateKey: credentials.private_key, nowSeconds: 1000 });
  const [h, c, s] = jwt.split('.');
  assert.ok(crypto.createVerify('RSA-SHA256').update(`${h}.${c}`).verify(publicKey, s, 'base64url'));
  const claim = JSON.parse(Buffer.from(c, 'base64url'));
  assert.strictEqual(claim.iss, credentials.client_email);
  assert.strictEqual(claim.exp, 4600);
});

test('ชื่อแท็บครอบด้วย quote', () => {
  assert.strictEqual(quoteSheet('บันทึกเวลา'), "'บันทึกเวลา'");
  assert.strictEqual(quoteSheet("it's"), "'it''s'");
});

function fakeGoogle() {
  const calls = [];
  let tokenCalls = 0;
  const fetchImpl = async (url, opts) => {
    calls.push({ url: decodeURIComponent(url), method: opts.method, body: opts.body && JSON.parse(opts.body.startsWith('{') ? opts.body : '{}') });
    if (url.includes('oauth2')) {
      tokenCalls++;
      return { ok: true, json: async () => ({ access_token: 'tok', expires_in: 3600 }) };
    }
    if (url.includes(':append')) {
      return { ok: true, json: async () => ({ updates: { updatedRange: "'พนักงาน'!A7:C7" } }) };
    }
    return { ok: true, json: async () => ({}) };
  };
  return { calls, fetchImpl, tokenCalls: () => tokenCalls };
}

test('เพิ่มแถวแบบ RAW (กันสูตรในชื่อ) และใช้ token ซ้ำ', async () => {
  const g = fakeGoogle();
  const sheets = createSheetsClient({ credentials, spreadsheetId: 'SHEET', fetchImpl: g.fetchImpl });
  const row = await sheets.appendRows('พนักงาน', [['U1', '=HYPERLINK("x")', 't']]);
  await sheets.appendRows('พนักงาน', [['U2', 'b', 't']]);
  assert.strictEqual(row, 7);
  assert.strictEqual(g.tokenCalls(), 1);
  const append = g.calls.find((c) => c.url.includes(':append'));
  assert.match(append.url, /SHEET\/values\/'พนักงาน'!A1:append\?valueInputOption=RAW/);
});

test('403 บอกให้แชร์ชีต', async () => {
  const fetchImpl = async (url) =>
    url.includes('oauth2')
      ? { ok: true, json: async () => ({ access_token: 't', expires_in: 3600 }) }
      : { ok: false, status: 403, text: async () => 'denied' };
  const sheets = createSheetsClient({ credentials, spreadsheetId: 'S', fetchImpl });
  await assert.rejects(sheets.getValues('x', 'A1'), /แชร์ชีต/);
});

function memorySheets(initial = {}) {
  const tabs = { ...initial };
  return {
    tabs,
    listSheetTitles: async () => Object.keys(tabs),
    addSheet: async (t) => (tabs[t] = []),
    getValues: async (t, a1) => (a1.startsWith('A1') ? tabs[t].slice(0, 1) : tabs[t].slice(1)),
    updateValues: async (t, a1, rows) => {
      const n = Number(/\d+/.exec(a1)[0]);
      tabs[t][n - 1] = rows[0];
    },
    appendRows: async (t, rows) => {
      tabs[t].push(...rows);
      return tabs[t].length - rows.length + 1;
    },
  };
}

test('setup สร้างแท็บและหัวตาราง', async () => {
  const s = memorySheets();
  await createSheetsSync({ sheets: s }).setup();
  assert.strictEqual(s.tabs[EMPLOYEE_SHEET][0][1], 'ชื่อ');
  assert.strictEqual(s.tabs[LOG_SHEET][0][3], 'ประเภท');
});

test('บันทึกแล้วโหลดกลับมาได้เหมือนเดิม (กันข้อมูลหายตอน Render รีสตาร์ต)', async () => {
  const s = memorySheets();
  const sync = createSheetsSync({ sheets: s });
  await sync.setup();
  sync.recordEmployee('U1', { name: 'สมชาย', registeredAt: 't1' });
  sync.recordCheckIn({ at: 'x', date: '2026-11-18', time: '08:52', name: 'สมชาย', userId: 'U1', branch: 'HQ', beacon: 'ประตู', late: false });
  sync.recordCheckIn({ at: 'x', date: '2026-11-17', time: '09:30', name: 'สมชาย', userId: 'U1', branch: 'HQ', beacon: 'ประตู', late: true });
  sync.recordCheckOut({ at: 'x', date: '2026-11-18', time: '18:00', name: 'สมชาย', userId: 'U1', branch: 'HQ', lastBeaconAt: '12:00' });
  sync.recordEmployee('U1', { name: 'สมชาย ใจดี', registeredAt: 't1' }); // เปลี่ยนชื่อ แก้แถวเดิม
  await sync.flush();

  assert.strictEqual(s.tabs[EMPLOYEE_SHEET].length, 2);
  assert.strictEqual(s.tabs[LOG_SHEET][3][9], 'เห็น beacon ล่าสุด 12:00');

  const fresh = createSheetsSync({ sheets: s });
  const data = await fresh.load('2026-11-18');
  assert.deepStrictEqual(data.employees, { U1: { name: 'สมชาย ใจดี', registeredAt: 't1' } });
  assert.deepStrictEqual(data.days['2026-11-18'].U1, {
    checkIn: '08:52', checkOut: '18:00', branch: 'HQ', beacon: 'ประตู', lastBeaconAt: '08:52', late: false,
  });
});

test('Google ล่ม: บอทไม่พัง แค่ log error', async () => {
  const errors = [];
  const sheets = { appendRows: async () => { throw new Error('boom'); } };
  const sync = createSheetsSync({ sheets, logger: { error: (...a) => errors.push(a.join(' ')) } });
  sync.recordCheckIn({});
  await sync.flush();
  assert.match(errors[0], /boom/);
});

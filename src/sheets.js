const crypto = require('crypto');

/**
 * ตัวคุยกับ Google Sheets API แบบเล็กที่สุด ไม่ต้องลงแพ็กเกจ googleapis (ขนาดหลายสิบ MB)
 *
 * ใช้ Service Account: บัญชีของ "โปรแกรม" ใน Google Cloud
 * แชร์ Google Sheet ให้อีเมลของ service account แบบ "ผู้แก้ไข" แล้วโปรแกรมจะเขียนได้
 * ขั้นตอนตั้งค่าอยู่ใน README
 */
const SCOPE = 'https://www.googleapis.com/auth/spreadsheets';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const API = 'https://sheets.googleapis.com/v4/spreadsheets';

const base64url = (input) => Buffer.from(input).toString('base64url');

/** สร้าง JWT ที่เซ็นด้วย private key ของ service account เพื่อแลกเป็น access token */
function buildJwt({ clientEmail, privateKey, nowSeconds }) {
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claim = base64url(
    JSON.stringify({ iss: clientEmail, scope: SCOPE, aud: TOKEN_URL, iat: nowSeconds, exp: nowSeconds + 3600 })
  );
  const signature = crypto.createSign('RSA-SHA256').update(`${header}.${claim}`).sign(privateKey, 'base64url');
  return `${header}.${claim}.${signature}`;
}

/** ชื่อแท็บภาษาไทยหรือมีช่องว่าง ต้องครอบด้วย ' ' เช่น 'บันทึกเวลา'!A:J */
const quoteSheet = (title) => `'${title.replace(/'/g, "''")}'`;

function createSheetsClient({ credentials, spreadsheetId, fetchImpl = fetch, now = () => Date.now() }) {
  if (!credentials?.client_email || !credentials?.private_key) {
    throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON ไม่ครบ ต้องมี client_email และ private_key');
  }
  let cached = null;

  async function getToken() {
    if (cached && now() < cached.expiresAt - 60_000) return cached.token;
    const assertion = buildJwt({
      clientEmail: credentials.client_email,
      privateKey: credentials.private_key,
      nowSeconds: Math.floor(now() / 1000),
    });
    const res = await fetchImpl(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }).toString(),
    });
    if (!res.ok) throw new Error(`ขอสิทธิ์ Google ไม่สำเร็จ (${res.status}) เช็ก GOOGLE_SERVICE_ACCOUNT_JSON`);
    const body = await res.json();
    cached = { token: body.access_token, expiresAt: now() + body.expires_in * 1000 };
    return cached.token;
  }

  async function call(method, path, body) {
    const res = await fetchImpl(`${API}/${spreadsheetId}${path}`, {
      method,
      headers: { Authorization: `Bearer ${await getToken()}`, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      const hint = res.status === 403 ? ' (แชร์ชีตให้อีเมล service account เป็นผู้แก้ไขหรือยัง?)' : '';
      throw new Error(`Google Sheets ตอบ ${res.status}${hint}: ${(await res.text()).slice(0, 200)}`);
    }
    return res.json();
  }

  const range = (sheet, a1) => encodeURIComponent(`${quoteSheet(sheet)}!${a1}`);

  return {
    async listSheetTitles() {
      const r = await call('GET', '?fields=sheets.properties.title');
      return (r.sheets || []).map((s) => s.properties.title);
    },
    async addSheet(title) {
      await call('POST', ':batchUpdate', { requests: [{ addSheet: { properties: { title } } }] });
    },
    async getValues(sheet, a1) {
      const r = await call('GET', `/values/${range(sheet, a1)}`);
      return r.values || [];
    },
    // RAW = เก็บตามตัวอักษร ไม่แปลงเป็นสูตร กันคนตั้งชื่อเป็น =สูตร แล้วชีตไปรันให้
    async updateValues(sheet, a1, rows) {
      await call('PUT', `/values/${range(sheet, a1)}?valueInputOption=RAW`, { values: rows });
    },
    /** เพิ่มแถวต่อท้าย คืนเลขแถวแรกที่เพิ่ม */
    async appendRows(sheet, rows) {
      const r = await call('POST', `/values/${range(sheet, 'A1')}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`, {
        values: rows,
      });
      const m = /![A-Z]+(\d+)/.exec(r.updates?.updatedRange || '');
      return m ? Number(m[1]) : null;
    },
  };
}

module.exports = { createSheetsClient, buildJwt, quoteSheet };

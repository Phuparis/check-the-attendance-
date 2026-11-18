require('dotenv').config();
const path = require('path');
const express = require('express');
const line = require('@line/bot-sdk');

const { loadConfig } = require('./config');
const { AttendanceStore } = require('./attendanceStore');
const { createEventHandler } = require('./eventHandler');
const { buildSimulatedBeaconEvent } = require('./simulator');
const { createTokenProvider, createLineClient } = require('./lineAuth');
const { createSheetsClient } = require('./sheets');
const { createSheetsSync, noopSync } = require('./sheetsSync');
const { bangkokParts } = require('./time');

const config = loadConfig();

if (!config.channelSecret || !(config.channelAccessToken || config.channelId)) {
  console.error('ต้องใส่ LINE_CHANNEL_SECRET และ LINE_CHANNEL_ID (หรือ LINE_CHANNEL_ACCESS_TOKEN)');
  console.error('ดูวิธีในไฟล์ .env.example');
  process.exit(1);
}

const getToken = createTokenProvider({
  staticToken: config.channelAccessToken,
  channelId: config.channelId,
  channelSecret: config.channelSecret,
});
const client = createLineClient({ getToken, MessagingApiClient: line.messagingApi.MessagingApiClient });
const store = new AttendanceStore(config.dataFile);

const sync =
  config.spreadsheetId && config.serviceAccount
    ? createSheetsSync({
        sheets: createSheetsClient({ credentials: config.serviceAccount, spreadsheetId: config.spreadsheetId }),
      })
    : noopSync;

// ผู้รับข้อความจากหน้าเว็บจำลอง: ใช้ค่าใน .env ถ้ามี ถ้าไม่มี ใช้คนล่าสุดที่แอดเพื่อนหรือทักแชท
const getDemoUser = () => config.demoUserId || store.getDemoUser();
const onUser = (userId) => {
  if (!config.demoUserId) store.setDemoUser(userId);
};

const handleEvent = createEventHandler({ client, store, sync, config, onUser });

const app = express();

// Webhook จาก LINE
// line.middleware ตรวจ signature ให้ว่าข้อมูลมาจาก LINE จริง ถ้าไม่ใช่จะตอบ 401 ทันที
app.post('/webhook', line.middleware({ channelSecret: config.channelSecret }), (req, res) => {
  // ตอบ 200 กลับไปหา LINE ก่อน แล้วค่อยประมวลผล LINE จะได้ไม่ส่ง event ซ้ำเพราะรอนาน
  res.sendStatus(200);

  for (const event of req.body.events) {
    handleEvent(event)
      .then((result) => {
        const { messages, ...summary } = result;
        console.log(`[${event.type}]`, JSON.stringify(summary));
      })
      .catch((err) => console.error(`[${event.type}] ส่งข้อความไม่สำเร็จ:`, err.message));
  }
});

// คำขอที่ไม่ได้มาจาก LINE (signature ไม่ตรง) ตอบ 401 แทน error 500
app.use('/webhook', (err, req, res, next) => {
  if (err instanceof line.SignatureValidationFailed) return res.status(401).send('invalid signature');
  if (err instanceof line.JSONParseError) return res.status(400).send('invalid json');
  return next(err);
});

app.get('/health', (req, res) => res.json({ ok: true }));

// หน้าเว็บจำลอง (ปิดตอนใช้งานจริง)
if (config.simulatorEnabled) {
  app.use(express.static(path.join(__dirname, '..', 'public')));

  app.get('/api/beacons', (req, res) => {
    const userId = getDemoUser();
    res.json({
      companyName: config.companyName,
      workStart: config.workStart,
      beacons: config.beacons.map(({ hwid, name, branch, requireToken }) => ({ hwid, name, branch, requireToken })),
      demoUserReady: Boolean(userId),
      demoUserName: userId ? store.getEmployee(userId)?.name || null : null,
    });
  });

  app.post('/api/simulate/beacon', express.json(), async (req, res) => {
    const userId = getDemoUser();
    if (!userId) {
      return res.status(400).json({
        error: 'ยังไม่รู้ว่าจะส่งข้อความหาใคร ให้แอดบอทเป็นเพื่อนใน LINE แล้วพิมพ์อะไรก็ได้ 1 ครั้ง',
      });
    }
    const event = buildSimulatedBeaconEvent({
      hwid: req.body.hwid,
      userId,
      secret: config.beaconSecret,
      signal: req.body.signal,
    });
    try {
      const { messages, ...result } = await handleEvent(event);
      res.json({ event, result, messages: messages || [] });
    } catch (err) {
      res.status(502).json({ event, error: `LINE ปฏิเสธการส่ง: ${err.message}` });
    }
  });

  app.post('/api/simulate/reset', (req, res) => {
    const userId = getDemoUser();
    if (userId) store.resetDay(bangkokParts(new Date()).date, userId);
    res.json({ ok: true });
  });
}

// ตั้ง Webhook URL ใน LINE ให้อัตโนมัติ เมื่อรู้ URL สาธารณะของเซิร์ฟเวอร์ (เช่น บน Render)
async function registerWebhook() {
  if (!config.publicUrl || !config.autoSetWebhook) return;
  const endpoint = `${config.publicUrl}/webhook`;
  try {
    await client.setWebhookEndpoint({ endpoint });
    console.log(`ตั้ง Webhook URL ใน LINE แล้ว: ${endpoint}`);
  } catch (err) {
    console.error(`ตั้ง Webhook URL อัตโนมัติไม่สำเร็จ ให้ไปใส่เองที่ LINE Developers Console: ${err.message}`);
  }
}

// โหลดรายชื่อและเวลาวันนี้จาก Google Sheets (Render ฟรีลบไฟล์ทุกครั้งที่รีสตาร์ต)
async function loadFromSheets() {
  if (sync === noopSync) {
    console.log('ยังไม่ได้ตั้งค่า Google Sheets: ข้อมูลเก็บในไฟล์บนเซิร์ฟเวอร์อย่างเดียว');
    return;
  }
  try {
    await sync.setup();
    const data = await sync.load(bangkokParts(new Date()).date);
    store.hydrate(data);
    console.log(`โหลดจาก Google Sheets แล้ว: พนักงาน ${Object.keys(data.employees).length} คน`);
  } catch (err) {
    console.error('โหลดจาก Google Sheets ไม่สำเร็จ:', err.message);
  }
}

loadFromSheets().then(() => {
  app.listen(config.port, () => {
    console.log(`ระบบลงเวลา ${config.companyName} พร้อมแล้วที่พอร์ต ${config.port}`);
    if (config.simulatorEnabled) console.log(`หน้าเว็บจำลอง: ${config.publicUrl || `http://localhost:${config.port}`}`);
    registerWebhook();
  });
});

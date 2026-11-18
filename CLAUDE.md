# CLAUDE.md: บันทึกโปรเจกต์สำหรับ Claude

อ่านไฟล์นี้ก่อนทำงานกับ repo นี้ จะได้ไม่ต้องให้เจ้าของเล่าใหม่
ตอบเจ้าของเป็นภาษาไทย อธิบายแบบเข้าใจง่าย เจ้าของมักทำงานจากมือถือ

## โปรเจกต์คืออะไร

ระบบเช็คชื่อเข้างานของบริษัทด้วย LINE Beacon: พนักงานเดินเข้าออฟฟิศแล้ว LINE OA ลงเวลาให้อัตโนมัติ
เจ้าของจะเอาไปลองใช้ในบริษัทจริง ต่อยอดจาก `Phuparis/line-beacon-cafe`

ที่มาของการตัดสินใจ (คุยกันเมื่อ 18 พ.ย. 2026):
- เจ้าของอยากให้ "เดินเข้าระยะแล้วเช็คชื่อได้เลย"
- กังวลเรื่องงบและบางที่ติดตั้งฮาร์ดแวร์ไม่ได้ จึงใช้มือถือพนักงาน + LINE เป็นหลัก
- เลือกใช้ beacon เพราะ GPS ปลอมง่าย และการ์ด RFID ต้องซื้อการ์ดและเครื่องอ่าน

## สิ่งที่ตั้งค่าไว้แล้ว

- **GitHub**: `phuparis/check-the-attendance-` (โค้ดอยู่ branch `ccr-30a7cdda-0102v0`)
- **LINE Official Account**: ชื่อ CheckTheAttendance, เบสิค ID `@484qdcdb`, แพ็กเกจฟรี
  - Provider ใหม่ชื่อ `Attendance` (แยกจากร้านกาแฟ เผื่อส่งมอบให้บริษัท) เปลี่ยนทีหลังไม่ได้
  - เปิด Messaging API แล้ว (18 พ.ย. 2026) สร้างผ่านแอป LINE OA เพราะเว็บพาไปหน้าญี่ปุ่น
  - ตอนเปิด Messaging API บนมือถือเจอ 400 Bad request รอบแรก ทำซ้ำแล้วผ่าน
- **Render**: Web Service ในโปรเจกต์ `CheckAttendence`, Region Singapore, Free, deploy จาก branch `ccr-30a7cdda-0102v0`
  - ลิงก์: `https://check-the-attendance.onrender.com` (หน้าเว็บจำลองเปิดอยู่)
  - Environment Variables: `LINE_CHANNEL_ID`, `LINE_CHANNEL_SECRET`, `BEACON_SECRET` (Generate), `SIMULATOR_ENABLED=true`, `WORK_START=09:00`
- ยังไม่ได้ตั้ง Google Sheet, ยังไม่มี HWID จริง

## การตัดสินใจสำคัญ

- **รหัสหมุนเวียนใน device message**: counter 4 ไบต์ (Unix ÷ 30) + HMAC-SHA256 8 ไบต์
  รับรหัสย้อนหลัง 2 รอบ อนาคต 1 รอบ (`src/beaconToken.js` ต้องตรงกับ `esp32/attendance_beacon`)
- ESP32 ต้องต่อ Wi-Fi เพื่อดึงเวลา NTP ถ้าที่ไหนไม่มี Wi-Fi ต้องเพิ่ม RTC (DS3231) ซึ่งยังไม่ได้ทำ
- `requireToken: false` ใน `config/beacons.json` สำหรับทดสอบด้วย nRF Connect เท่านั้น
- เช็คอิน = beacon `enter` ครั้งแรกของวัน (เวลาไทย), เช็คอินแล้วไม่ตอบซ้ำแต่จด `lastBeaconAt`
- เลิกงาน = พิมพ์หรือกดปุ่ม "เลิกงาน" (ไม่มี event `leave`) กดซ้ำได้ ใช้เวลาล่าสุด
- สาย = เวลาเข้า > `WORK_START`
- Google Sheets เป็นที่เก็บถาวร (Render ลบไฟล์ตอนรีสตาร์ต) โหลดพนักงานและเวลาวันนี้กลับตอนเริ่มรัน
  ใช้ REST + JWT เอง ไม่ใช้ googleapis, เขียนแบบ RAW กันสูตร
- `BEACON_SECRET` = ข้อความ ASCII ยาว ≥ 32 ตัว ใช้ตัวอักษรเป็นกุญแจตรง ๆ (กด Generate ใน Render ได้)
- ใช้แค่ Channel ID + secret (ขอ token เอง, ตั้ง webhook เอง) เหมือน line-beacon-cafe
- หน้าเว็บจำลองต้องปิดตอนใช้จริง เพราะไม่มีการล็อกอิน

## สถานะ

- [x] โค้ดเซิร์ฟเวอร์ + เทสต์ (49 ข้อผ่าน) + ลองรันในเครื่องด้วย webhook ที่เซ็นเอง
- [ ] ยังไม่ได้ทดสอบกับ LINE จริง (ส่งข้อความ, beacon event จริง, ค่า `dm` ที่ LINE ส่งมา)
- [ ] ยังไม่ได้ทดสอบกับ Google Sheets จริง
- [ ] โค้ด ESP32 ยังไม่เคยคอมไพล์
- [x] สร้าง LINE OA ของโปรเจกต์นี้ + เปิด Messaging API
- [x] ตั้งค่าการตอบกลับใน LINE OA (ปิดแชท ข้อความทักทาย ข้อความตอบกลับอัตโนมัติแล้ว)
- [ ] ขอ HWID จริง ใส่ใน `config/beacons.json`
- [x] Deploy บน Render (ขึ้น Live แล้ว 18 พ.ย. 2026)
- [ ] **ค้างอยู่ตรงนี้ (18 พ.ย. 2026)**: Logs ขึ้น "ขอ access token จาก LINE ไม่สำเร็จ (400)"
  สวิตช์ Webhook ใน LINE OA จึงยังเทา น่าจะใส่ `LINE_CHANNEL_SECRET` ใน Render เป็นค่าเก่า (ก่อนกด Issue) หรือมีช่องว่างติดมา
  แก้: คัดลอก Channel secret ใหม่จาก Developers Console > Basic settings ไปวางใน Render > Save, rebuild and deploy
  แล้วดู Logs ต้องเห็น "ตั้ง Webhook URL ใน LINE แล้ว" จากนั้นเปิดสวิตช์ Webhook ใน ตั้งค่า > ตั้งค่าการตอบกลับ
  เจ้าของจะทำต่อจากคอมพิวเตอร์
- [x] ออก LINE Channel secret ใหม่แล้ว (ค่าเดิมเคยถูกส่งในแชท 18 พ.ย. 2026)

## ไอเดียต่อยอด

- หน้าแอดมินให้ HR ดูสรุปรายวันหรือรายเดือน
- สุ่มให้ยืนยันตัวตนบนเครื่อง กันฝากมือถือ
- รองรับกะดึก
- Rich menu ปุ่มเลิกงานและสถานะ

## คำสั่ง

```bash
npm install
npm test
npm start
npm run secret
npm run beacon:packet -- <hwid> [--secure]
```

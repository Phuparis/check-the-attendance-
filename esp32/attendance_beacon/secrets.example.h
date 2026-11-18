// คัดลอกไฟล์นี้เป็น secrets.h ในโฟลเดอร์เดียวกัน แล้วกรอกค่าจริง
// secrets.h ถูกตั้งไว้ใน .gitignore แล้ว จะไม่ถูก commit ขึ้น GitHub

#define WIFI_SSID     "ชื่อ Wi-Fi ของออฟฟิศ"
#define WIFI_PASSWORD "รหัส Wi-Fi"

// Hardware ID 10 ตัวที่ได้จาก LINE Official Account Manager (ต้องตรงกับ config/beacons.json)
#define BEACON_HWID   "0123456789"

// ค่าเดียวกับ BEACON_SECRET ใน Render (คัดลอกมาทั้งหมด ตัวพิมพ์เล็กใหญ่ต้องตรงกัน)
#define BEACON_SECRET "00000000000000000000000000000000"

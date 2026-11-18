/*
 * ESP32 เป็น LINE Simple Beacon สำหรับเช็คชื่อ พร้อมรหัสหมุนเวียนกันก๊อปสัญญาณ
 *
 * วิธีใช้:
 * 1. คัดลอก secrets.example.h เป็น secrets.h แล้วกรอก Wi-Fi, HWID และ BEACON_SECRET
 * 2. Arduino IDE: ติดตั้งบอร์ด "esp32" by Espressif แล้วเลือกบอร์ด ESP32 Dev Module
 * 3. ถ้าคอมไพล์แล้วโปรแกรมใหญ่เกิน ให้ไปที่ Tools > Partition Scheme > "Huge APP"
 * 4. อัปโหลด แล้วเปิด Serial Monitor (115200) ดูว่าซิงก์เวลาสำเร็จ
 *
 * ทำไมต้องต่อ Wi-Fi: ESP32 ไม่มีนาฬิกาในตัว ต้องดึงเวลาจากอินเทอร์เน็ต (NTP)
 * เพื่อสร้างรหัสที่ตรงกับเซิร์ฟเวอร์ ต่อแค่ตอนเปิดเครื่องและซิงก์เวลาเป็นระยะ ไม่ได้ส่งข้อมูลพนักงาน
 *
 * ข้อมูลที่ปล่อยออกไป (สเปก LINE Simple Beacon):
 *   02 01 06                 Flags
 *   03 03 6F FE              Service UUID 0xFE6F
 *   16 16 6F FE 02 <HWID 5 ไบต์> 7F <device message 12 ไบต์>
 *
 * device message = counter 4 ไบต์ + HMAC-SHA256(secret, HWID + counter) 8 ไบต์แรก
 *   counter = เวลา Unix / 30 วินาที (เปลี่ยนทุก 30 วินาที)
 *   ต้องตรงกับ src/beaconToken.js ฝั่งเซิร์ฟเวอร์
 */

#include <WiFi.h>
#include <time.h>
#include <BLEDevice.h>
#include <esp_gap_ble_api.h>
#include <esp_bt.h>
#include "mbedtls/md.h"
#include "secrets.h"

const uint32_t STEP_SECONDS = 30;
// ลดกำลังส่ง ให้สัญญาณครอบคลุมแค่ในออฟฟิศ (ปรับขึ้นเป็น ESP_PWR_LVL_N0 ถ้าห้องใหญ่)
const esp_power_level_t TX_POWER = ESP_PWR_LVL_N12;

uint8_t hwid[5];
uint8_t secret[64];
size_t secretLen = 0;
uint32_t lastCounter = 0;
esp_ble_adv_params_t advParams = {};

uint8_t hexNibble(char c) {
  if (c >= '0' && c <= '9') return c - '0';
  if (c >= 'a' && c <= 'f') return c - 'a' + 10;
  if (c >= 'A' && c <= 'F') return c - 'A' + 10;
  return 0;
}

size_t parseHex(const char *hex, uint8_t *out, size_t maxLen) {
  size_t n = 0;
  while (hex[n * 2] && hex[n * 2 + 1] && n < maxLen) {
    out[n] = (hexNibble(hex[n * 2]) << 4) | hexNibble(hex[n * 2 + 1]);
    n++;
  }
  return n;
}

bool timeReady() {
  return time(nullptr) > 1700000000;  // หลังปี 2023 แปลว่าซิงก์เวลาแล้ว
}

void advertise(uint32_t counter) {
  // ลายเซ็น = HMAC-SHA256(secret, HWID 5 ไบต์ + counter 4 ไบต์)
  uint8_t data[9];
  memcpy(data, hwid, 5);
  data[5] = counter >> 24; data[6] = counter >> 16; data[7] = counter >> 8; data[8] = counter;
  uint8_t mac[32];
  mbedtls_md_hmac(mbedtls_md_info_from_type(MBEDTLS_MD_SHA256), secret, secretLen, data, sizeof(data), mac);

  uint8_t adv[31];
  size_t n = 0;
  adv[n++] = 0x02; adv[n++] = 0x01; adv[n++] = 0x06;                       // Flags
  adv[n++] = 0x03; adv[n++] = 0x03; adv[n++] = 0x6F; adv[n++] = 0xFE;      // UUID 0xFE6F
  adv[n++] = 3 + 1 + 5 + 1 + 12;                                          // ความยาว service data
  adv[n++] = 0x16; adv[n++] = 0x6F; adv[n++] = 0xFE;
  adv[n++] = 0x02;                                                         // frame type
  for (int i = 0; i < 5; i++) adv[n++] = hwid[i];                          // HWID
  adv[n++] = 0x7F;                                                         // measured TxPower
  for (int i = 5; i < 9; i++) adv[n++] = data[i];                          // counter 4 ไบต์
  for (int i = 0; i < 8; i++) adv[n++] = mac[i];                           // ลายเซ็น 8 ไบต์

  esp_ble_gap_stop_advertising();
  esp_ble_gap_config_adv_data_raw(adv, n);
  delay(50);  // รอให้ตั้งค่าข้อมูลเสร็จก่อนเริ่มปล่อยสัญญาณ
  esp_ble_gap_start_advertising(&advParams);

  Serial.printf("counter %lu  dm ", (unsigned long)counter);
  for (int i = n - 12; i < (int)n; i++) Serial.printf("%02x", adv[i]);
  Serial.println();
}

void setup() {
  Serial.begin(115200);
  delay(200);

  if (parseHex(BEACON_HWID, hwid, 5) != 5) Serial.println("BEACON_HWID ต้องเป็นเลขฐานสิบหก 10 ตัว");
  secretLen = parseHex(BEACON_SECRET, secret, sizeof(secret));
  if (secretLen < 16) Serial.println("BEACON_SECRET สั้นเกินไป (ต้องอย่างน้อย 32 ตัว)");

  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  Serial.print("กำลังต่อ Wi-Fi");
  for (int i = 0; i < 40 && WiFi.status() != WL_CONNECTED; i++) {
    delay(500);
    Serial.print(".");
  }
  Serial.println(WiFi.status() == WL_CONNECTED ? " ต่อแล้ว" : " ยังต่อไม่ได้ จะลองต่อไปเรื่อย ๆ");

  // ใช้เวลา UTC ตรงกับเซิร์ฟเวอร์ ระบบจะซิงก์เวลาซ้ำเองเป็นระยะ
  configTime(0, 0, "pool.ntp.org", "time.google.com");

  BLEDevice::init("Attendance Beacon");
  esp_ble_tx_power_set(ESP_BLE_PWR_TYPE_ADV, TX_POWER);

  advParams.adv_int_min = 0xF4;  // 244 x 0.625 ms = 152.5 ms
  advParams.adv_int_max = 0xF4;
  advParams.adv_type = ADV_TYPE_NONCONN_IND;
  advParams.own_addr_type = BLE_ADDR_TYPE_PUBLIC;
  advParams.channel_map = ADV_CHNL_ALL;
  advParams.adv_filter_policy = ADV_FILTER_ALLOW_SCAN_ANY_CON_ANY;

  Serial.printf("HWID = %s\n", BEACON_HWID);
}

void loop() {
  if (!timeReady()) {
    // ยังไม่รู้เวลา: ยังไม่ปล่อยสัญญาณ เพราะรหัสจะผิดอยู่ดี
    Serial.println("รอซิงก์เวลาจากอินเทอร์เน็ต...");
    delay(2000);
    return;
  }
  uint32_t counter = (uint32_t)(time(nullptr) / STEP_SECONDS);
  if (counter != lastCounter) {
    lastCounter = counter;
    advertise(counter);
  }
  delay(200);
}

#!/usr/bin/env node
/**
 * พิมพ์ค่าที่ต้องกรอกในแอป nRF Connect (Android) เพื่อให้มือถือทำตัวเป็น LINE Simple Beacon
 *
 * ใช้:  npm run beacon:packet -- <HWID>            ปล่อยแค่ HWID (ใช้กับ beacon ที่ตั้ง requireToken: false)
 *       npm run beacon:packet -- <HWID> --secure   ใส่รหัสหมุนเวียนของตอนนี้ด้วย (ต้องมี BEACON_SECRET ใน .env)
 *                                                  รหัสใช้ได้ประมาณ 1 นาที กรอกแล้วรีบเดินเข้าระยะ
 */
require('dotenv').config();
const { LINE_SERVICE_UUID, buildFrame, buildAdvertisingData, toHex } = require('../src/lineSimpleBeacon');
const { makeDeviceMessage } = require('../src/beaconToken');

const args = process.argv.slice(2);
const hwid = args.find((a) => !a.startsWith('--'));
const secure = args.includes('--secure');
if (!hwid) {
  console.log('ใช้: npm run beacon:packet -- <HWID 10 ตัว> [--secure]');
  process.exit(1);
}

try {
  let message = '00';
  if (secure) {
    if (!process.env.BEACON_SECRET) throw new Error('ต้องใส่ BEACON_SECRET ในไฟล์ .env ก่อน');
    message = makeDeviceMessage({ secret: process.env.BEACON_SECRET, hwid: hwid.toLowerCase() });
  }
  const frame = buildFrame(hwid, message);
  const full = buildAdvertisingData(hwid, message);

  console.log(`
ค่าที่ต้องกรอกในแอป nRF Connect > ADVERTISER > เพิ่ม advertising packet
---------------------------------------------------------------
Advertising data:
  1) Complete list of 16-bit Service UUIDs : ${LINE_SERVICE_UUID}
  2) Service Data
       UUID : ${LINE_SERVICE_UUID}
       Data : ${toHex(frame).replace(/ /g, '')}

Options: Legacy advertising, Non-connectable, Interval 160 ms หรือใกล้เคียง
${secure ? '\n⏱  รหัสนี้ใช้ได้ประมาณ 1 นาที หลังจากนั้นเซิร์ฟเวอร์จะปฏิเสธ (นี่คือระบบกันก๊อปทำงาน)\n' : ''}
ข้อมูลทั้งหมดที่ beacon ปล่อยออกไป (ไว้เทียบ):
  ${toHex(full)}
`);
} catch (err) {
  console.error(err.message);
  process.exit(1);
}

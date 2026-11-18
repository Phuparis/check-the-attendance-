const { makeDeviceMessage } = require('./beaconToken');

/**
 * สร้าง beacon event หน้าตาเหมือนที่ LINE ส่งมาจริง
 * ต่างกันแค่ไม่มี replyToken (เราสร้างเองไม่ได้) ระบบเลยส่งแบบ push แทน
 *
 * signal
 *   'real'   = สัญญาณจาก ESP32 จริง (รหัสหมุนเวียนตอนนี้)
 *   'copied' = มีคนก๊อปสัญญาณไว้เมื่อ 5 นาทีก่อน แล้วเอาไปปล่อยซ้ำจากที่บ้าน
 *   'fake'   = ปล่อยแค่ HWID ไม่มีรหัส (แบบแอป nRF Connect)
 */
function buildSimulatedBeaconEvent({ hwid, userId, secret, signal = 'real', now = new Date() }) {
  let dm;
  if (signal === 'real' && secret) dm = makeDeviceMessage({ secret, hwid, now: now.getTime() });
  if (signal === 'copied' && secret) dm = makeDeviceMessage({ secret, hwid, now: now.getTime() - 5 * 60 * 1000 });
  if (signal === 'fake') dm = '00';

  return {
    type: 'beacon',
    mode: 'active',
    timestamp: now.getTime(),
    source: { type: 'user', userId },
    webhookEventId: `sim-${now.getTime()}-${Math.random().toString(36).slice(2, 8)}`,
    deliveryContext: { isRedelivery: false },
    beacon: { hwid, type: 'enter', ...(dm ? { dm } : {}) },
  };
}

module.exports = { buildSimulatedBeaconEvent };

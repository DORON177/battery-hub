// Devices with a simple request/response battery protocol, described as data.
//
// Headset protocols come from HeadsetControl (github.com/Sapd/HeadsetControl) and SteelSeries
// mice from rivalcfg (github.com/flozz/rivalcfg). Offsets match what hidapi returns.
//
//   channel : which HID collection to talk to; omitted means try the vendor collections
//   steps   : run in order; each parse returns part of a reading, { offline: true } if the
//             dongle answers but the device is off, or null to keep waiting for the right frame
const { pad, scale, fromVoltage } = require('./exchange');

const OFFLINE = { offline: true };
const STATUS_REQUEST = [0x00, 0xb0];
const clampPercent = (v) => Math.min(100, Math.max(0, v));

// ---- SteelSeries Arctis ----
const STEELSERIES = 0x1038;
const NOVA_CHANNEL = { usagePage: 0xffc0, usage: 0x01, interface: 3 };
const NOVA_DISCRETE_LEVELS = new Set([0x2202, 0x2206, 0x220a, 0x223a, 0x227a, 0x22a4]); // reports 0-4

function novaWireless(f) { // Nova 3P, Nova 5: byte 1 = link, 3 = percent, 4 = charging
  if (f.length < 5) return null;
  if (f[1] === 0x02) return OFFLINE;
  return { capacity: clampPercent(f[3]), charging: f[4] === 0x01 };
}

function nova7(f, productId) {
  if (f.length < 4) return null;
  if (f[3] === 0x00) return OFFLINE;
  const capacity = NOVA_DISCRETE_LEVELS.has(productId) ? scale(f[2], 0, 4) : clampPercent(f[2]);
  return { capacity, charging: f[3] === 0x01 || f[3] === 0x02 };
}

// ---- Logitech headsets: HID++ long report asking for the battery voltage ----
const LOGITECH = 0x046d;
const LOGITECH_CHANNEL = { usagePage: 0xff43, usage: 0x0202 };
const curve = (mv, pct) => mv.map((v, i) => [v, pct[i]]);
const G533_CURVE = curve([4200, 3850, 3790, 3750, 3680, 3330], [100, 50, 30, 20, 5, 0]);
const G535_CURVE = curve([4175, 3817, 3766, 3730, 3664, 3310], [100, 50, 30, 20, 5, 0]);
const G633_CURVE = curve([4100, 3950, 3850, 3750, 3650, 3500, 3450, 3300], [100, 80, 60, 40, 20, 10, 5, 0]);
const GPRO_CURVE = curve([4150, 3830, 3780, 3740, 3670, 3320], [100, 50, 30, 20, 5, 0]);

function hidppVoltageStep(command, points) {
  return {
    request: pad([0x11, 0xff, ...command], 20),
    parse(f) {
      if (f.length < 7 || f[0] !== 0x11) return null;
      if (f[2] === 0xff) return OFFLINE; // HID++ error: the dongle answered for the headset
      const mv = (f[4] << 8) | f[5];
      if (mv < points[points.length - 1][0]) return OFFLINE; // no real cell reads this low
      return { capacity: fromVoltage(mv, points), charging: f[6] === 0x03, voltageMv: mv };
    },
  };
}

// ---- HyperX ----
const HP = 0x03f0;
const KINGSTON = 0x0951;
const CLOUD_FLIGHT_CHARGING_MV = 0x100b;
const CLOUD_FLIGHT_CURVE = curve([3975, 3900, 3800, 3700, 3648, 0], [100, 80, 50, 25, 8, 0]);

function cloud2Step(command, parse) {
  return {
    request: pad([0x06, 0xff, 0xbb, command, 0x00], 52),
    parse(f) {
      if (f.length < 8 || f[0] !== 0x06 || f[1] !== 0xff || f[2] !== 0xbb || f[3] !== command) return null;
      return parse(f);
    },
  };
}

function alphaStep(command, parse) {
  return {
    request: pad([0x21, 0xbb, command], 31),
    parse(f) {
      if (f.length < 4 || f[0] !== 0x21 || f[1] !== 0xbb || f[2] !== command) return null;
      return parse(f);
    },
  };
}

// byte 1: charging flag on top, level in 5% steps from 1. rivalcfg reads a level outside 0-100
// (a raw 0 from the dongle) as the mouse being off.
function aeroxBattery(f) {
  if (f.length < 2) return null;
  const level = ((f[1] & 0x7f) - 1) * 5;
  if (level < 0 || level > 100) return OFFLINE;
  return { capacity: level, charging: !!(f[1] & 0x80) };
}

const DEVICES = [
  // Headsets
  {
    name: 'SteelSeries Arctis 1', kind: 'headset', vendorId: STEELSERIES, productIds: [0x12b3, 0x12b6, 0x12d5, 0x12d7],
    channel: { usagePage: 0xff43, usage: 0x0202, interface: 3 },
    steps: [{ request: [0x06, 0x12], parse: (f) => (f.length < 4 ? null : f[2] === 0x01 ? OFFLINE : { capacity: clampPercent(f[3]) }) }],
  },
  {
    name: 'SteelSeries Arctis 7', kind: 'headset', vendorId: STEELSERIES, productIds: [0x1252, 0x1260, 0x1280, 0x12ad],
    channel: { usagePage: 0xff43, usage: 0x0202, interface: 5 },
    steps: [{ request: [0x06, 0x18], parse: (f) => (f.length < 3 ? null : { capacity: clampPercent(f[2]) }) }],
  },
  {
    name: 'SteelSeries Arctis 7+', kind: 'headset', vendorId: STEELSERIES, productIds: [0x220e, 0x2212, 0x2216, 0x2236],
    channel: NOVA_CHANNEL,
    steps: [{
      request: STATUS_REQUEST,
      parse: (f) => (f.length < 4 ? null : f[1] === 0x01 ? OFFLINE : { capacity: scale(f[2], 0, 4), charging: f[3] === 0x01 }),
    }],
  },
  {
    name: 'SteelSeries Arctis 9', kind: 'headset', vendorId: STEELSERIES, productIds: [0x12c2, 0x12c4],
    channel: { interface: 0 },
    steps: [{
      request: [0x00, 0x20],
      parse: (f) => (f.length < 5 ? null : f[4] === 0xff ? OFFLINE : { capacity: scale(f[3], 0x64, 0x9a), charging: f[4] === 0x01 }),
    }],
  },
  {
    name: 'SteelSeries Arctis Nova 3P/5', kind: 'headset', vendorId: STEELSERIES, productIds: [0x2269, 0x226d, 0x2232, 0x2253],
    channel: NOVA_CHANNEL, steps: [{ request: STATUS_REQUEST, parse: novaWireless }],
  },
  {
    name: 'SteelSeries Arctis Nova 7', kind: 'headset', vendorId: STEELSERIES,
    productIds: [0x2202, 0x2206, 0x223a, 0x2258, 0x227a, 0x227e, 0x229e, 0x22a1, 0x22a4, 0x22a5, 0x22a9, 0x22ad, 0x220a, 0x22a7, 0x2298],
    channel: NOVA_CHANNEL, steps: [{ request: STATUS_REQUEST, parse: nova7 }],
  },
  {
    name: 'SteelSeries Arctis Nova Pro Wireless', kind: 'headset', vendorId: STEELSERIES, productIds: [0x12e0, 0x12e5],
    channel: { interface: 4 },
    steps: [{
      request: pad([0x06, 0xb0], 31),
      parse: (f) => (f.length < 16 ? null : f[15] === 0x01 ? OFFLINE : { capacity: scale(f[6], 0, 8), charging: f[15] === 0x02 }),
    }],
  },
  {
    name: 'HyperX Cloud Alpha Wireless', kind: 'headset', vendorId: HP, productIds: [0x098d],
    steps: [
      alphaStep(0x03, (f) => (f[3] === 0x01 ? OFFLINE : {})),
      alphaStep(0x0c, (f) => ({ charging: f[3] === 0x01 })),
      alphaStep(0x0b, (f) => ({ capacity: clampPercent(f[3]) })),
    ],
  },
  {
    name: 'HyperX Cloud Flight', kind: 'headset', vendorId: KINGSTON, productIds: [0x16c4, 0x1723],
    steps: [{
      request: pad([0x21, 0xff, 0x05], 20),
      parse(f) {
        if (f.length !== 15 && f.length !== 20) return null;
        const mv = (f[3] << 8) | f[4];
        return { capacity: fromVoltage(mv, CLOUD_FLIGHT_CURVE), charging: mv > CLOUD_FLIGHT_CHARGING_MV, voltageMv: mv };
      },
    }],
  },
  {
    name: 'HyperX Cloud II Wireless', kind: 'headset', vendorId: HP, productIds: [0x0696, 0x018b],
    channel: { usagePage: 0xff90, usage: 0x0303, interface: 0 },
    steps: [
      cloud2Step(0x02, (f) => ({ capacity: clampPercent(f[7]) })),
      cloud2Step(0x03, (f) => ({ charging: f[4] === 1 })),
    ],
  },
  {
    name: 'Corsair Void and Virtuoso', kind: 'headset', vendorId: 0x1b1c,
    productIds: [0x1b1c, 0x1b27, 0x0a14, 0x0a16, 0x0a17, 0x0a1d, 0x0a1a, 0x1b2a, 0x1b23, 0x1b29, 0x0a55, 0x0a51, 0x0a52, 0x0a38, 0x0a4f, 0x0a2b, 0x0a75, 0x0a56],
    channel: { usagePage: 0xffc5, usage: 0x01, interface: 3 },
    steps: [{
      request: [0xc9, 0x64],
      parse(f) {
        if (f.length < 5 || f[0] !== 100) return null;
        if (f[4] === 0) return OFFLINE;
        return { capacity: clampPercent(f[2] & 0x7f), charging: f[4] === 4 || f[4] === 5 };
      },
    }],
  },
  {
    name: 'MCHOSE X9', kind: 'headset', vendorId: 0x3837, productIds: [0x6045],
    channel: { usagePage: 0xff90, usage: 0x01 },
    steps: [{
      request: pad([0x55, 0x65, 0x01], 64),
      parse: (f) => (f.length >= 4 && f[0] === 0x55 && f[1] === 0x65 && f[3] === 0x02 ? { capacity: clampPercent(f[2]) } : null),
    }],
  },
  {
    name: 'Logitech G633, G733, G933', kind: 'headset', vendorId: LOGITECH, productIds: [0x0a5c, 0x0a89, 0x0a5b, 0x0a87, 0x0ab5, 0x0afe, 0x0b1f],
    channel: LOGITECH_CHANNEL, steps: [hidppVoltageStep([0x08, 0x0a], G633_CURVE)],
  },
  {
    name: 'Logitech G533', kind: 'headset', vendorId: LOGITECH, productIds: [0x0a66],
    channel: { ...LOGITECH_CHANNEL, interface: 3 }, steps: [hidppVoltageStep([0x07, 0x01], G533_CURVE)],
  },
  {
    name: 'Logitech G535', kind: 'headset', vendorId: LOGITECH, productIds: [0x0ac4],
    channel: { usagePage: 0x0c, usage: 0x01, interface: 3 }, steps: [hidppVoltageStep([0x05, 0x0d], G535_CURVE)],
  },
  {
    name: 'Logitech G PRO', kind: 'headset', vendorId: LOGITECH, productIds: [0x0aa7, 0x0aaa, 0x0aba, 0x0afb, 0x0afc],
    channel: LOGITECH_CHANNEL, steps: [hidppVoltageStep([0x06, 0x0d], GPRO_CURVE)],
  },

  // Mice
  {
    name: 'SteelSeries Rival 3 Wireless', kind: 'mouse', vendorId: STEELSERIES, productIds: [0x1830, 0x1872],
    channel: { interface: 3 },
    steps: [{ request: [0x00, 0xaa, 0x01], parse: (f) => (f.length < 3 ? null : f[0] > 100 ? OFFLINE : { capacity: f[0], charging: !!f[2] }) }],
  },
  {
    name: 'SteelSeries Aerox and Prime Wireless', kind: 'mouse', vendorId: STEELSERIES,
    productIds: [0x1838, 0x1878, 0x1852, 0x185c, 0x1860, 0x1858, 0x1874, 0x1840, 0x1848],
    channel: { interface: 3 },
    steps: [{
      request: [0x00, 0xd2],
      parse: aeroxBattery,
    }],
  },
  {
    name: 'SteelSeries Aerox and Prime Wireless (cable)', kind: 'mouse', vendorId: STEELSERIES,
    productIds: [0x183a, 0x187a, 0x1854, 0x185e, 0x1862, 0x185a, 0x1876, 0x1842, 0x184a],
    channel: { interface: 3 },
    steps: [{ request: [0x00, 0x92], parse: aeroxBattery }],
  },
];

function find(logicalDevice) {
  return DEVICES.find((d) => d.vendorId === logicalDevice.vendorId && d.productIds.includes(logicalDevice.productId)) || null;
}

module.exports = { DEVICES, find };

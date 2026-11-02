// Logitech HID++ 2.0 battery reading for mice and keyboards, through a receiver (Bolt, Unifying,
// Lightspeed) or directly. Feature numbers and meanings follow Linux's hid-logitech-hidpp.c.
//
// Long report: 0x11 <device> <feature index> <function << 4 | software id> <params...>
// Windows splits short and long reports into separate collections, so everything here is long.
const { exchange, pad, fromVoltage } = require('./exchange');

const LOGITECH = 0x046d;
const LONG = 0x11;
const LONG_LENGTH = 20;
const SOFTWARE_ID = 0x0b;
const ROOT_INDEX = 0x00;
const ERROR_INDEX = 0xff; // HID++ 2.0 error: the device itself refused the call
const OLD_ERROR_INDEX = 0x8f; // HID++ 1.0 error: usually the receiver answering for a device it can't reach
// HID++ 1.0 error codes for a device the receiver can't reach: Linux reads resource error and
// unknown device as "might not be connected", and Solaar adds a failed connection request.
const UNREACHABLE = new Set([0x04, 0x08, 0x09]);
const DIRECT = 0xff;
const RECEIVER_SLOTS = [1, 2, 3, 4, 5, 6];
const REPLY_MS = 400;

const UNIFIED_BATTERY = 0x1004;
const BATTERY_STATUS = 0x1000;
const BATTERY_VOLTAGE = 0x1001;
const UNIFIED_LEVELS = [[8, 100], [4, 50], [2, 20], [1, 5]]; // full, good, low, critical
const CELL_CURVE = [[4190, 100], [4060, 90], [3980, 80], [3920, 70], [3870, 60], [3830, 50], [3790, 40], [3760, 30], [3730, 20], [3690, 10], [3500, 0]];

const routes = new Map(); // channel path -> { device, feature, index }

function channelOf(logicalDevice) {
  const on = (page, usage) => logicalDevice.channels.find((c) => c.usagePage === page && c.usage === usage);
  return on(0xff00, 0x02) || on(0xff43, 0x0202);
}

function matches(logicalDevice) {
  return logicalDevice.vendorId === LOGITECH && !!channelOf(logicalDevice);
}

function request(device, index, fn, params = []) {
  return pad([LONG, device, index, (fn << 4) | SOFTWARE_ID, ...params], LONG_LENGTH);
}

// The params of a reply to exactly this call; throws on an error answer to it. As in Linux's
// hidpp_match_error, an error belongs to this call only when it repeats the call's feature index
// and function: other software such as G HUB talks to the same device, and its errors arrive here too.
function replyTo(frame, device, index, fn) {
  if (frame.length < 6 || frame[1] !== device) return null;
  if (frame[2] === ERROR_INDEX || frame[2] === OLD_ERROR_INDEX) {
    if (frame[3] !== index || frame[4] !== ((fn << 4) | SOFTWARE_ID)) return null;
    if (frame[2] === OLD_ERROR_INDEX && UNREACHABLE.has(frame[5])) throw new Error('device is off');
    throw new Error(`device refused the request (error ${frame[5]})`);
  }
  if (frame[2] !== index || frame[3] !== ((fn << 4) | SOFTWARE_ID)) return null;
  return frame.slice(4);
}

// How a call ended when it didn't succeed. Anything else means the channel itself failed, for
// example because the receiver was unplugged.
const SILENT = /^timeout waiting/;
const ANSWERED = /^device (is off|refused)/;
const isOutcome = (e) => SILENT.test(e.message) || ANSWERED.test(e.message);
// A refusal shows a working device, the receiver saying it can't reach one comes next, and
// silence says least: it may be an empty slot as much as a device that is off.
const weight = (e) => (/^device refused/.test(e.message) ? 3 : /is off$/.test(e.message) ? 2 : 1);

const call = (channel, device, index, fn, params) => exchange(
  channel, request(device, index, fn, params), (f) => replyTo(f, device, index, fn), REPLY_MS,
);

async function featureIndex(channel, device, feature) {
  const params = await call(channel, device, ROOT_INDEX, 0, [feature >> 8, feature & 0xff]);
  return params[0];
}

// 0x1004: <percent> <level flags> <charging> <external power>. Some devices only report levels.
function parseUnified(p) {
  let capacity = p[0];
  if (capacity === 0) {
    const level = UNIFIED_LEVELS.find(([bit]) => p[1] & bit);
    capacity = level ? level[1] : 0;
  }
  const full = p[2] === 3;
  return { capacity: full ? 100 : capacity, charging: p[2] === 1 || p[2] === 2 || full };
}

// 0x1000: <percent> <next level> <status>. Devices report 0% while charging.
function parseStatus(p) {
  const full = p[2] === 3;
  return { capacity: full ? 100 : p[0], charging: p[2] === 1 || p[2] === 2 || p[2] === 4 || full };
}

// 0x1001: <millivolts, big endian> <flags>
function parseVoltage(p) {
  const voltageMv = (p[0] << 8) | p[1];
  const charging = !!(p[2] & 0x80) && (p[2] & 0x07) < 2;
  return { capacity: charging && (p[2] & 0x07) === 1 ? 100 : fromVoltage(voltageMv, CELL_CURVE), charging, voltageMv };
}

const FEATURES = [
  { feature: UNIFIED_BATTERY, fn: 1, parse: parseUnified },
  { feature: BATTERY_STATUS, fn: 0, parse: parseStatus },
  { feature: BATTERY_VOLTAGE, fn: 0, parse: parseVoltage },
];

async function findRoute(channel, logicalDevice) {
  const receiver = /receiver/i.test(logicalDevice.product);
  const slots = receiver ? RECEIVER_SLOTS : [DIRECT, ...RECEIVER_SLOTS];
  let failure = null;
  for (const device of slots) {
    for (const entry of FEATURES) {
      try {
        const index = await featureIndex(channel, device, entry.feature);
        if (index) return { device, index, entry };
      } catch (e) {
        if (!isOutcome(e)) throw e;
        if (!failure || weight(e) > weight(failure)) failure = e;
        break; // nothing usable in this slot: try the next one
      }
    }
  }
  if (!failure) throw new Error('no battery feature found');
  if (weight(failure) === 1) throw new Error('device is not answering');
  throw failure;
}

async function readRoute(channel, route) {
  const params = await call(channel, route.device, route.index, route.entry.fn);
  const reading = route.entry.parse(params);
  if (!reading.capacity) throw new Error('waiting for device to report');
  return reading;
}

async function readBattery(logicalDevice) {
  const channel = channelOf(logicalDevice);
  if (!channel) throw new Error('no command channel');
  const known = routes.get(channel.path);
  if (known) {
    try {
      return await readRoute(channel, known);
    } catch (e) {
      routes.delete(channel.path); // a device can move slot or wake with other firmware
      if (!isOutcome(e)) throw e;
      // Look again straight away, so a device that went off shows as off on this read.
    }
  }
  const route = await findRoute(channel, logicalDevice);
  routes.set(channel.path, route);
  try {
    return await readRoute(channel, route);
  } catch (e) {
    routes.delete(channel.path);
    throw e;
  }
}

module.exports = { id: 'hidpp', matches, readBattery, parseUnified, parseStatus, parseVoltage, replyTo, request };

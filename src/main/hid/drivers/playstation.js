// Sony DualSense and DualShock 4 controllers. These send a stream of input reports with the
// battery inside. Offsets follow Linux's hid-playstation.c.
//
// Over Bluetooth a controller starts with a short report that has no battery in it, which Windows
// pads with zeros to full length, so report 0x01 means nothing there. Reading the calibration
// report moves it to the full report (0x31 or 0x11), as Steam and DS4Windows do. That lasts until
// the controller turns off, and an old game using DirectInput loses the controller until then, so
// it only happens for a controller the user added, and there is a setting to refuse it.
const session = require('../session');
const { address } = require('../../identity');

const SONY = 0x054c;
const DUALSENSE = new Set([0x0ce6, 0x0df2]); // DualSense, DualSense Edge
const DUALSHOCK4 = new Set([0x05c4, 0x09cc, 0x0ba0]); // v1, v2, wireless adapter
const ADAPTER = 0x0ba0;
const LISTEN_MS = 1500;
const FULL_REPORT = { id: 0x05, size: 41 };
const BLUETOOTH_HID = /00001124-0000-1000-8000-00805f9b34fb/i;
const LISTEN_SLICE_MS = 100;

const isBluetooth = (channel) => BLUETOOTH_HID.test(channel.path);
const channelOf = (logicalDevice) => logicalDevice.channels.find((c) => c.usagePage === 0x01 && c.usage === 0x05);

function matches(logicalDevice) {
  return logicalDevice.vendorId === SONY
    && (DUALSENSE.has(logicalDevice.productId) || DUALSHOCK4.has(logicalDevice.productId))
    && !!channelOf(logicalDevice);
}

// Each unit is 10%, and the value means "at least that much".
const level = (units) => Math.min(100, units * 10 + 5);

function parseDualSense(frame, bluetooth) {
  if (frame[0] !== (bluetooth ? 0x31 : 0x01)) return null;
  const status = frame[bluetooth ? 54 : 53];
  const units = status & 0x0f;
  const state = status >> 4;
  if (state === 0x0) return { capacity: level(units), charging: false };
  if (state === 0x1) return { capacity: level(units), charging: true };
  if (state === 0x2) return { capacity: 100, charging: true };
  return null; // temperature or charging fault: no trustworthy level
}

// Sony's wireless adapter keeps sending mostly empty reports with no controller connected. Linux
// tells by bit 2 of the second status byte, which is set while the adapter has no controller.
function parseDualShock4(frame, bluetooth, adapter = false) {
  if (frame[0] !== (bluetooth ? 0x11 : 0x01)) return null;
  if (adapter && !bluetooth && (frame[31] & 0x04)) return { off: true };
  const status = frame[bluetooth ? 32 : 30];
  const units = status & 0x0f;
  const cable = !!(status & 0x10);
  if (!cable) return { capacity: level(Math.min(units, 10)), charging: false };
  if (units <= 10) return { capacity: level(units), charging: true };
  if (units === 11) return { capacity: 100, charging: true };
  return null;
}

async function readBattery(logicalDevice, profile) {
  const channel = channelOf(logicalDevice);
  if (!channel) throw new Error('no command channel');
  const parse = DUALSENSE.has(logicalDevice.productId) ? parseDualSense : parseDualShock4;
  const bluetooth = isBluetooth(channel);
  const dev = await session.acquire(channel.path);
  await session.readQueued(channel.path, dev);
  const deadline = Date.now() + LISTEN_MS;
  let askedForFullReport = false;
  while (Date.now() < deadline) {
    const frame = await session.read(channel.path, dev, LISTEN_SLICE_MS);
    if (frame.length === 0) continue;
    const reading = parse(frame, bluetooth, logicalDevice.productId === ADAPTER);
    if (reading && reading.off) throw new Error('device is off');
    if (reading) return reading;
    if (bluetooth && frame[0] === 0x01 && !askedForFullReport) {
      if (profile && profile.quietBluetooth) throw new Error('Bluetooth reading is off in Settings');
      askedForFullReport = true;
      await dev.getFeatureReport(FULL_REPORT.id, FULL_REPORT.size);
    }
  }
  throw new Error('device is off');
}

// The Bluetooth address, which over USB only the pairing report knows. It is stored backwards.
async function identify(logicalDevice) {
  const channel = channelOf(logicalDevice);
  const [id, size] = DUALSENSE.has(logicalDevice.productId) ? [0x09, 20] : [0x12, 16];
  const dev = await session.acquire(channel.path);
  const report = Array.from(await dev.getFeatureReport(id, size));
  return address(report.slice(1, 7).reverse().map((b) => b.toString(16).padStart(2, '0')).join(''));
}

module.exports = { id: 'playstation', needsIdentify: true, matches, readBattery, identify, parseDualSense, parseDualShock4 };

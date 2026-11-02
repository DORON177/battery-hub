// Razer wireless mice and keyboards. Every Razer device speaks the same 90-byte feature report,
// documented by OpenRazer (driver/razerchromacommon.c, driver/razercommon.h):
//
//   0 status, 1 transaction id, 2-3 remaining packets, 4 protocol, 5 data size,
//   6 command class, 7 command id, 8-87 arguments, 88 xor of bytes 2-87, 89 reserved
const session = require('../session');
const DEVICES = require('./razer-devices');

const RAZER = 0x1532;
const REPORT_SIZE = 90;
const REPORT_ID = 0x00;
const CLASS_MISC = 0x07;
const CMD_BATTERY = 0x80;
const CMD_CHARGING = 0x84;
const STATUS_BUSY = 0x01;
const STATUS_OK = 0x02;
const ANSWER_ATTEMPTS = 8;
const ANSWER_WAIT_MS = 40;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const entry = (productId) => DEVICES.find(([pid]) => pid === productId) || null;

function matches(logicalDevice) {
  return logicalDevice.vendorId === RAZER && !!entry(logicalDevice.productId);
}

function buildRequest(transactionId, commandId) {
  const report = new Array(REPORT_SIZE).fill(0);
  report[1] = transactionId;
  report[5] = 0x02;
  report[6] = CLASS_MISC;
  report[7] = commandId;
  for (let i = 2; i < 88; i++) report[88] ^= report[i];
  return report;
}

// Arguments of a finished reply to this command, or null if it isn't ready or isn't ours.
function parseReply(report, commandId) {
  if (report.length < REPORT_SIZE) return null;
  if (report[0] !== STATUS_OK || report[6] !== CLASS_MISC || report[7] !== commandId) return null;
  return report.slice(8, 88);
}

async function ask(dev, transactionId, commandId) {
  await dev.sendFeatureReport([REPORT_ID, ...buildRequest(transactionId, commandId)]);
  for (let i = 0; i < ANSWER_ATTEMPTS; i++) {
    await sleep(ANSWER_WAIT_MS);
    const raw = Array.from(await dev.getFeatureReport(REPORT_ID, REPORT_SIZE + 1));
    const report = raw.slice(1); // hidapi puts the report id first
    if (report[0] === STATUS_BUSY) continue;
    const args = parseReply(report, commandId);
    if (args) return args;
    throw new Error('device did not accept the request');
  }
  throw new Error('timeout waiting for battery response');
}

const working = new Map(); // logical id -> channel path that answered

async function readFrom(channel, transactionId) {
  const dev = await session.acquire(channel.path);
  const level = await ask(dev, transactionId, CMD_BATTERY);
  // A sleeping mouse answers through its receiver with an empty level.
  if (level[1] === 0) throw new Error('device is off');
  const charging = await ask(dev, transactionId, CMD_CHARGING).then((a) => !!a[1], () => null);
  return { capacity: Math.round((level[1] * 100) / 255), charging };
}

// The feature report lives on one collection, and which one differs by model.
async function readBattery(logicalDevice) {
  const found = entry(logicalDevice.productId);
  if (!found) throw new Error('unsupported device');
  const known = logicalDevice.channels.find((c) => c.path === working.get(logicalDevice.id));
  const channels = known ? [known] : [...logicalDevice.channels].sort((a, b) => a.interface - b.interface);
  let lastError = new Error('no command channel');
  for (const channel of channels) {
    try {
      const reading = await readFrom(channel, found[1]);
      working.set(logicalDevice.id, channel.path);
      return reading;
    } catch (e) {
      lastError = e;
      if (e.message === 'device is off') break;
    }
  }
  working.delete(logicalDevice.id);
  throw lastError;
}

module.exports = { id: 'razer', matches, readBattery, buildRequest, parseReply };

// Battery protocol for VXE / Kysona-family wireless mice (shared OEM firmware).
// Reverse-engineered from Linux's in-tree driver: drivers/hid/hid-kysona.c
// Request: report 0x08, subcommand 0x04 (BATTERY_REPORT_ID), fixed trailing checksum 0x49.
// Response arrives async on the same 0xFF02 collection:
//   byte[6]  = capacity percent (0-100)
//   byte[7]  = charging flag (0/1)
//   byte[8-9] = voltage in mV, big-endian
const { findChannel } = require('../catalog');
const session = require('../session');

const USAGE_PAGE_COMMAND = 0xFF02;
const BATTERY_REQUEST = [0x08, 0x04, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x49];
const RESPONSE_TIMEOUT_MS = 4000;
const REPOKE_MS = 500; // this firmware often ignores a single request; poke until it answers
const READ_SLICE_MS = 100;

const KNOWN_VENDOR_IDS = new Set([0x3554]); // VXE

function matches(logicalDevice) {
  if (!KNOWN_VENDOR_IDS.has(logicalDevice.vendorId)) return false;
  return !!findChannel(logicalDevice, USAGE_PAGE_COMMAND);
}

// Turn one raw frame into a reading, or null if it isn't a usable battery frame.
function parseFrame(arr) {
  if (arr[0] !== 0x08 || arr[1] !== 0x04) return null;
  const capacity = arr[6];
  // firmware sends a zeroed "not ready yet" frame sometimes; keep waiting for a real one
  if (!(capacity > 0 && capacity <= 100)) return null;
  return { capacity, charging: !!arr[7], voltageMv: (arr[8] << 8) | arr[9] };
}

async function readBattery(logicalDevice) {
  const channel = findChannel(logicalDevice, USAGE_PAGE_COMMAND);
  if (!channel) throw new Error('no command channel');

  const dev = await session.acquire(channel.path);
  await session.readQueued(channel.path, dev); // a late reply to an old request is stale

  const deadline = Date.now() + RESPONSE_TIMEOUT_MS;
  let nextPoke = 0;
  while (Date.now() < deadline) {
    if (Date.now() >= nextPoke) {
      await dev.write(BATTERY_REQUEST);
      nextPoke = Date.now() + REPOKE_MS;
    }
    const reading = parseFrame(await session.read(channel.path, dev, READ_SLICE_MS));
    if (reading) return reading;
  }
  throw new Error('timeout waiting for battery response');
}

module.exports = { id: 'kysona', matches, parseFrame, readBattery };

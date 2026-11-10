// Battery protocol for VXE / Kysona-family wireless mice (shared OEM firmware).
// Reverse-engineered from Linux's in-tree driver: drivers/hid/hid-kysona.c
// Request: report 0x08, subcommand 0x04 (BATTERY_REPORT_ID), fixed trailing checksum 0x49.
// Response arrives async on the same 0xFF02 collection:
//   byte[6]  = capacity percent (0-100)
//   byte[7]  = charging flag (0/1)
//   byte[8-9] = voltage in mV, big-endian
//
// Linux now runs this family in drivers/hid/hid-pulsar.c, which also asks the receiver whether it
// has the mouse at all (CMD_STATUS): subcommand 0x03, checksum 0x4a. byte[6] of the answer is 1
// while the mouse is connected and 0 when it isn't. A switched-off mouse never answers the battery
// request, so without this it could only look asleep. Checked on a VXE R1 Pro: 0 within a second of
// switching it off, 1 again on switching it on.
const { findChannel } = require('../catalog');
const session = require('../session');

const USAGE_PAGE_COMMAND = 0xFF02;
const BATTERY_REQUEST = [0x08, 0x04, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x49];
const STATUS_REQUEST = [0x08, 0x03, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x4a];
const FRAME_LENGTH = 17;
const OFF_ANSWERS = 2; // "not connected" this many times in a row; one can catch the switch moving
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

// The receiver's answer to the status request: true while it has the mouse, false when it
// doesn't, null for any other frame. The checksum is checked as Linux does.
function parseStatus(arr) {
  if (arr.length < FRAME_LENGTH || arr[0] !== 0x08 || arr[1] !== 0x03 || arr[6] > 1) return null;
  let sum = 0;
  for (let i = 0; i < FRAME_LENGTH - 1; i++) sum += arr[i];
  if (((0x55 - sum) & 0xff) !== arr[FRAME_LENGTH - 1]) return null;
  return arr[6] === 1;
}

// The command collection first, then the other vendor collections: some receivers in this family
// refuse writes on 0xFF02 (a Compx 3554:fa09 receiver, which also has 0xFF04). Untested on one.
function commandChannels(logicalDevice) {
  const main = findChannel(logicalDevice, USAGE_PAGE_COMMAND);
  const others = logicalDevice.channels.filter((c) => c !== main && c.usagePage >= 0xff00);
  return main ? [main, ...others] : [];
}

async function readBattery(logicalDevice) {
  const channels = commandChannels(logicalDevice);
  if (!channels.length) throw new Error('no command channel');
  let lastError = null;
  for (const channel of channels) {
    try {
      return await readFrom(channel);
    } catch (e) {
      if (!/cannot write/i.test(e.message)) throw e;
      lastError = e;
    }
  }
  throw lastError;
}

async function readFrom(channel) {
  const dev = await session.acquire(channel.path);
  await session.readQueued(channel.path, dev); // a late reply to an old request is stale

  // Ask whether the receiver has the mouse, and for the battery only while it says yes. A battery
  // request makes the receiver try to reach the mouse, and while it tries, its status answer can say
  // "connected" for a mouse that is asleep or off (seen on a VXE R1 Pro), so the status question goes
  // on until the battery answers. A receiver that never answers it gets the battery request anyway.
  const deadline = Date.now() + RESPONSE_TIMEOUT_MS;
  let nextPoke = 0;
  let pokes = 0;
  let connected = null; // the latest status answer
  let offInARow = 0;
  while (Date.now() < deadline) {
    if (Date.now() >= nextPoke) {
      await dev.write(STATUS_REQUEST);
      if (connected || (connected === null && pokes > 0)) await dev.write(BATTERY_REQUEST);
      pokes += 1;
      nextPoke = Date.now() + REPOKE_MS;
    }
    const frame = await session.read(channel.path, dev, READ_SLICE_MS);
    const reading = parseFrame(frame);
    if (reading) return reading;
    const status = parseStatus(frame);
    if (status === true) {
      if (!connected) nextPoke = 0; // ask for the battery straight away
      connected = true;
      offInARow = 0;
    } else if (status === false) {
      connected = false;
      if (++offInARow >= OFF_ANSWERS) throw new Error('mouse is off');
    }
  }
  throw new Error('timeout waiting for battery response');
}

// The mouse reappears under another product id while charging over its cable.
module.exports = { id: 'kysona', hasWiredIdentity: true, matches, parseFrame, parseStatus, readBattery };

// Calibrated driver for devices with no known protocol.
// A "profile" is produced by the in-app calibration wizard (Discover screen) and
// tells us exactly how to turn one raw byte into a battery percentage.
//
// profile shape:
// {
//   usagePage: number,            channel to talk to
//   usage: number,                collection on that page (absent in older profiles)
//   reportKind: 'feature' | 'input',
//   reportId: number,
//   readLength: number,           bytes to request for feature reads
//   trigger: number[] | null,     bytes to write before reading (input mode only)
//   byteOffset: number,           index into the raw response array (reportId included at [0])
//   scaleMin: number,             raw value that means 0%
//   scaleMax: number,             raw value that means 100%
// }
const { findChannel } = require('../catalog');
const { toPercent, frameToReading } = require('../scale');
const session = require('../session');

const INPUT_TIMEOUT_MS = 8000;
const READ_SLICE_MS = 100;

function matching(frame, profile) {
  return frame[0] === profile.reportId ? frameToReading(frame, profile) : null;
}

async function readInput(path, dev, profile) {
  // The handle stays open between polls, so a frame broadcast since the last one is waiting.
  let latest = null;
  for (const frame of await session.readQueued(path, dev)) {
    latest = matching(frame, profile) || latest;
  }
  if (latest) return latest;

  // Optionally nudge the device, then wait. Many wireless devices broadcast the frame on their
  // own and reject writes ("Cannot write to hid device"), so a failed trigger must NOT abort
  // the read.
  if (profile.trigger) await dev.write(profile.trigger).catch(() => {});

  const deadline = Date.now() + INPUT_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const reading = matching(await session.read(path, dev, READ_SLICE_MS), profile);
    if (reading) return reading;
  }
  throw new Error('timeout waiting for device response');
}

async function readBattery(logicalDevice, profile) {
  const channel = findChannel(logicalDevice, profile.usagePage, profile.usage);
  if (!channel) throw new Error('calibrated channel not present on this device');

  const dev = await session.acquire(channel.path);
  if (profile.reportKind !== 'feature') return readInput(channel.path, dev, profile);

  const report = await session.getFeatureReport(channel.path, dev, profile.reportId, profile.readLength);
  const reading = frameToReading(report, profile);
  if (!reading) throw new Error('waiting for device to report');
  return reading;
}

module.exports = { id: 'generic', toPercent, readBattery };

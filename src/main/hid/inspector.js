// Live capture used by the calibration wizard: watches every channel of a device for a while
// and returns each distinct frame seen, so the user can point at the byte that holds battery.
//
// Vendor-defined collections (usagePage >= 0xFF00) get the full treatment: listen for input
// frames AND write output pings, because that is where battery usually lives and where
// writing is safe. Standard collections (mouse/keyboard, usagePage < 0xFF00) are probed
// READ-ONLY with feature reports: no writes, and no input listening, which would flood with
// movement data. This gives devices with no vendor collection, or that reject writes
// ("Cannot write to hid device"), a fallback path.
//
// Handles stay open afterwards (see session.js); hid-client recycles this worker once the
// capture ends.
const session = require('./session');

const CAPTURE_MS = 30000; // 30s scan window — long enough for the user to power-cycle the
                          // device so event-driven models emit their battery frame
const FEATURE_POLL_MS = 800;
const PING_MS = 1000;
const READ_SLICE_MS = 100;
const FEATURE_IDS_TO_TRY = [1, 2, 3, 4, 5, 6, 7, 8];
const FEATURE_LENGTHS_TO_TRY = [8, 16, 32];
const VENDOR_USAGE_PAGE_MIN = 0xFF00;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function frameKey(channel, reportKind, reportId, hex) {
  return `${channel.usagePage}:${channel.usage}:${reportKind}:${reportId}:${hex}`;
}

async function capture(logicalDevice, { pingOutputs = true } = {}) {
  const frames = new Map(); // key -> frame (dedup identical repeats, keep latest timestamp + count)
  const deadline = Date.now() + CAPTURE_MS;

  function record(channel, reportKind, reportId, bytes) {
    const arr = Array.from(bytes);
    const hex = arr.map((b) => b.toString(16).padStart(2, '0')).join(' ');
    const key = frameKey(channel, reportKind, reportId, hex);
    const existing = frames.get(key);
    if (existing) {
      existing.count += 1;
      existing.lastSeen = Date.now();
    } else {
      frames.set(key, {
        usagePage: channel.usagePage, usage: channel.usage, reportKind, reportId,
        bytes: arr, hex, count: 1, firstSeen: Date.now(), lastSeen: Date.now(),
      });
    }
  }

  async function readFeature(channel, dev, id, len) {
    try {
      record(channel, 'feature', id, await dev.getFeatureReport(id, len));
      return true;
    } catch (_) {
      return false; // most id/length combos are invalid for a given collection
    }
  }

  async function watchChannel(channel) {
    let dev;
    try {
      dev = await session.acquire(channel.path);
    } catch (_) {
      return; // OS often holds standard input channels exclusively; skip those
    }
    const isVendor = channel.usagePage >= VENDOR_USAGE_PAGE_MIN;
    let listening = isVendor;

    // Sweep once, then only re-poll the reports this collection actually has.
    const supported = [];
    for (const id of FEATURE_IDS_TO_TRY) {
      for (const len of FEATURE_LENGTHS_TO_TRY) {
        if (await readFeature(channel, dev, id, len)) supported.push([id, len]);
      }
    }

    let nextFeaturePoll = Date.now() + FEATURE_POLL_MS;
    let nextPing = 0;
    while (Date.now() < deadline) {
      if (pingOutputs && isVendor && Date.now() >= nextPing) {
        await dev.write(Buffer.alloc(17, 0)).catch(() => {});
        nextPing = Date.now() + PING_MS;
      }
      if (Date.now() >= nextFeaturePoll) {
        for (const [id, len] of supported) await readFeature(channel, dev, id, len);
        nextFeaturePoll = Date.now() + FEATURE_POLL_MS;
      }
      if (!listening) {
        await sleep(READ_SLICE_MS);
        continue;
      }
      try {
        const frame = Array.from(await dev.read(READ_SLICE_MS));
        if (frame.length > 0) record(channel, 'input', frame[0], frame);
      } catch (_) {
        listening = false; // some collections have no input reports; their feature reports still work
      }
    }
  }

  await Promise.all(logicalDevice.channels.map(watchChannel));
  return Array.from(frames.values()).sort((a, b) => b.lastSeen - a.lastSeen);
}

module.exports = { capture };

// Live capture used by the calibration wizard: opens every VENDOR-DEFINED channel of
// a device, polls feature reports and listens for input reports for a while, and
// returns every distinct frame seen so the user can point at the byte that looks
// like battery.
//
// Deliberately skips standard HID usage pages (mouse/keyboard/consumer-control/etc,
// usage page < 0xFF00): those are frequently owned by the OS input stack and probing
// them (especially writing to them) is more likely to misbehave or crash than to
// ever contain battery data, which vendors almost always tuck behind a private
// vendor-defined collection.
const HID = require('node-hid');

const CAPTURE_MS = 30000; // 30s scan window — long enough for the user to power-cycle the
                          // device so event-driven models emit their battery frame
const FEATURE_POLL_MS = 800;
const FEATURE_IDS_TO_TRY = [1, 2, 3, 4, 5, 6, 7, 8];
const FEATURE_LENGTHS_TO_TRY = [8, 16, 32];
const VENDOR_USAGE_PAGE_MIN = 0xFF00;

function frameKey(usagePage, reportKind, reportId, hex) {
  return `${usagePage}:${reportKind}:${reportId}:${hex}`;
}

async function capture(logicalDevice, { pingOutputs = true } = {}) {
  const frames = new Map(); // key -> frame (dedup identical repeats, keep latest timestamp + count)
  const handles = []; // { dev, channel }

  function record(usagePage, reportKind, reportId, bytes) {
    const arr = Array.from(bytes);
    const hex = arr.map((b) => b.toString(16).padStart(2, '0')).join(' ');
    const key = frameKey(usagePage, reportKind, reportId, hex);
    const existing = frames.get(key);
    if (existing) {
      existing.count += 1;
      existing.lastSeen = Date.now();
    } else {
      frames.set(key, { usagePage, reportKind, reportId, bytes: arr, hex, count: 1, firstSeen: Date.now(), lastSeen: Date.now() });
    }
  }

  // Open every channel we can. Vendor-defined collections (usagePage >= 0xFF00) get the
  // full treatment — listen for input frames AND write output pings — because that's where
  // battery usually lives and where writing is safe. Standard collections (mouse/keyboard,
  // usagePage < 0xFF00) are probed READ-ONLY (feature reports only, no writes, no input
  // listening which would flood with movement data). This gives devices that don't expose a
  // vendor collection, or that reject writes ("Cannot write to hid device"), a fallback path.
  for (const channel of logicalDevice.channels) {
    let dev;
    try {
      dev = new HID.HID(channel.path);
    } catch (e) {
      continue; // OS often holds standard input channels exclusively; skip those
    }
    const isVendor = channel.usagePage >= VENDOR_USAGE_PAGE_MIN;
    handles.push({ dev, channel, isVendor });

    dev.on('error', () => {});
    if (isVendor) {
      dev.on('data', (data) => record(channel.usagePage, 'input', data[0], data));
    }

    for (const id of FEATURE_IDS_TO_TRY) {
      for (const len of FEATURE_LENGTHS_TO_TRY) {
        try {
          const fr = dev.getFeatureReport(id, len);
          record(channel.usagePage, 'feature', id, fr);
        } catch (_) {
          // most id/length combos are invalid for a given collection; that's expected
        }
      }
    }
  }

  if (pingOutputs) {
    const pingTimer = setInterval(() => {
      for (const { dev, isVendor } of handles) {
        if (!isVendor) continue; // never write to OS-owned standard channels
        try {
          dev.write(Buffer.alloc(17, 0));
        } catch (_) {}
      }
    }, 1000);
    setTimeout(() => clearInterval(pingTimer), CAPTURE_MS);
  }

  const featureTimer = setInterval(() => {
    for (const { dev, channel } of handles) {
      for (const id of FEATURE_IDS_TO_TRY) {
        for (const len of FEATURE_LENGTHS_TO_TRY) {
          try {
            const fr = dev.getFeatureReport(id, len);
            record(channel.usagePage, 'feature', id, fr);
          } catch (_) {}
        }
      }
    }
  }, FEATURE_POLL_MS);

  await new Promise((r) => setTimeout(r, CAPTURE_MS));
  clearInterval(featureTimer);

  for (const { dev } of handles) {
    try { dev.close(); } catch (_) {}
  }

  return Array.from(frames.values()).sort((a, b) => b.lastSeen - a.lastSeen);
}

module.exports = { capture };

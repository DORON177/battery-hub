// Calibrated driver for devices with no known protocol.
// A "profile" is produced by the in-app calibration wizard (Discover screen) and
// tells us exactly how to turn one raw byte into a battery percentage.
//
// profile shape:
// {
//   usagePage: number,            channel to talk to
//   reportKind: 'feature' | 'input',
//   reportId: number,
//   readLength: number,           bytes to request for feature reads
//   trigger: number[] | null,     bytes to write before reading (input mode only)
//   byteOffset: number,           index into the raw response array (reportId included at [0])
//   scaleMin: number,             raw value that means 0%
//   scaleMax: number,             raw value that means 100%
// }
const HID = require('node-hid');
const { findChannel } = require('../catalog');

function toPercent(raw, profile) {
  const { scaleMin, scaleMax } = profile;
  if (scaleMax === scaleMin) return Math.max(0, Math.min(100, raw));
  const pct = ((raw - scaleMin) / (scaleMax - scaleMin)) * 100;
  return Math.max(0, Math.min(100, Math.round(pct)));
}

function readBattery(logicalDevice, profile) {
  return new Promise((resolve, reject) => {
    const channel = findChannel(logicalDevice, profile.usagePage);
    if (!channel) return reject(new Error('calibrated channel not present on this device'));

    let dev;
    try {
      dev = new HID.HID(channel.path);
    } catch (e) {
      return reject(e);
    }

    if (profile.reportKind === 'feature') {
      try {
        const fr = dev.getFeatureReport(profile.reportId, profile.readLength);
        dev.close();
        const raw = fr[profile.byteOffset];
        return resolve({ capacity: toPercent(raw, profile), charging: null, voltageMv: null });
      } catch (e) {
        dev.close();
        return reject(e);
      }
    }

    // input-report mode: optionally nudge the device with a trigger write, then wait for a
    // matching frame. Many wireless devices broadcast the frame on their own and reject
    // writes, so a failed trigger must NOT abort the read — we keep listening either way.
    let settled = false;
    const finish = (err, result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      // Settle first, then tear down outside this (possibly 'data') callback — closing a
      // node-hid device from inside its own event handler corrupts the heap on Windows.
      if (err) reject(err); else resolve(result);
      setImmediate(() => {
        try { dev.removeAllListeners('data'); } catch (_) {}
        try { dev.removeAllListeners('error'); } catch (_) {}
        try { dev.close(); } catch (_) {}
      });
    };

    dev.on('data', (data) => {
      const arr = Array.from(data);
      if (arr[0] === profile.reportId) {
        const raw = arr[profile.byteOffset];
        finish(null, { capacity: toPercent(raw, profile), charging: null, voltageMv: null });
      }
    });
    dev.on('error', () => {}); // ignore transient read errors; the timeout is the backstop

    const timer = setTimeout(() => finish(new Error('timeout waiting for device response')), 8000);

    if (profile.trigger) {
      // Best-effort nudge. If the device rejects writes ("Cannot write to hid device") we
      // swallow it and rely on the device broadcasting the frame on its own.
      try { dev.write(profile.trigger); } catch (_) {}
    }
  });
}

module.exports = { id: 'generic', toPercent, readBattery };

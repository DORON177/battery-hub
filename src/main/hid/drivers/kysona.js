// Battery protocol for VXE / Kysona-family wireless mice (shared OEM firmware).
// Reverse-engineered from Linux's in-tree driver: drivers/hid/hid-kysona.c
// Request: report 0x08, subcommand 0x04 (BATTERY_REPORT_ID), fixed trailing checksum 0x49.
// Response arrives async on the same 0xFF02 collection:
//   byte[6]  = capacity percent (0-100)
//   byte[7]  = charging flag (0/1)
//   byte[8-9] = voltage in mV, big-endian
const HID = require('node-hid');
const { findChannel } = require('../catalog');

const USAGE_PAGE_COMMAND = 0xFF02;
const BATTERY_REQUEST = [0x08, 0x04, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x49];
const RESPONSE_TIMEOUT_MS = 4000;
const REPOKE_MS = 500; // this firmware often ignores a single request; poke until it answers

const KNOWN_VENDOR_IDS = new Set([0x3554]); // VXE

function matches(logicalDevice) {
  if (!KNOWN_VENDOR_IDS.has(logicalDevice.vendorId)) return false;
  return !!findChannel(logicalDevice, USAGE_PAGE_COMMAND);
}

function readBattery(logicalDevice) {
  return new Promise((resolve, reject) => {
    const channel = findChannel(logicalDevice, USAGE_PAGE_COMMAND);
    if (!channel) return reject(new Error('no command channel'));

    let dev;
    try {
      dev = new HID.HID(channel.path);
    } catch (e) {
      return reject(e);
    }

    let settled = false;
    let poke = null;
    let timer = null;
    const finish = (err, result) => {
      if (settled) return;
      settled = true;
      if (poke) clearInterval(poke);
      if (timer) clearTimeout(timer);
      // Settle the promise first, then tear the device down OUTSIDE the current callback
      // stack. Calling dev.close() from inside node-hid's own 'data'/'error' handler
      // corrupts the process heap on Windows (crash signature WER 0xc0000374); detaching
      // listeners and deferring the close with setImmediate avoids that race.
      if (err) reject(err); else resolve(result);
      setImmediate(() => {
        try { dev.removeAllListeners('data'); } catch (_) {}
        try { dev.removeAllListeners('error'); } catch (_) {}
        try { dev.close(); } catch (_) {}
      });
    };

    dev.on('data', (data) => {
      const arr = Array.from(data);
      if (arr[0] === 0x08 && arr[1] === 0x04) {
        const capacity = arr[6];
        const charging = !!arr[7];
        const voltageMv = (arr[8] << 8) | arr[9];
        // firmware sends a zeroed "not ready yet" frame sometimes; keep waiting for a real one
        if (capacity > 0 && capacity <= 100) {
          finish(null, { capacity, charging, voltageMv });
        }
      }
    });
    dev.on('error', (e) => finish(e));

    const sendRequest = () => {
      try {
        dev.write(BATTERY_REQUEST);
      } catch (e) {
        finish(e);
      }
    };

    sendRequest();
    poke = setInterval(sendRequest, REPOKE_MS);
    timer = setTimeout(() => finish(new Error('timeout waiting for battery response')), RESPONSE_TIMEOUT_MS);
  });
}

module.exports = { id: 'kysona', matches, readBattery };

// Battery protocol for the MCHOSE V9 Turbo+ wireless headset (VID 0x3837 / PID 0x600A).
// Ported from the user's working Python (hidapi) widget.
//
// This device is EVENT-DRIVEN, not poll-on-demand: it does not answer a battery query
// synchronously. Instead it spontaneously emits an input frame beginning with 0x55
// whenever something changes — the battery level ticks up/down, or the headset is
// powered off/on. (The vendor firmware ignores our output writes; hidapi returns -1 on
// every interface, which is why polling never gets a reply.) So the correct model is to
// hold the channels open continuously and cache the latest value, which is what the
// user's Python widget does with its forever read-loop.
//
// Frame layout:
//   byte[0] == 0x55   marks a battery frame
//   byte[2]           battery level
//     0        -> headset off / disconnected
//     1, 2, 4  -> transient status frames the firmware interleaves; ignore
//     else     -> battery percentage (0-100)
const VENDOR_ID = 0x3837;
const PRODUCT_ID = 0x600a;
const SKIP_LEVELS = new Set([1, 2, 4]);

function matches(logicalDevice) {
  return logicalDevice.vendorId === VENDOR_ID && logicalDevice.productId === PRODUCT_ID;
}

// Turn one raw input frame into a reading, or null if it isn't a usable battery frame.
function parseFrame(arr) {
  if (arr[0] !== 0x55) return null;
  const level = arr[2];
  if (level === 0) return null;
  if (SKIP_LEVELS.has(level)) return null;
  if (level < 0 || level > 100) return null;
  return { capacity: level, charging: null, voltageMv: null, raw: arr };
}

module.exports = { id: 'mchose', eventDriven: true, matches, parseFrame };

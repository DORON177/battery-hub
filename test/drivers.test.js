const test = require('node:test');
const assert = require('node:assert');
const mchose = require('../src/main/hid/drivers/mchose');
const { toPercent } = require('../src/main/hid/scale');

// ---------- MCHOSE V9 Turbo+ headset frame parsing ----------
// Frame: byte[0] === 0x55 marks a battery frame, byte[2] is the level.

const frame = (b0, b2) => [b0, 0x00, b2, 0x00];

test('mchose: matches only its own VID/PID', () => {
  assert.equal(mchose.matches({ vendorId: 0x3837, productId: 0x600a }), true);
  assert.equal(mchose.matches({ vendorId: 0x3837, productId: 0x0001 }), false);
  assert.equal(mchose.matches({ vendorId: 0x0000, productId: 0x600a }), false);
});

test('mchose: parses a battery frame', () => {
  assert.deepEqual(mchose.parseFrame(frame(0x55, 87)), {
    capacity: 87, charging: null, voltageMv: null, raw: frame(0x55, 87),
  });
});

test('mchose: ignores frames that are not battery frames', () => {
  assert.equal(mchose.parseFrame(frame(0x56, 87)), null);
});

test('mchose: treats level 0 as off/disconnected, not 0%', () => {
  assert.equal(mchose.parseFrame(frame(0x55, 0)), null);
});

test('mchose: skips the transient status levels the firmware interleaves', () => {
  for (const level of [1, 2, 4]) {
    assert.equal(mchose.parseFrame(frame(0x55, level)), null, `level ${level} should be skipped`);
  }
  assert.equal(mchose.parseFrame(frame(0x55, 3)).capacity, 3, '3 is a real level, not transient');
});

test('mchose: rejects out-of-range levels', () => {
  assert.equal(mchose.parseFrame(frame(0x55, 101)), null);
});

// ---------- calibrated (generic) scaling ----------

test('toPercent: maps a raw byte across the calibrated range', () => {
  const profile = { scaleMin: 0, scaleMax: 200 };
  assert.equal(toPercent(0, profile), 0);
  assert.equal(toPercent(100, profile), 50);
  assert.equal(toPercent(200, profile), 100);
});

test('toPercent: handles a non-zero scaleMin', () => {
  const profile = { scaleMin: 100, scaleMax: 200 };
  assert.equal(toPercent(150, profile), 50);
});

test('toPercent: clamps values outside the calibrated range', () => {
  const profile = { scaleMin: 0, scaleMax: 100 };
  assert.equal(toPercent(-5, profile), 0);
  assert.equal(toPercent(255, profile), 100);
});

test('toPercent: falls back to a clamped passthrough when the range is degenerate', () => {
  const profile = { scaleMin: 50, scaleMax: 50 };
  assert.equal(toPercent(42, profile), 42);
  assert.equal(toPercent(160, profile), 100);
});

test('toPercent: rounds to a whole percent', () => {
  assert.equal(toPercent(1, { scaleMin: 0, scaleMax: 3 }), 33);
});

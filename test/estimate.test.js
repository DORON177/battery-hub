const test = require('node:test');
const assert = require('node:assert');
const { estimateHoursLeft } = require('../src/renderer/estimate');

const HOUR = 3600000;
const NOW = 1_700_000_000_000; // fixed, so intervals are exact (Date.now() per row would drift)
// Build history going back from NOW, oldest first. Each entry: [hoursAgo, capacity, charging]
const hist = (rows) => rows.map(([hoursAgo, c, ch = 0]) => ({ t: NOW - hoursAgo * HOUR, c, ch }));

test('returns null without enough data', () => {
  assert.equal(estimateHoursLeft(null, 50), null);
  assert.equal(estimateHoursLeft([], 50), null);
  assert.equal(estimateHoursLeft(hist([[1, 90]]), 90), null, 'a single point is not an interval');
});

test('returns null when current capacity is unknown', () => {
  assert.equal(estimateHoursLeft(hist([[10, 90], [0, 50]]), null), null);
  assert.equal(estimateHoursLeft(hist([[10, 90], [0, 50]]), undefined), null);
});

test('computes hours left from the average discharge rate', () => {
  // 20% lost over 10h => 2%/h. At 50% => 25h left.
  assert.equal(estimateHoursLeft(hist([[10, 70], [0, 50]]), 50), 25);
});

test('averages across all discharge intervals, not just the last one', () => {
  // 10% over 5h, then 10% over 5h => 20% / 10h = 2%/h. At 40% => 20h.
  assert.equal(estimateHoursLeft(hist([[10, 60], [5, 50], [0, 40]]), 40), 20);
});

test('ignores intervals that touch a charge', () => {
  // The 90->60 drop is marked charging and must be skipped; only 60->50 over 5h (2%/h) counts.
  const h = hist([[20, 90, 1], [10, 60, 1], [5, 60], [0, 50]]);
  assert.equal(estimateHoursLeft(h, 50), 25);
});

test('counts flat time but ignores rising intervals', () => {
  // Rising 80->85 is skipped. Flat 80->80 and 85->85 count, so 85->75 is 10% over 15h.
  const h = hist([[20, 80], [15, 80], [10, 85], [5, 85], [0, 75]]);
  assert.equal(estimateHoursLeft(h, 50), 75);
});

test('does not inflate the rate when drops are separated by flat heartbeats', () => {
  // Real history shape: 1% lost every 2h, with a heartbeat every 20 min between drops.
  // That is 0.5%/h, so 50% is 100h. Counting only the drop intervals would report ~17h.
  const rows = [];
  let level = 70;
  for (let step = 0; step <= 120; step++) {
    if (step > 0 && step % 6 === 0) level -= 1;
    rows.push([40 - step / 3, level]);
  }
  const hours = estimateHoursLeft(hist(rows), 50);
  assert.ok(Math.abs(hours - 100) < 3, `expected ~100h, got ${hours}`);
});

test('ignores multi-day gaps where the device sat unused', () => {
  // A 100h gap is skipped (>72h); only the 2%/h interval counts.
  const h = hist([[105, 90], [5, 60], [0, 50]]);
  assert.equal(estimateHoursLeft(h, 50), 25);
});

test('returns null when the signal is too weak', () => {
  // Only a 1% drop -> below the 2% minimum.
  assert.equal(estimateHoursLeft(hist([[5, 51], [0, 50]]), 50), null);
  // A 5% drop but over only 6 minutes -> below the 0.25h minimum.
  assert.equal(estimateHoursLeft(hist([[0.1, 55], [0, 50]]), 50), null);
});

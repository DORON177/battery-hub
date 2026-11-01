const test = require('node:test');
const assert = require('node:assert');
const { drainRatePerHour, hasRecentReading, lastChargedAt, urgencyCompare } = require('../src/renderer/estimate');
const { moodFor } = require('../src/main/mood');

const HOUR = 3600000;
const NOW = 1_700_000_000_000;
const hist = (rows) => rows.map(([hoursAgo, c, ch = 0]) => ({ t: NOW - hoursAgo * HOUR, c, ch }));

function device(capacity, extra = {}) {
  return { id: String(capacity), lastReading: { capacity, charging: false }, lastReadingAt: NOW, online: true, ...extra };
}

test('urgent order: lowest draining first, then charging, then nothing to report', () => {
  const charging = device(5, { id: 'c', lastReading: { capacity: 5, charging: true } });
  const off = device(1, { id: 'o', online: false });
  const order = [off, charging, device(80), device(20)].sort(urgencyCompare).map((d) => d.id);
  assert.deepEqual(order, ['20', '80', 'c', 'o']);
});

test('tray mood follows the battery that most needs attention', () => {
  assert.equal(moodFor([{ capacity: 80 }, { capacity: 50 }]), 'full');
  assert.equal(moodFor([{ capacity: 80 }, { capacity: 22 }]), 'low');
  assert.equal(moodFor([{ capacity: 8 }, { capacity: 50, charging: true }]), 'sleep');
  assert.equal(moodFor([{ capacity: 80 }, { capacity: 50, charging: true }]), 'charge');
  assert.equal(moodFor([{ capacity: 5, offline: true }]), 'full');
});

test('drainRatePerHour reports the average drain', () => {
  assert.equal(drainRatePerHour(hist([[10, 70], [0, 50]])), 2);
  assert.equal(drainRatePerHour(hist([[1, 70]])), null);
  assert.equal(drainRatePerHour(undefined), null);
});

test('lastChargedAt finds the most recent charging point', () => {
  const h = hist([[30, 40, 1], [20, 90, 1], [10, 80], [0, 70]]);
  assert.equal(lastChargedAt(h), NOW - 20 * HOUR);
});

test('lastChargedAt treats a rise as charging for devices with no charging flag', () => {
  const h = hist([[30, 40], [20, 90], [10, 80], [0, 70]]);
  assert.equal(lastChargedAt(h), NOW - 20 * HOUR);
});

test('lastChargedAt is null when the battery only ever fell', () => {
  assert.equal(lastChargedAt(hist([[10, 80], [0, 70]])), null);
  assert.equal(lastChargedAt(undefined), null);
});

test('hasRecentReading covers the seven days of history that is kept', () => {
  assert.equal(hasRecentReading({ lastReadingAt: NOW - 6 * 24 * HOUR }, NOW), true);
  assert.equal(hasRecentReading({ lastReadingAt: NOW - 8 * 24 * HOUR }, NOW), false);
  assert.equal(hasRecentReading({}, NOW), false);
});

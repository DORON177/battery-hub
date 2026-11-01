const test = require('node:test');
const assert = require('node:assert');
const { drainRatePerHour, hasRecentReading, lastChargedAt, summarize } = require('../src/renderer/estimate');

const HOUR = 3600000;
const NOW = 1_700_000_000_000;
const hist = (rows) => rows.map(([hoursAgo, c, ch = 0]) => ({ t: NOW - hoursAgo * HOUR, c, ch }));

function device(capacity, extra = {}) {
  return { id: String(capacity), lastReading: { capacity, charging: false }, lastReadingAt: NOW, online: true, ...extra };
}
const summary = (devices) => summarize(devices, NOW);

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

test('summarize counts visible, connected and charging devices', () => {
  const s = summary([
    device(80),
    device(50, { lastReading: { capacity: 50, charging: true } }),
    device(30, { online: false, lastReading: { capacity: 30, charging: true } }),
    device(10, { hidden: true }),
  ]);
  assert.equal(s.total, 3);
  assert.equal(s.connected, 2);
  assert.equal(s.charging, 1, 'an offline device is not charging, whatever it last reported');
});

test('next to charge is the shortest time left, not the lowest level', () => {
  const slowDrain = device(30, { history: hist([[70, 37], [0, 30]]) });   // 0.1%/h => 300h
  const fastDrain = device(40, { history: hist([[10, 60], [0, 40]]) });   // 2%/h => 20h
  const s = summary([slowDrain, fastDrain]);
  assert.equal(s.next.device, fastDrain);
  assert.equal(s.next.hoursLeft, 20);
});

test('next to charge falls back to the level while a device is still learning', () => {
  const learning = device(14);
  const known = device(95, { history: hist([[10, 100], [0, 95]]) });
  assert.equal(summary([known, learning]).next.device, learning);
});

test('charging, offline, hidden and unread devices are never next to charge', () => {
  const s = summary([
    device(5, { lastReading: { capacity: 5, charging: true } }),
    device(6, { online: false }),
    device(7, { hidden: true }),
    { id: 'new', online: true },
  ]);
  assert.equal(s.next, null);
});

test('a reading older than the kept history never decides what to charge next', () => {
  const stale = device(10, { lastReadingAt: NOW - 98 * 24 * HOUR, history: hist([[2400, 20], [2352, 10]]) });
  const fresh = device(80);
  assert.equal(summary([stale, fresh]).next.device, fresh);
  assert.equal(summary([stale]).next, null);
});

test('hasRecentReading covers the seven days of history that is kept', () => {
  assert.equal(hasRecentReading({ lastReadingAt: NOW - 6 * 24 * HOUR }, NOW), true);
  assert.equal(hasRecentReading({ lastReadingAt: NOW - 8 * 24 * HOUR }, NOW), false);
  assert.equal(hasRecentReading({}, NOW), false);
});

test('summarize handles having no devices', () => {
  assert.deepEqual(summary([]), { total: 0, connected: 0, charging: 0, next: null });
});

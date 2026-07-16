const test = require('node:test');
const assert = require('node:assert');
const {
  pushHistory,
  HISTORY_MAX_POINTS,
  HISTORY_MAX_AGE_MS,
  HISTORY_MIN_GAP_MS,
} = require('../src/main/history');

const NOW = 1_700_000_000_000;

test('seeds an empty history', () => {
  assert.deepEqual(pushHistory(undefined, 80, false, NOW), [{ t: NOW, c: 80, ch: 0 }]);
  assert.deepEqual(pushHistory([], 80, true, NOW), [{ t: NOW, c: 80, ch: 1 }]);
});

test('records a point when the level changes', () => {
  const prev = [{ t: NOW - 1000, c: 80, ch: 0 }];
  assert.equal(pushHistory(prev, 79, false, NOW).length, 2);
});

test('de-duplicates an unchanged level within the heartbeat window', () => {
  const prev = [{ t: NOW - 1000, c: 80, ch: 0 }];
  assert.deepEqual(pushHistory(prev, 80, false, NOW), prev, 'no new point for a flat reading');
});

test('keeps a heartbeat point once the gap elapses', () => {
  const prev = [{ t: NOW - HISTORY_MIN_GAP_MS, c: 80, ch: 0 }];
  assert.equal(pushHistory(prev, 80, false, NOW).length, 2);
});

test('does not mutate the array it is given', () => {
  const prev = [{ t: NOW - 1000, c: 80, ch: 0 }];
  pushHistory(prev, 42, false, NOW);
  assert.equal(prev.length, 1);
});

test('prunes points older than the retention window', () => {
  const prev = [
    { t: NOW - HISTORY_MAX_AGE_MS - 1000, c: 99, ch: 0 }, // expired
    { t: NOW - 1000, c: 80, ch: 0 },
  ];
  const out = pushHistory(prev, 79, false, NOW);
  assert.ok(out.every((p) => p.t >= NOW - HISTORY_MAX_AGE_MS));
  assert.equal(out.length, 2);
});

test('caps the number of stored points, keeping the newest', () => {
  const prev = Array.from({ length: HISTORY_MAX_POINTS + 50 }, (_, i) => ({
    t: NOW - (HISTORY_MAX_POINTS + 50 - i) * 1000,
    c: 100,
    ch: 0,
  }));
  const out = pushHistory(prev, 99, false, NOW);
  assert.equal(out.length, HISTORY_MAX_POINTS);
  assert.equal(out[out.length - 1].c, 99, 'newest sample survives');
});

test('stores the charging flag as 0/1', () => {
  assert.equal(pushHistory([], 50, true, NOW)[0].ch, 1);
  assert.equal(pushHistory([], 50, false, NOW)[0].ch, 0);
});

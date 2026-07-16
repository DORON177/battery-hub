// Rolling per-device battery history.
//
// Kept dependency-free (no Electron / node-hid) so it can be unit-tested directly.

const HISTORY_MAX_POINTS = 300;
const HISTORY_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const HISTORY_MIN_GAP_MS = 20 * 60 * 1000;          // keep a heartbeat point every 20 min

// Append a capacity sample to a device's rolling history, de-duplicating flat stretches
// (only record when the level changed or ~20 min elapsed) and pruning old/oversized data.
function pushHistory(existing, capacity, charging, now) {
  const hist = Array.isArray(existing) ? existing.slice() : [];
  const last = hist[hist.length - 1];
  if (!last || last.c !== capacity || (now - last.t) >= HISTORY_MIN_GAP_MS) {
    hist.push({ t: now, c: capacity, ch: charging ? 1 : 0 });
  }
  const cutoff = now - HISTORY_MAX_AGE_MS;
  let pruned = hist.filter((p) => p.t >= cutoff);
  if (pruned.length > HISTORY_MAX_POINTS) pruned = pruned.slice(pruned.length - HISTORY_MAX_POINTS);
  return pruned;
}

module.exports = { pushHistory, HISTORY_MAX_POINTS, HISTORY_MAX_AGE_MS, HISTORY_MIN_GAP_MS };

// Battery maths behind the dashboard: time left, drain rate and the overview summary.
//
// Loaded as a plain script in the renderer (it defines globals that app.js and detail.js
// call) and required directly by the unit tests in Node — hence the guarded export at the
// bottom. Keep this file free of DOM/Electron references so both worlds can load it.

// Average drain in % per hour across the stored history: total % lost over the total time
// spent not charging. Flat intervals must count towards that time. History only records a
// point when the level changes or a ~20 min heartbeat passes, so a 1% drop is usually
// preceded by hours of flat heartbeats; counting only the interval containing the drop
// divides it by minutes and inflates the rate by an order of magnitude.
function drainRatePerHour(history) {
  if (!history || history.length < 2) return null;
  let totalDrop = 0;   // % of battery lost
  let totalHours = 0;  // over this many hours of real discharging
  for (let i = 1; i < history.length; i++) {
    const a = history[i - 1];
    const b = history[i];
    if (a.ch || b.ch) continue;             // ignore any interval touching a charge
    const drop = a.c - b.c;                 // positive => discharged, 0 => flat
    const hours = (b.t - a.t) / 3600000;
    if (drop < 0 || hours <= 0) continue;   // skip rising / bad-timestamp intervals
    if (hours > 72) continue;               // skip multi-day gaps (device off / unused)
    totalDrop += drop;
    totalHours += hours;
  }
  if (totalDrop < 2 || totalHours < 0.25) return null; // not enough signal yet
  return totalDrop / totalHours;
}

function estimateHoursLeft(history, currentCap) {
  if (currentCap == null) return null;
  const rate = drainRatePerHour(history);
  return rate ? currentCap / rate : null;
}

// When the device was last on charge. Devices without a charging flag show up as a rise.
function lastChargedAt(history) {
  if (!history) return null;
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].ch) return history[i].t;
    if (i > 0 && history[i].c > history[i - 1].c) return history[i].t;
  }
  return null;
}

// Older than the history we keep, the last reading says nothing about the battery today, so
// it must not feed estimates. Event-driven devices only report when something changes, which
// is why this can't just check whether the device is connected.
const RECENT_READING_MS = 7 * 24 * 3600000;

function hasRecentReading(device, now = Date.now()) {
  return !!device.lastReadingAt && now - device.lastReadingAt < RECENT_READING_MS;
}

function isOffline(device) {
  return device.online === false;
}

function isCharging(device) {
  return !!(device.lastReading && device.lastReading.charging) && !isOffline(device);
}

// Sort order for "most urgent first": draining devices lowest first, then charging, then
// devices with nothing to report. Ties keep the user's own order.
function urgencyCompare(a, b) {
  const rank = (d) => {
    if (isOffline(d)) return 3;
    if (!d.lastReading || typeof d.lastReading.capacity !== 'number') return 2;
    return isCharging(d) ? 1 : 0;
  };
  const level = (d) => (d.lastReading && d.lastReading.capacity) || 0;
  return rank(a) - rank(b) || level(a) - level(b) || (a.order ?? 1e9) - (b.order ?? 1e9);
}

// Node (tests) only — `module` is undefined in the browser, so this is a no-op there.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { drainRatePerHour, estimateHoursLeft, hasRecentReading, lastChargedAt, isOffline, isCharging, urgencyCompare };
}

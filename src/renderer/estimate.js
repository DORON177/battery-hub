// Battery "time left" estimate.
//
// Loaded as a plain script in the renderer (it defines a global that app.js calls)
// and required directly by the unit tests in Node — hence the guarded export at the
// bottom. Keep this file free of DOM/Electron references so both worlds can load it.

// Walk every discharge interval in the stored history and accumulate the total % lost
// against the real hours it took. Averaging across all of history (rather than the last
// couple of points) keeps the estimate steady and lets it survive app restarts.
function estimateHoursLeft(history, currentCap) {
  if (currentCap == null || !history || history.length < 2) return null;
  let totalDrop = 0;   // % of battery lost
  let totalHours = 0;  // over this many hours of real discharging
  for (let i = 1; i < history.length; i++) {
    const a = history[i - 1];
    const b = history[i];
    if (a.ch || b.ch) continue;             // ignore any interval touching a charge
    const drop = a.c - b.c;                 // positive => discharged
    const hours = (b.t - a.t) / 3600000;
    if (drop <= 0 || hours <= 0) continue;  // skip flat / rising / bad-timestamp intervals
    if (hours > 72) continue;               // skip multi-day gaps (device off / unused)
    totalDrop += drop;
    totalHours += hours;
  }
  if (totalDrop < 2 || totalHours < 0.25) return null; // not enough signal yet
  const ratePerHour = totalDrop / totalHours;
  if (ratePerHour <= 0) return null;
  return currentCap / ratePerHour;
}

// Node (tests) only — `module` is undefined in the browser, so this is a no-op there.
if (typeof module !== 'undefined' && module.exports) module.exports = { estimateHoursLeft };

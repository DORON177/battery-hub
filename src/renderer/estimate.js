// Battery "time left" estimate.
//
// Loaded as a plain script in the renderer (it defines a global that app.js calls)
// and required directly by the unit tests in Node — hence the guarded export at the
// bottom. Keep this file free of DOM/Electron references so both worlds can load it.

// Average the drain rate across the stored history: total % lost over the total time
// spent not charging. Flat intervals must count towards that time. History only records a
// point when the level changes or a ~20 min heartbeat passes, so a 1% drop is usually
// preceded by hours of flat heartbeats; counting only the interval containing the drop
// divides it by minutes and inflates the rate by an order of magnitude.
function estimateHoursLeft(history, currentCap) {
  if (currentCap == null || !history || history.length < 2) return null;
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
  const ratePerHour = totalDrop / totalHours;
  if (ratePerHour <= 0) return null;
  return currentCap / ratePerHour;
}

// Node (tests) only — `module` is undefined in the browser, so this is a no-op there.
if (typeof module !== 'undefined' && module.exports) module.exports = { estimateHoursLeft };

// Raw-byte -> battery-percentage conversion for calibrated ("generic") devices.
//
// The calibration wizard records scaleMin/scaleMax (the raw values meaning 0% and 100%);
// this maps a raw byte onto that range. Kept dependency-free (no native node-hid) so it
// can be unit-tested directly.
function toPercent(raw, profile) {
  const { scaleMin, scaleMax } = profile;
  if (scaleMax === scaleMin) return Math.max(0, Math.min(100, raw));
  const pct = ((raw - scaleMin) / (scaleMax - scaleMin)) * 100;
  return Math.max(0, Math.min(100, Math.round(pct)));
}

module.exports = { toPercent };

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

// Turn a raw report into a reading using a calibration profile, or null if the report can't
// be trusted. A report too short to contain the calibrated byte would otherwise produce NaN,
// and an all-zero payload is a device saying "not ready", not a battery at 0%.
function frameToReading(frame, profile) {
  const raw = frame[profile.byteOffset];
  if (typeof raw !== 'number') return null;
  if (frame.slice(1).every((b) => b === 0)) return null;
  return { capacity: toPercent(raw, profile), charging: null, voltageMv: null };
}

module.exports = { toPercent, frameToReading };

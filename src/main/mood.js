// Which face the tray shows: the state of the battery that most needs attention.
const SLEEP_AT = 10;
const LOW_AT = 25;

function moodFor(devices) {
  const live = devices.filter((d) => !d.offline && typeof d.capacity === 'number');
  const draining = live.filter((d) => !d.charging);
  const lowest = draining.length ? Math.min(...draining.map((d) => d.capacity)) : null;
  if (lowest != null && lowest <= SLEEP_AT) return 'sleep';
  if (lowest != null && lowest <= LOW_AT) return 'low';
  return live.some((d) => d.charging) ? 'charge' : 'full';
}

module.exports = { moodFor };

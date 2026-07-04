const { kysona, mchose, generic } = require('./hid/drivers');
const hidClient = require('./hid/hid-client');
const monitor = require('./monitor');
const store = require('./store');

let timer = null;
let polling = false; // guard: HID channels allow only one opener at a time, so never
                     // let an interval tick and a manual Refresh poll overlap.

// Short in-memory history of recent capacity readings per device, used to infer
// charging for devices that don't expose a hardware charging flag: a battery that
// climbs across consecutive readings is being charged.
const trend = new Map(); // id -> number[] (most recent last)
const TREND_LEN = 4;

function inferCharging(id, capacity) {
  const history = trend.get(id) || [];
  history.push(capacity);
  while (history.length > TREND_LEN) history.shift();
  trend.set(id, history);
  if (history.length < 2) return false;
  return history[history.length - 1] > history[0];
}

function driverFor(cfg) {
  if (cfg.driverId === 'kysona') return kysona;
  if (cfg.driverId === 'mchose') return mchose;
  return generic;
}

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

// Persist a fresh reading and push it to the renderer. Shared by the poll path and
// the event-driven monitor path.
function commitReading(id, reading, onUpdate) {
  const charging = reading.charging === null || reading.charging === undefined
    ? inferCharging(id, reading.capacity)
    : reading.charging;
  const cfg = store.getDevices()[id] || { id };
  const now = Date.now();
  const patch = {
    lastReading: { ...reading, charging },
    lastReadingAt: now,
    lastError: null,
    online: true,
    history: pushHistory(cfg.history, reading.capacity, charging, now),
  };
  store.upsertDevice(id, patch);
  onUpdate({ ...cfg, ...patch });
}

async function pollOnce(onUpdate, { force = false } = {}) {
  if (polling) return;
  polling = true;
  try {
    if (force) invalidateLiveCache(); // manual Refresh always re-scans USB
    await pollAllDevices(onUpdate);
  } finally {
    polling = false;
  }
}

function onHeadsetStatus(id, state, onUpdate) {
  let patch;
  if (state === 'disconnected') patch = { online: false, lastError: 'not connected' };
  else if (state === 'off') patch = { online: true, lastError: 'headset is off' };
  else if (state === 'python-missing') patch = { online: true, lastError: 'needs Python + hid module' };
  else patch = { online: true };
  store.upsertDevice(id, patch);
  onUpdate({ ...store.getDevices()[id] });
}

// Enumerating every HID device (HID.devices()) is one of the most crash-prone node-hid
// calls on Windows, so we don't re-scan USB every poll. A device's channel paths are
// stable while it stays plugged in, so we cache the scan and only refresh it periodically
// or when a read fails (which is when a path may have changed — e.g. the mouse switching
// to its wired charging identity).
const LIVE_TTL_MS = 5 * 60 * 1000;
let liveCache = null;
let liveCacheAt = 0;

async function getLiveDevices(force) {
  if (!force && liveCache && (Date.now() - liveCacheAt) < LIVE_TTL_MS) return liveCache;
  liveCache = await hidClient.enumerate();
  liveCacheAt = Date.now();
  return liveCache;
}
function invalidateLiveCache() { liveCache = null; }

// Resolve a pollable device to a reading. Tries the exact saved id plus any live sibling
// the same driver recognises (the mouse's wired charging identity), reading each until one
// answers. Returns { status: 'ok'|'no-candidates'|'error', ... }.
async function attemptRead(cfg, driver, liveList) {
  const exact = liveList.find((d) => d.id === cfg.id);
  const siblings = driver.matches
    ? liveList.filter((d) => d.id !== cfg.id && driver.matches(d))
    : [];
  const candidates = [exact, ...siblings].filter(Boolean);
  if (candidates.length === 0) return { status: 'no-candidates' };

  let lastError = null;
  for (const candidate of candidates) {
    try {
      const reading = await hidClient.readBattery(cfg.driverId, candidate, cfg.profile);
      return { status: 'ok', reading };
    } catch (e) {
      lastError = e;
    }
  }
  return { status: 'error', error: lastError };
}

async function pollAllDevices(onUpdate) {
  const saved = store.getDevices();
  let live = await getLiveDevices(false);
  let rescannedThisPoll = false; // force at most one fresh USB scan per poll

  for (const id of Object.keys(saved)) {
    const cfg = saved[id];
    if (cfg.hidden) continue;
    const driver = driverFor(cfg);

    // Event-driven devices (headset): a long-lived subprocess owns the connection and
    // pushes readings on its own schedule (self-manages connect/disconnect), so we just
    // make sure it's running and reflect the last known state — no on-demand poll.
    if (driver.eventDriven) {
      if (!monitor.isActive(id)) {
        monitor.start(
          id,
          (reading) => commitReading(id, reading, onUpdate),
          (state) => onHeadsetStatus(id, state, onUpdate)
        );
      }
      const dev = store.getDevices()[id];
      if (!dev.lastReading && !dev.lastError) {
        const patch = { online: true, lastError: 'waiting for headset update' };
        store.upsertDevice(id, patch);
        onUpdate({ ...store.getDevices()[id] });
      } else {
        onUpdate({ ...dev });
      }
      continue;
    }

    // Poll-based devices (mouse, calibrated generic). Try the cached USB scan first; if the
    // device can't be found or read, the cache may be stale (device reconnected, or the
    // mouse switched to its wired charging identity), so refresh the scan once and retry.
    let result = await attemptRead(cfg, driver, live);
    // Only re-scan when the device is MISSING from the cache (it may have reconnected or
    // switched to its wired charging identity). A read 'error' means we found it but it
    // didn't answer (e.g. the mouse is asleep) — re-scanning wouldn't help and would defeat
    // the cache every poll, so we leave it and keep the last-known value.
    if (result.status === 'no-candidates' && !rescannedThisPoll) {
      live = await getLiveDevices(true);
      rescannedThisPoll = true;
      result = await attemptRead(cfg, driver, live);
    }

    if (result.status === 'ok') {
      commitReading(id, result.reading, onUpdate);
    } else if (result.status === 'no-candidates') {
      trend.delete(id);
      const patch = { lastError: 'not connected', online: false };
      store.upsertDevice(id, patch);
      onUpdate({ ...cfg, ...patch });
    } else {
      const patch = { lastError: result.error.message, online: true };
      store.upsertDevice(id, patch);
      onUpdate({ ...cfg, ...patch });
    }
  }
}

function start(onUpdate) {
  stop();
  const intervalMs = Math.max(10, store.getPollIntervalSec()) * 1000;
  // A rejection here must never bubble up as an unhandledRejection (modern Node treats
  // that as fatal and would kill the whole app). Swallow + log; the next tick retries.
  const safePoll = () => pollOnce(onUpdate).catch((e) => console.error('poll cycle failed:', e && e.stack || e));
  safePoll();
  timer = setInterval(safePoll, intervalMs);
}

function stop() {
  if (timer) clearInterval(timer);
  timer = null;
  monitor.stopAll();
}

function restart(onUpdate) {
  start(onUpdate);
}

module.exports = { start, stop, restart, pollOnce };

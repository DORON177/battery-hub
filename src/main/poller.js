const { driverById, detectDriver } = require('./hid/drivers');
const { identityOf, routesOf, planMerges } = require('./identity');
const system = require('./system-batteries');
const hidClient = require('./hid/hid-client');
const monitor = require('./monitor');
const store = require('./store');
const { pushHistory } = require('./history');
const { isExpectedFailure } = require('./diagnostics');

// What drivers throw when a receiver or dongle reports the device itself is switched off.
const TURNED_OFF = /\bis off$/i;
// What they throw when a receiver or dongle got no answer from the device. Only a device that has
// answered before counts as off: one that never has may not speak the protocol at all.
const NOT_ANSWERING = /\bis not answering$/i;

let timer = null;
let polling = false; // guard: HID channels allow only one opener at a time, so never
                     // let an interval tick and a manual Refresh poll overlap.
let holds = 0;       // something else needs the devices to itself (a calibration scan)

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

// A read can take seconds, so the user may remove or hide a device while one is in flight.
// Writing the late result back would resurrect a removed device as a ghost entry, or put a
// hidden device's tray icon back.
function isTracked(id) {
  const cfg = store.getDevices()[id];
  return !!cfg && !cfg.hidden;
}

// Persist a fresh reading and push it to the renderer. Shared by the poll path and
// the event-driven monitor path.
function commitReading(id, reading, onUpdate) {
  if (!isTracked(id)) return;
  const charging = reading.charging === null || reading.charging === undefined
    ? inferCharging(id, reading.capacity)
    : reading.charging;
  const cfg = store.getDevices()[id] || { id };
  const now = Date.now();
  const patch = {
    lastReading: { ...reading, charging },
    lastReadingAt: now,
    lastError: null,
    failedReads: 0,
    online: true,
    history: pushHistory(cfg.history, reading.capacity, charging, now),
  };
  store.upsertDevice(id, patch);
  onUpdate({ ...cfg, ...patch });
}

// Run fn with polling held off, after any poll already in flight has finished. A poll during
// a calibration scan would swallow the frames the scan is listening for.
async function withPollingPaused(fn) {
  holds += 1;
  try {
    while (polling) await new Promise((r) => setTimeout(r, 50));
    return await fn();
  } finally {
    holds -= 1;
  }
}

async function pollOnce(onUpdate, { force = false } = {}) {
  if (polling || holds > 0) return;
  polling = true;
  try {
    if (force) {
      invalidateLiveCache(); // manual Refresh always re-scans USB
      await system.scan();
    }
    await pollAllDevices(onUpdate);
  } finally {
    polling = false;
  }
}

function onHeadsetStatus(id, state, onUpdate) {
  if (!isTracked(id)) return;
  let patch;
  if (state === 'connected') {
    patch = { online: true };
    if (store.getDevices()[id].lastError === 'not connected') patch.lastError = null;
  } else if (state === 'disconnected') patch = { online: false, lastError: 'not connected' };
  else if (state === 'off') patch = { online: false, lastError: 'headset is off' };
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
// answers. Returns { status: 'ok'|'no-candidates'|'stale'|'error', ... }.
async function attemptRead(cfg, driver, liveList) {
  const exact = liveList.find((d) => d.id === cfg.id);
  const siblings = driver.hasWiredIdentity
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
  // Couldn't reach the device at the path we cached: unplugged, or moved to another port.
  const stale = /cannot open|could not read|could not (get|send) feature report/i.test(lastError.message);
  return { status: stale ? 'stale' : 'error', error: lastError };
}

const identities = new Map(); // live device -> identity it reported, which needs a device read
let onCardsChanged = () => {};
const setCardsChangedHandler = (fn) => { onCardsChanged = fn; };

async function identityOfLive(device, driver) {
  const known = identityOf(device);
  if (known || !driver.needsIdentify) return known;
  const key = `${device.id}|${device.channels[0].path}`;
  if (!identities.has(key)) {
    try { identities.set(key, await hidClient.identify(driver.id, device)); } catch (_) { return null; }
  }
  return identities.get(key);
}

// Everything connected right now that can be read, as routes.
async function liveRoutes(live) {
  const routes = [];
  for (const device of live) {
    const driver = detectDriver(device);
    if (driver) routes.push({ id: device.id, driverId: driver.id, profile: null, identity: await identityOfLive(device, driver) });
  }
  for (const found of system.list()) routes.push({ id: found.id, driverId: 'system', profile: null, identity: identityOf(found) });
  return routes;
}

// Keeps one card per physical device: joins cards that turn out to be the same device, and
// attaches a new connection (plugging in the cable) to the card it belongs to.
async function reconcile(live) {
  const routes = await liveRoutes(live);
  for (const route of routes) {
    if (route.identity && store.getDevices()[route.id]) store.upsertDevice(route.id, { identity: route.identity });
  }
  let changed = false;
  for (const { keep, drop } of planMerges(store.getDevices())) {
    for (const card of drop) {
      store.mergeDevices(keep.id, card.id);
      trend.delete(card.id);
      onCardsChanged(card.id);
      changed = true;
    }
  }
  const claimed = new Set(Object.values(store.getDevices()).flatMap((c) => routesOf(c).map((r) => r.id)));
  for (const route of routes) {
    if (!route.identity || claimed.has(route.id)) continue;
    const card = Object.values(store.getDevices()).find((c) => identityOf(c) === route.identity);
    if (!card) continue;
    const { identity, ...link } = route;
    store.upsertDevice(card.id, { links: [...(card.links || []), link] });
    claimed.add(route.id);
    changed = true;
  }
  if (changed) onCardsChanged(null);
}

// True for a connected device that already belongs to a card, so Add device can leave it out.
function isClaimed(device) {
  const cards = Object.values(store.getDevices());
  if (cards.some((c) => routesOf(c).some((r) => r.id === device.id))) return true;
  const identity = identityOf(device);
  return !!identity && cards.some((c) => identityOf(c) === identity);
}

// Windows-reported batteries come from a watcher that keeps running.
function readWindowsRoute(route) {
  if (!system.hasScanned()) return { status: 'pending' };
  const found = system.get(route.id);
  if (found && found.connected) return { status: 'ok', reading: { capacity: found.capacity, charging: null } };
  return { status: 'no-candidates', remembered: found ? found.capacity : null };
}

function routeProfile(route) {
  if (route.driverId !== 'playstation') return route.profile;
  return { ...route.profile, quietBluetooth: !store.getSetting('controllerBluetooth') };
}

async function pollAllDevices(onUpdate) {
  let live = await getLiveDevices(false);
  await reconcile(live);
  const saved = store.getDevices();
  const usesWindows = Object.values(saved).some((c) => !c.hidden && routesOf(c).some((r) => system.isSystemId(r.id)));
  if (usesWindows) system.startWatching();
  else system.stopWatching();
  let rescannedThisPoll = false; // force at most one fresh USB scan per poll

  for (const id of Object.keys(saved)) {
    const cfg = saved[id];
    if (!isTracked(id)) continue;
    const routes = routesOf(cfg);

    // Event-driven devices (headset): a long-lived subprocess owns the connection and
    // pushes readings on its own schedule (self-manages connect/disconnect), so we just
    // make sure it's running and reflect the last known state — no on-demand poll.
    if (routes.length === 1 && driverById(cfg.driverId).eventDriven) {
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

    // Try each connection, best first, until one answers.
    let result = null;
    for (const route of routes) {
      let attempt;
      if (system.isSystemId(route.id)) {
        attempt = readWindowsRoute(route);
      } else {
        const driver = driverById(route.driverId);
        const target = { ...cfg, ...route, profile: routeProfile(route) };
        // Poll-based devices (mouse, calibrated generic). Try the cached USB scan first; if the
        // device can't be found or read, the cache may be stale (device reconnected, or the
        // mouse switched to its wired charging identity), so refresh the scan once and retry.
        attempt = await attemptRead(target, driver, live);
        // Only re-scan when the device is MISSING from the cache or its cached path no longer
        // works (it may have reconnected or switched to its wired charging identity). A read
        // 'error' means we found it but it didn't answer (e.g. the mouse is asleep) — re-scanning
        // wouldn't help and would defeat the cache every poll, so we leave it and keep the
        // last-known value.
        if ((attempt.status === 'no-candidates' || attempt.status === 'stale') && !rescannedThisPoll) {
          live = await getLiveDevices(true);
          rescannedThisPoll = true;
          attempt = await attemptRead(target, driver, live);
        }
      }
      if (attempt.status === 'ok') { result = attempt; break; }
      // "Found it but it didn't answer" says more than "isn't there".
      if (!result || result.status === 'no-candidates') result = { ...result, ...attempt };
    }

    if (result.status === 'pending') continue; // the first Windows scan is still running
    if (result.status === 'ok') {
      commitReading(id, result.reading, onUpdate);
    } else if (!isTracked(id)) {
      trend.delete(id);
    } else if (result.status === 'no-candidates') {
      trend.delete(id);
      // Windows remembers the last level of a sleeping device: better than an empty card.
      if (typeof result.remembered === 'number' && !store.getDevices()[id].lastReading) {
        commitReading(id, { capacity: result.remembered, charging: false }, () => {});
      }
      const patch = { lastError: 'not connected', online: false };
      store.upsertDevice(id, patch);
      onUpdate({ ...store.getDevices()[id] });
    } else if (TURNED_OFF.test(result.error.message)
      || (NOT_ANSWERING.test(result.error.message) && store.getDevices()[id].lastReadingAt)) {
      // Its receiver or dongle is there but the device isn't: off, or asleep for some brands.
      trend.delete(id);
      store.upsertDevice(id, { lastError: result.error.message, online: false, failedReads: 0 });
      onUpdate({ ...store.getDevices()[id] });
    } else {
      const saved = store.getDevices()[id];
      const expected = isExpectedFailure(result.error.message, Boolean(saved.lastReadingAt));
      const patch = { lastError: result.error.message, online: true, failedReads: expected ? 0 : (saved.failedReads || 0) + 1 };
      store.upsertDevice(id, patch);
      onUpdate({ ...store.getDevices()[id] });
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

module.exports = { start, stop, restart, pollOnce, withPollingPaused, isClaimed, setCardsChangedHandler };

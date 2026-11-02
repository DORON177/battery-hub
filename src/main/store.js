const Store = require('electron-store');

// Single source of truth for settings defaults — also merged in on read so a store written
// by an older version always gains any newly-added keys.
const DEFAULT_SETTINGS = {
  pollIntervalSec: 60,
  theme: 'system',          // 'system' | 'light' | 'dark'
  density: 'detailed',      // 'detailed' | 'compact'
  sortMode: 'urgent',       // 'urgent' | 'manual'
  reduceMotion: false,      // disable all UI animations/transitions
  notifyEnabled: true,
  notifyThreshold: 20,      // notify when battery drops below this %
  notifyCharging: true,     // notify when a device starts charging
  controllerBluetooth: true, // read PlayStation controllers over Bluetooth
  notifyCharged: false,     // notify when a device finishes charging
  trayEnabled: true,        // show tray battery icons
  trayMode: 'list',         // 'perDevice' | 'list'
  closeToTray: true,        // hide to tray instead of quitting on close
  launchAtLogin: false,
  startMinimized: false,
};

const store = new Store({
  name: 'battery-hub',
  defaults: {
    devices: {}, // id -> { id, product, manufacturer, driverId, profile, customName, order, hidden, lastReading, lastReadingAt, lastError }
    settings: { ...DEFAULT_SETTINGS },
  },
});

// Settings written before the redesign hold the old defaults; move those to the new ones once,
// so a choice made after this point is never overridden.
if (!store.get('uiV2')) {
  const { accent, ...old } = store.get('settings');
  store.set('settings', { ...old, trayMode: 'list' });
  store.set('uiV2', true);
}

// ---- devices ----
function getDevices() {
  return store.get('devices');
}
function upsertDevice(id, patch) {
  const devices = store.get('devices');
  devices[id] = { ...(devices[id] || {}), ...patch, id };
  store.set('devices', devices);
  return devices[id];
}
function removeDevice(id) {
  const devices = store.get('devices');
  delete devices[id];
  store.set('devices', devices);
}
// Folds one card into another when they turn out to be the same device.
function mergeDevices(keepId, dropId) {
  const devices = store.get('devices');
  const keep = devices[keepId];
  const drop = devices[dropId];
  if (!keep || !drop) return;
  const newest = (drop.lastReadingAt || 0) > (keep.lastReadingAt || 0) ? drop : keep;
  const history = [...(keep.history || []), ...(drop.history || [])].sort((a, b) => a.t - b.t);
  devices[keepId] = {
    ...keep,
    customName: keep.customName || drop.customName || null,
    customIcon: keep.customIcon || drop.customIcon || null,
    alertThreshold: keep.alertThreshold ?? drop.alertThreshold ?? null,
    product: /_/.test(keep.product || '') ? drop.product : keep.product, // "MX_Master_4"
    identity: keep.identity || drop.identity,
    order: Math.min(keep.order ?? 1e9, drop.order ?? 1e9),
    hidden: !!(keep.hidden && drop.hidden),
    lastReading: newest.lastReading,
    lastReadingAt: newest.lastReadingAt,
    history,
    links: [...(keep.links || []), { id: drop.id, driverId: drop.driverId, profile: drop.profile || null }, ...(drop.links || [])],
  };
  delete devices[dropId];
  store.set('devices', devices);
}

// Persist a user-chosen card order as a per-device index.
function reorderDevices(orderedIds) {
  const devices = store.get('devices');
  orderedIds.forEach((id, i) => { if (devices[id]) devices[id].order = i; });
  store.set('devices', devices);
  return devices;
}

// ---- settings ----
function getSettings() {
  // merge with defaults so newly-added keys are always present
  return { ...DEFAULT_SETTINGS, ...store.get('settings') };
}
function getSetting(key) {
  return getSettings()[key];
}
function setSettings(patch) {
  const settings = { ...getSettings(), ...patch };
  store.set('settings', settings);
  return settings;
}
function getPollIntervalSec() {
  return getSettings().pollIntervalSec;
}

module.exports = {
  getDevices, upsertDevice, removeDevice, mergeDevices, reorderDevices,
  getSettings, getSetting, setSettings,
  getPollIntervalSec,
};

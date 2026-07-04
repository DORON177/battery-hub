const Store = require('electron-store');

// Single source of truth for settings defaults — also merged in on read so a store written
// by an older version always gains any newly-added keys.
const DEFAULT_SETTINGS = {
  pollIntervalSec: 60,
  theme: 'system',          // 'system' | 'light' | 'dark'
  density: 'detailed',      // 'detailed' | 'compact'
  accent: '#0a84ff',        // accent color
  notifyEnabled: true,
  notifyThreshold: 20,      // notify when battery drops below this %
  notifyCharged: false,     // notify when a device finishes charging
  trayEnabled: true,        // show tray battery icons
  trayMode: 'perDevice',    // 'perDevice' | 'list'
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
  getDevices, upsertDevice, removeDevice, reorderDevices,
  getSettings, getSetting, setSettings,
  getPollIntervalSec,
};

const { Notification } = require('electron');
const path = require('path');
const store = require('./store');

const ICON = path.join(__dirname, '..', '..', 'assets', 'icon.png');

// Per-device memory so we notify once per threshold crossing, not every poll.
const wasLow = new Map();      // id -> boolean
const wasCharging = new Map(); // id -> boolean

function post(title, body) {
  if (!Notification.isSupported()) return;
  new Notification({ title, body, icon: ICON }).show();
}

function displayName(device) {
  return device.customName || device.product || 'Device';
}

// Called on every battery update; fires notifications on state transitions.
function check(device) {
  const reading = device.lastReading;
  if (!reading || device.online === false || typeof reading.capacity !== 'number') return;
  const s = store.getSettings();
  const cap = reading.capacity;
  const charging = !!reading.charging;
  const name = displayName(device);

  if (s.notifyEnabled) {
    const low = cap <= s.notifyThreshold && !charging;
    if (low && !wasLow.get(device.id)) {
      post('Low battery', `${name} is at ${cap}%. Time to charge.`);
    }
    wasLow.set(device.id, low);
  }

  if (s.notifyCharged) {
    if (wasCharging.get(device.id) && !charging && cap >= 95) {
      post('Fully charged', `${name} is charged (${cap}%).`);
    }
    wasCharging.set(device.id, charging);
  }
}

function reset(id) {
  wasLow.delete(id);
  wasCharging.delete(id);
}

module.exports = { check, reset };

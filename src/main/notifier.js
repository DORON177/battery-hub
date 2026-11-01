const { Notification } = require('electron');
const path = require('path');
const store = require('./store');

const ICON = path.join(__dirname, '..', '..', 'assets', 'icon.png');
const LOW_ICON = path.join(__dirname, '..', '..', 'assets', 'brand', 'mood-low.png');
const CHARGING_ICON = path.join(__dirname, '..', '..', 'assets', 'brand', 'mood-charge.png');
const CHARGING_QUIET_MS = 5 * 60000; // a loose cable must not turn into a stream of alerts

// Per-device memory so we notify once per threshold crossing, not every poll.
const wasLow = new Map();      // id -> boolean
const wasCharging = new Map(); // id -> boolean
const chargingAlertAt = new Map(); // id -> timestamp

// Every notification the app can send. The local test panel is built from this list.
const ALERTS = {
  low: (name, cap) => ({ title: 'Low battery', body: `${name} is at ${cap}%. Time to charge.`, icon: LOW_ICON }),
  charging: (name, cap) => ({ title: 'Charging', body: `${name} is charging (${cap}%).`, icon: CHARGING_ICON }),
  charged: (name, cap) => ({ title: 'Fully charged', body: `${name} is charged (${cap}%).`, icon: ICON }),
};

function post({ title, body, icon }) {
  if (!Notification.isSupported()) return;
  new Notification({ title, body, icon }).show();
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
      post(ALERTS.low(name, cap));
    }
    wasLow.set(device.id, low);
  }

  // Only a real change counts: a device already charging when the app starts stays quiet.
  const was = wasCharging.get(device.id);
  const now = Date.now();
  if (s.notifyCharging && was === false && charging && now - (chargingAlertAt.get(device.id) || 0) >= CHARGING_QUIET_MS) {
    chargingAlertAt.set(device.id, now);
    post(ALERTS.charging(name, cap));
  }
  if (s.notifyCharged && was && !charging && cap >= 95) {
    post(ALERTS.charged(name, cap));
  }
  wasCharging.set(device.id, charging);
}

function reset(id) {
  wasLow.delete(id);
  wasCharging.delete(id);
  chargingAlertAt.delete(id);
}

module.exports = { check, reset, post, ALERTS };

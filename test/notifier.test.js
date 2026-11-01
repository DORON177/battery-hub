const test = require('node:test');
const assert = require('node:assert');
const Module = require('node:module');

const sent = [];
let settings = {};
class Notification {
  constructor(options) { this.options = options; }
  static isSupported() { return true; }
  show() { sent.push(this.options); }
}

const load = Module._load;
Module._load = function (request, ...rest) {
  if (request === 'electron') return { Notification };
  if (request === './store') return { getSettings: () => settings };
  return load.call(this, request, ...rest);
};
const notifier = require('../src/main/notifier');
Module._load = load;

const device = (capacity, charging = false, extra = {}) => ({ id: 'd', product: 'Mouse', online: true, lastReading: { capacity, charging }, ...extra });

test.beforeEach(() => {
  sent.length = 0;
  settings = { notifyEnabled: true, notifyThreshold: 20, notifyCharging: true, notifyCharged: true };
  notifier.reset('d');
});

test('low battery fires once per crossing, and again after recovering', () => {
  [50, 20, 15, 10].forEach((c) => notifier.check(device(c)));
  assert.deepEqual(sent.map((n) => n.title), ['Low battery']);
  assert.match(sent[0].body, /Mouse is at 20%/);
  assert.match(sent[0].icon, /mood-low\.png$/);
  notifier.check(device(60));
  notifier.check(device(18));
  assert.equal(sent.length, 2);
});

test('low battery stays quiet while charging, offline or switched off', () => {
  notifier.check(device(10, true));
  notifier.check(device(10, false, { online: false }));
  settings.notifyEnabled = false;
  notifier.check(device(10));
  assert.equal(sent.length, 0);
});

test('charging fires when charging starts, only if enabled', () => {
  notifier.check(device(40));
  notifier.check(device(40, true));
  assert.deepEqual(sent.map((n) => n.title), ['Charging']);
  assert.match(sent[0].icon, /mood-charge\.png$/);
  notifier.reset('d');
  sent.length = 0;
  settings.notifyCharging = false;
  notifier.check(device(40));
  notifier.check(device(40, true));
  assert.equal(sent.length, 0);
});

test('a device already charging at startup stays quiet', () => {
  notifier.check(device(40, true));
  notifier.check(device(41, true));
  assert.equal(sent.length, 0);
});

test('a loose cable does not repeat the charging alert', () => {
  [40, 40].forEach((c) => { notifier.check(device(c)); notifier.check(device(c, true)); });
  assert.equal(sent.length, 1);
});

test('fully charged fires when charging ends near full, only if enabled', () => {
  settings.notifyCharging = false;
  notifier.check(device(90, true));
  notifier.check(device(97));
  assert.deepEqual(sent.map((n) => n.title), ['Fully charged']);
  sent.length = 0;
  notifier.check(device(90, true));
  notifier.check(device(80));
  assert.equal(sent.length, 0);
  settings.notifyCharged = false;
  notifier.check(device(90, true));
  notifier.check(device(97));
  assert.equal(sent.length, 0);
});

test('every alert has a title, a message and an icon', () => {
  for (const make of Object.values(notifier.ALERTS)) {
    const alert = make('Mouse', 50);
    assert.ok(alert.title && alert.body.includes('Mouse') && alert.icon);
  }
});

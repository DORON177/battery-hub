const test = require('node:test');
const assert = require('node:assert');
const Module = require('node:module');

// Replace the Electron/native-backed modules so the poller's logic runs in plain Node.
const devices = {};
const store = {
  getDevices: () => devices,
  upsertDevice: (id, patch) => { devices[id] = { ...(devices[id] || {}), ...patch, id }; return devices[id]; },
  getPollIntervalSec: () => 60,
};
let finishRead;
const hidClient = {
  enumerate: async () => [{ id: 'mouse' }],
  readBattery: () => new Promise((resolve, reject) => { finishRead = { resolve, reject }; }),
};
const monitor = { isActive: () => false, start() {}, stopAll() {} };
const drivers = { driverById: () => ({}), detectDriver: () => null };
const system = {
  scan: async () => [], list: () => [], get: () => null, hasScanned: () => true,
  startWatching() {}, stopWatching() {}, isSystemId: (id) => /^(bt|xinput):/.test(id),
};

const load = Module._load;
Module._load = function (request, ...rest) {
  if (request === './store') return store;
  if (request === './hid/hid-client') return hidClient;
  if (request === './monitor') return monitor;
  if (request === './hid/drivers') return drivers;
  if (request === './system-batteries') return system;
  return load.call(this, request, ...rest);
};
const poller = require('../src/main/poller');
Module._load = load;

const flush = async () => { for (let i = 0; i < 6; i++) await new Promise((r) => setImmediate(r)); };
const addMouse = () => { devices.mouse = { id: 'mouse', driverId: 'generic', product: 'Mouse' }; };

async function pollWithChangeMidRead(change, settle) {
  const updates = [];
  const done = poller.pollOnce((d) => updates.push(d), { force: true });
  await flush();
  change();
  settle();
  await done;
  return updates;
}

test('a reading that lands after removal does not resurrect the device', async () => {
  addMouse();
  const updates = await pollWithChangeMidRead(
    () => { delete devices.mouse; },
    () => finishRead.resolve({ capacity: 50, charging: false }),
  );
  assert.equal(devices.mouse, undefined);
  assert.equal(updates.length, 0);
});

test('a failed read that lands after removal does not resurrect the device', async () => {
  addMouse();
  await pollWithChangeMidRead(
    () => { delete devices.mouse; },
    () => finishRead.reject(new Error('timed out')),
  );
  assert.equal(devices.mouse, undefined);
});

test('a reading that lands after hiding is not broadcast', async () => {
  addMouse();
  const updates = await pollWithChangeMidRead(
    () => { devices.mouse.hidden = true; },
    () => finishRead.resolve({ capacity: 50, charging: false }),
  );
  assert.equal(updates.length, 0);
  assert.equal(devices.mouse.lastReading, undefined);
});

test('a card reads its direct connection first and falls back to Windows', async () => {
  devices.pad = { id: 'pad', driverId: 'generic', links: [{ id: 'bt:x', driverId: 'system', profile: null }] };
  const original = system.get;
  system.get = () => ({ capacity: 40, connected: true });
  hidClient.enumerate = async () => []; // the direct connection is gone
  await poller.pollOnce(() => {}, { force: true });
  system.get = original;
  hidClient.enumerate = async () => [{ id: 'mouse' }];
  assert.equal(devices.pad.lastReading.capacity, 40);
  delete devices.pad;
});

test('a card is offline only when every connection is gone', async () => {
  devices.pad = { id: 'pad', driverId: 'generic', links: [{ id: 'bt:x', driverId: 'system', profile: null }] };
  hidClient.enumerate = async () => [];
  await poller.pollOnce(() => {}, { force: true });
  hidClient.enumerate = async () => [{ id: 'mouse' }];
  assert.equal(devices.pad.online, false);
  delete devices.pad;
});

const failRead = (message) => pollWithChangeMidRead(() => {}, () => finishRead.reject(new Error(message)));

test('real read failures are counted, and a reading clears them', async () => {
  addMouse();
  await failRead('no command channel');
  await failRead('no command channel');
  assert.equal(devices.mouse.failedReads, 2);
  await pollWithChangeMidRead(() => {}, () => finishRead.resolve({ capacity: 50, charging: false }));
  assert.equal(devices.mouse.failedReads, 0);
});

test('a device that has never answered is counted, a sleeping one is not', async () => {
  addMouse();
  await failRead('timeout waiting for battery response');
  assert.equal(devices.mouse.failedReads, 1);
  devices.mouse.lastReadingAt = Date.now();
  await failRead('timeout waiting for battery response');
  assert.equal(devices.mouse.failedReads, 0);
  await failRead('mouse is off');
  assert.equal(devices.mouse.failedReads, 0);
});

test('a normal reading is still committed', async () => {
  addMouse();
  const updates = await pollWithChangeMidRead(
    () => {},
    () => finishRead.resolve({ capacity: 50, charging: false }),
  );
  assert.equal(devices.mouse.lastReading.capacity, 50);
  assert.equal(updates.length, 1);
});

test('a mouse its receiver reports as off keeps its normal look while it may only be napping', async () => {
  addMouse();
  await pollWithChangeMidRead(() => {}, () => finishRead.resolve({ capacity: 35, charging: false }));
  await failRead('mouse is off');
  assert.equal(devices.mouse.online, true, 'it answered a moment ago, so it is most likely napping');
  assert.equal(devices.mouse.failedReads, 0);
});

test('a mouse that has not answered for two minutes goes offline and keeps its last level', async () => {
  addMouse();
  await pollWithChangeMidRead(() => {}, () => finishRead.resolve({ capacity: 35, charging: false }));
  devices.mouse.lastReadingAt = Date.now() - 3 * 60000;
  await failRead('mouse is off');
  assert.equal(devices.mouse.online, false);
  assert.equal(devices.mouse.lastReading.capacity, 35);
  assert.equal(devices.mouse.failedReads, 0);
  await pollWithChangeMidRead(() => {}, () => finishRead.resolve({ capacity: 34, charging: false }));
  assert.equal(devices.mouse.online, true);
});

test('a device shown as away is not brought back by a read that only timed out', async () => {
  addMouse();
  await pollWithChangeMidRead(() => {}, () => finishRead.resolve({ capacity: 35, charging: false }));
  devices.mouse.lastReadingAt = Date.now() - 6 * 60000;
  await failRead('mouse is off');
  assert.equal(devices.mouse.online, false);
  await failRead('timeout waiting for battery response');
  assert.equal(devices.mouse.online, false, 'still away');
  assert.equal(devices.mouse.lastError, 'mouse is off');
  await failRead('Cannot write to hid device');
  assert.equal(devices.mouse.online, true, 'a different failure is reported as before');
});

test('what counts as away: headsets at once, mice and keyboards after a two-minute nap', () => {
  const now = 1_700_000_000_000;
  const ago = (minutes) => now - minutes * 60000;
  assert.equal(poller.isAway('headset is off', ago(0.1), now), true);
  assert.equal(poller.isAway('headset is not answering', ago(0.1), now), true);
  assert.equal(poller.isAway('mouse is off', ago(0.1), now), false);
  assert.equal(poller.isAway('device is not answering', ago(1.9), now), false);
  assert.equal(poller.isAway('device is not answering', ago(2), now), true);
  assert.equal(poller.isAway('mouse is off', undefined, now), true, 'never read and the receiver says off');
  assert.equal(poller.isAway('mouse is not answering', undefined, now), false, 'never read: keep it countable');
  assert.equal(poller.isAway('timeout waiting for battery response', ago(60), now), false);
  assert.equal(poller.isAway('Bluetooth reading is off in Settings', ago(60), now), false);
});

test('napping is the window between the last answer and counting as away', () => {
  const now = 1_700_000_000_000;
  const ago = (minutes) => now - minutes * 60000;
  assert.equal(poller.isNapping('mouse is off', ago(0.5), now), true);
  assert.equal(poller.isNapping('device is not answering', ago(1.9), now), true);
  assert.equal(poller.isNapping('mouse is off', ago(2), now), false, 'by now it counts as away');
  assert.equal(poller.isNapping('headset is off', ago(0.5), now), false, 'headsets do not nap');
  assert.equal(poller.isNapping('mouse is not answering', undefined, now), false, 'never answered: nothing to nap from');
  assert.equal(poller.isNapping('timeout waiting for battery response', ago(0.5), now), false);
});

test('a device that only times out stays online, since it may just be asleep', async () => {
  addMouse();
  devices.mouse.online = true;
  devices.mouse.lastReadingAt = Date.now();
  await failRead('timeout waiting for battery response');
  assert.equal(devices.mouse.online, true);
});

test('a device that stops answering through its dongle goes offline only if it answered before', async () => {
  addMouse();
  devices.mouse.online = true;
  delete devices.mouse.lastReadingAt;
  devices.mouse.failedReads = 0;
  await failRead('headset is not answering');
  assert.equal(devices.mouse.online, true, 'never read: it may not speak this protocol, so keep it countable');
  assert.equal(devices.mouse.failedReads, 1);
  await pollWithChangeMidRead(() => {}, () => finishRead.resolve({ capacity: 70, charging: false }));
  await failRead('headset is not answering');
  assert.equal(devices.mouse.online, false);
  assert.equal(devices.mouse.lastReading.capacity, 70);
  assert.equal(devices.mouse.failedReads, 0);
});

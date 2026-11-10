const test = require('node:test');
const assert = require('node:assert');
const Module = require('node:module');

// A scripted stand-in for node-hid's HIDAsync. reads holds what each dev.read() returns: an
// array is a frame, an Error rejects, and when it runs out the read times out with no data.
class FakeDevice {
  constructor() {
    this.reads = [];
    this.writes = 0;
    this.sent = []; // the command byte of each write
    this.closes = 0;
    this.writeError = null;
    this.feature = null;
    this.inFlight = 0;
    this.maxInFlight = 0;
  }

  async track(fn) {
    this.inFlight += 1;
    this.maxInFlight = Math.max(this.maxInFlight, this.inFlight);
    await new Promise((r) => setImmediate(r));
    this.inFlight -= 1;
    return fn();
  }

  read() {
    return this.track(() => {
      const next = this.reads.shift();
      if (next instanceof Error) throw next;
      return Buffer.from(next || []);
    });
  }

  write(bytes) {
    return this.track(() => {
      this.writes += 1;
      this.sent.push(bytes && bytes[1]);
      if (this.writeError) throw this.writeError;
      return 17;
    });
  }

  getFeatureReport() {
    return this.track(() => {
      if (this.featureError) throw this.featureError;
      return Buffer.from(this.feature);
    });
  }

  async close() { this.closes += 1; }
}

const devices = new Map();
let opens = 0;
let openError = null;
const fakeHid = {
  HIDAsync: {
    open: async (path) => {
      opens += 1;
      if (openError) throw openError;
      if (!devices.has(path)) devices.set(path, new FakeDevice());
      return devices.get(path);
    },
  },
};

const load = Module._load;
Module._load = function (request, ...rest) {
  if (request === 'node-hid') return fakeHid;
  return load.call(this, request, ...rest);
};
const kysona = require('../src/main/hid/drivers/kysona');
const generic = require('../src/main/hid/drivers/generic');
const { findChannel } = require('../src/main/hid/catalog');
Module._load = load;

let nextPath = 0;
function mouse() {
  const path = `mouse-${nextPath += 1}`;
  const dev = new FakeDevice();
  devices.set(path, dev);
  return { dev, path, logical: { channels: [{ path, usagePage: 0xff02, usage: 2 }] } };
}
const reply = (capacity, charging = 0) => [8, 4, 0, 0, 0, 0, capacity, charging, 0x0f, 0xa0];
// Status answers exactly as a VXE R1 Pro receiver sent them, with the mouse on and off.
const hexFrame = (text) => text.split(' ').map((b) => parseInt(b, 16));
const statusOn = () => hexFrame('08 03 00 00 00 01 01 b5 b6 0d 00 00 00 00 00 00 d0');
const statusOff = () => hexFrame('08 03 00 00 00 01 00 b5 b6 0d 00 00 00 00 00 00 d1');

test('kysona: the receiver saying it has no mouse twice means the mouse is off', async () => {
  const { dev, logical } = mouse();
  dev.reads = [[], statusOff(), [], [], [], [], [], statusOff()];
  await assert.rejects(kysona.readBattery(logical), /^Error: mouse is off$/);
  assert.equal(dev.closes, 0);
});

test('kysona: one "no mouse" answer while the switch moves is not enough', async () => {
  const { dev, logical } = mouse();
  dev.reads = [[], statusOff(), statusOn(), statusOff(), reply(88)];
  assert.equal((await kysona.readBattery(logical)).capacity, 88);
});

test('kysona: a "connected" answer from a receiver busy reaching a sleeping mouse is not trusted', async () => {
  // As seen with two programs asking at once: "connected" first, then the truth.
  const { dev, logical } = mouse();
  dev.reads = [[], statusOn(), [], [], statusOff(), [], [], statusOff()];
  await assert.rejects(kysona.readBattery(logical), /^Error: mouse is off$/);
});

test('kysona: no battery request goes out while the receiver says it has no mouse', async () => {
  const { dev, logical } = mouse();
  dev.reads = [[], statusOff(), [], [], statusOff()];
  await assert.rejects(kysona.readBattery(logical), /mouse is off/);
  assert.ok(dev.sent.length > 0 && !dev.sent.includes(0x04), `sent ${dev.sent}`);
});

test('kysona: once the receiver has the mouse, the battery is asked for straight away', async () => {
  const { dev, logical } = mouse();
  dev.reads = [[], statusOn(), [], reply(77)];
  assert.equal((await kysona.readBattery(logical)).capacity, 77);
  assert.deepEqual(dev.sent, [0x03, 0x03, 0x04]);
});

test('kysona: a battery answer wins over a stale "no mouse"', async () => {
  const { dev, logical } = mouse();
  dev.reads = [[], statusOff(), reply(90)];
  assert.equal((await kysona.readBattery(logical)).capacity, 90);
});

test('kysona: status answers are checked like Linux checks them', () => {
  assert.equal(kysona.parseStatus(statusOn()), true);
  assert.equal(kysona.parseStatus(statusOff()), false);
  const corrupt = statusOff();
  corrupt[16] = 0xd0; // checksum of the "on" frame
  assert.equal(kysona.parseStatus(corrupt), null);
  assert.equal(kysona.parseStatus(reply(50)), null);
  assert.equal(kysona.parseStatus([8, 3, 0, 0, 0, 1, 1]), null, 'too short to carry a checksum');
});

test('kysona: reads a reply and leaves the handle open for the next poll', async () => {
  const { dev, logical } = mouse();
  dev.reads = [[], reply(65, 1)];
  assert.deepEqual(await kysona.readBattery(logical), { capacity: 65, charging: true, voltageMv: 4000 });
  assert.equal(dev.closes, 0, 'closing here risks freeing memory the kernel is still using');

  const opensBefore = opens;
  dev.reads = [[], reply(64)];
  assert.equal((await kysona.readBattery(logical)).capacity, 64);
  assert.equal(opens, opensBefore, 'the second poll must reuse the handle');
});

test('kysona: never runs two operations on a handle at once', async () => {
  const { dev, logical } = mouse();
  dev.reads = [[], [], [], reply(50)];
  await kysona.readBattery(logical);
  assert.equal(dev.maxInFlight, 1);
});

test('kysona: discards a late reply left over from an earlier request', async () => {
  const { dev, logical } = mouse();
  dev.reads = [reply(99), [], reply(70)];
  assert.equal((await kysona.readBattery(logical)).capacity, 70);
});

test('kysona: skips zeroed not-ready frames', async () => {
  const { dev, logical } = mouse();
  dev.reads = [[], reply(0), reply(42)];
  assert.equal((await kysona.readBattery(logical)).capacity, 42);
});

test('kysona: a rejected write fails the read, keeps the handle and stops writing', async () => {
  const { dev, logical } = mouse();
  dev.writeError = new Error('Cannot write to hid device');
  await assert.rejects(kysona.readBattery(logical), /Cannot write/);
  assert.equal(dev.closes, 0, 'a read may still be pending, so this handle must not be closed');
  assert.equal(dev.writes, 1);
  await new Promise((r) => setTimeout(r, 650));
  assert.equal(dev.writes, 1, 'nothing may keep poking after the read has failed');
});

test('a failed read closes the handle, and the next poll opens a fresh one', async () => {
  const { dev, logical } = mouse();
  dev.reads = [new Error('could not read data from device')];
  await assert.rejects(kysona.readBattery(logical), /could not read/);
  assert.equal(dev.closes, 1, 'a failed read leaves nothing pending, so this close is safe');

  const opensBefore = opens;
  dev.reads = [[], reply(30)];
  await kysona.readBattery(logical);
  assert.equal(opens, opensBefore + 1);
});

test('a failed open can be retried', async () => {
  const { dev, logical } = mouse();
  openError = new Error('cannot open device with path x');
  await assert.rejects(kysona.readBattery(logical), /cannot open/);
  openError = null;
  dev.reads = [[], reply(30)];
  assert.equal((await kysona.readBattery(logical)).capacity, 30);
});

const inputProfile = { usagePage: 0xff02, usage: 2, reportKind: 'input', reportId: 5, byteOffset: 2, scaleMin: 0, scaleMax: 100, trigger: null };

test('generic: uses the newest frame broadcast since the last poll', async () => {
  const { dev, logical } = mouse();
  dev.reads = [[5, 1, 80], [9, 1, 11], [5, 1, 78]];
  assert.equal((await generic.readBattery(logical, inputProfile)).capacity, 78);
  assert.equal(dev.closes, 0);
});

test('generic: a rejected trigger write does not abort listening', async () => {
  const { dev, logical } = mouse();
  dev.writeError = new Error('Cannot write to hid device');
  dev.reads = [[], [], [5, 1, 60]];
  const profile = { ...inputProfile, trigger: [0, 0] };
  assert.equal((await generic.readBattery(logical, profile)).capacity, 60);
});

test('generic: an all-zero frame is not reported as 0%', async () => {
  const { dev, logical } = mouse();
  dev.reads = [[5, 0, 0], [], [5, 1, 55]];
  assert.equal((await generic.readBattery(logical, inputProfile)).capacity, 55);
});

test('generic: a feature report too short for the profile gives no reading, not NaN', async () => {
  const { dev, logical } = mouse();
  dev.feature = [5, 1];
  const profile = { ...inputProfile, reportKind: 'feature', readLength: 8, byteOffset: 6 };
  await assert.rejects(generic.readBattery(logical, profile), /waiting/);
  dev.feature = [5, 1, 0, 0, 0, 0, 72];
  assert.equal((await generic.readBattery(logical, profile)).capacity, 72);
});

test('findChannel: tells apart collections on the same usage page', () => {
  const device = { channels: [
    { path: 'keyboard', usagePage: 1, usage: 6 },
    { path: 'system', usagePage: 1, usage: 128 },
    { path: 'mouse', usagePage: 1, usage: 2 },
  ] };
  assert.equal(findChannel(device, 1, 128).path, 'system');
  assert.equal(findChannel(device, 1).path, 'keyboard', 'older profiles keep working');
  assert.equal(findChannel(device, 2), undefined);
});

test('generic: a failed feature report drops the handle, so a replugged device reads again', async () => {
  const { dev, logical } = mouse();
  const profile = { ...inputProfile, reportKind: 'feature', readLength: 8, byteOffset: 6 };
  dev.featureError = new Error('could not get feature report from device');
  await assert.rejects(generic.readBattery(logical, profile), /could not get feature report/);
  assert.equal(dev.closes, 1);
  const opensBefore = opens;
  dev.featureError = null;
  dev.feature = [5, 1, 0, 0, 0, 0, 44];
  assert.equal((await generic.readBattery(logical, profile)).capacity, 44);
  assert.equal(opens, opensBefore + 1, 'the next poll must open a fresh handle');
});

test('kysona: a receiver that refuses writes on 0xFF02 is tried on its other vendor collections', async () => {
  const main = new FakeDevice();
  const other = new FakeDevice();
  main.writeError = new Error('Cannot write to hid device');
  other.reads = [[], reply(66)];
  devices.set('fa09-ff02', main);
  devices.set('fa09-ff04', other);
  const logical = { channels: [
    { path: 'fa09-mouse', usagePage: 0x01, usage: 2 },
    { path: 'fa09-ff04', usagePage: 0xff04, usage: 2 },
    { path: 'fa09-ff02', usagePage: 0xff02, usage: 2 },
  ] };
  assert.equal((await kysona.readBattery(logical)).capacity, 66);
  assert.equal(main.writes, 1, 'the command collection is still tried first');
});

test('kysona: when every collection refuses writes, that is the error reported', async () => {
  const main = new FakeDevice();
  main.writeError = new Error('Cannot write to hid device');
  devices.set('only-ff02', main);
  await assert.rejects(kysona.readBattery({ channels: [{ path: 'only-ff02', usagePage: 0xff02, usage: 2 }] }), /Cannot write/);
});

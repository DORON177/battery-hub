// Battery protocols, checked against the byte layouts documented by HeadsetControl, OpenRazer,
// rivalcfg and the Linux kernel. Most of these devices aren't available to test on hardware.
const test = require('node:test');
const assert = require('node:assert');
const Module = require('node:module');

const load = Module._load;
Module._load = function (request, ...rest) {
  if (request === 'node-hid') return {};
  return load.call(this, request, ...rest);
};
const table = require('../src/main/hid/drivers/table');
const { channelsFor } = require('../src/main/hid/drivers/tabled');
const hidpp = require('../src/main/hid/drivers/hidpp');
const razer = require('../src/main/hid/drivers/razer');
const razerDevices = require('../src/main/hid/drivers/razer-devices');
const playstation = require('../src/main/hid/drivers/playstation');
const audeze = require('../src/main/hid/drivers/audeze');
const { detectDriver } = require('../src/main/hid/drivers');
const { pad, scale, fromVoltage } = require('../src/main/hid/drivers/exchange');
const { parseScan } = require('../src/main/system-batteries');
const { identityOf, routesOf, planMerges } = require('../src/main/identity');
Module._load = load;

const entry = (vendorId, productId) => table.find({ vendorId, productId });
const frame = (bytes) => pad(bytes, 64);

test('no product id is claimed twice in the device table', () => {
  const seen = new Set();
  for (const d of table.DEVICES) {
    for (const pid of d.productIds) {
      const key = `${d.vendorId}:${pid}`;
      assert.ok(!seen.has(key), key);
      seen.add(key);
    }
  }
});

test('every table entry has a request to send and a parser', () => {
  for (const d of table.DEVICES) {
    assert.ok(d.steps.length > 0 && d.kind, d.name);
    for (const step of d.steps) assert.ok(step.request.length > 0 && typeof step.parse === 'function', d.name);
  }
});

test('Arctis Nova 7 reads levels and percent by model, and knows when the headset is off', () => {
  const parse = entry(0x1038, 0x2202).steps[0].parse;
  assert.deepEqual(parse(frame([0, 0, 3, 3]), 0x2202), { capacity: 75, charging: false });
  assert.deepEqual(parse(frame([0, 0, 0x64, 1]), 0x227e), { capacity: 100, charging: true });
  assert.deepEqual(parse(frame([0, 0, 41, 3]), 0x227e), { capacity: 41, charging: false });
  assert.equal(parse(frame([0, 0, 0, 0]), 0x2202).offline, true);
});

test('Arctis 9 maps its raw range onto a percentage', () => {
  const parse = entry(0x1038, 0x12c2).steps[0].parse;
  assert.equal(parse(frame([0, 0, 0, 0x64, 0])).capacity, 0);
  assert.equal(parse(frame([0, 0, 0, 0x9a, 1])).capacity, 100);
  assert.equal(parse(frame([0, 0, 0, 0x7f, 1])).charging, true);
});

test('Corsair Void clears the microphone flag from the level', () => {
  const parse = entry(0x1b1c, 0x0a14).steps[0].parse;
  assert.deepEqual(parse([100, 0, 0x80 | 57, 177, 1]), { capacity: 57, charging: false });
  assert.equal(parse([100, 0, 40, 177, 5]).charging, true);
  assert.equal(parse([100, 0, 0, 177, 0]).offline, true);
  assert.equal(parse([99, 0, 40, 177, 1]), null);
});

test('HyperX Cloud Alpha Wireless needs all three answers', () => {
  const [link, charge, level] = entry(0x03f0, 0x098d).steps;
  assert.equal(link.parse(frame([0x21, 0xbb, 0x03, 0x01])).offline, true);
  assert.deepEqual(charge.parse(frame([0x21, 0xbb, 0x0c, 0x01])), { charging: true });
  assert.deepEqual(level.parse(frame([0x21, 0xbb, 0x0b, 66])), { capacity: 66 });
  assert.equal(level.parse(frame([0x21, 0xbb, 0x0c, 66])), null);
});

test('Logitech headsets convert voltage through the model curve', () => {
  const parse = entry(0x046d, 0x0ab5).steps[0].parse;
  const at = (mv, state) => parse(pad([0x11, 0xff, 8, 0x0a, mv >> 8, mv & 0xff, state], 20));
  assert.equal(at(4100, 1).capacity, 100);
  assert.equal(at(3750, 1).capacity, 40);
  assert.equal(at(3750, 3).charging, true);
  assert.equal(at(3000, 1).offline, true);
});

test('SteelSeries wireless mice decode the level and charge flag', () => {
  const aerox = entry(0x1038, 0x1838);
  assert.deepEqual(aerox.steps[0].request, [0x00, 0xd2]);
  assert.deepEqual(aerox.steps[0].parse([0xd2, 15]), { capacity: 70, charging: false });
  assert.deepEqual(aerox.steps[0].parse([0xd2, 0x80 | 21]), { capacity: 100, charging: true });
  assert.deepEqual(entry(0x1038, 0x1830).steps[0].parse([54, 0, 1]), { capacity: 54, charging: true });
});

test('a table entry only opens the collection the protocol lives on', () => {
  const device = {
    vendorId: 0x1038, productId: 0x2202,
    channels: [
      { usagePage: 0x0c, usage: 1, interface: 0, path: 'a' },
      { usagePage: 0xffc0, usage: 1, interface: 3, path: 'b' },
    ],
  };
  assert.deepEqual(channelsFor(device, table.find(device)).map((c) => c.path), ['b']);
});

test('HID++ requests are long reports for the right device and function', () => {
  assert.deepEqual(hidpp.request(1, 0x00, 0, [0x10, 0x04]).slice(0, 6), [0x11, 1, 0x00, 0x0b, 0x10, 0x04]);
  assert.equal(hidpp.request(1, 6, 1).length, 20);
});

test('HID++ replies are matched to the call, and errors are told apart', () => {
  const reply = pad([0x11, 1, 6, 0x1b, 80, 8, 0, 0], 20);
  assert.equal(hidpp.replyTo(reply, 1, 6, 1)[0], 80);
  assert.equal(hidpp.replyTo(reply, 2, 6, 1), null);
  assert.equal(hidpp.replyTo(reply, 1, 7, 1), null);
  // The receiver can't reach the device (Linux: resource error, unknown device; Solaar: connect failed)
  for (const code of [0x04, 0x08, 0x09]) {
    assert.throws(() => hidpp.replyTo(pad([0x10, 1, 0x8f, 6, 0x1b, code], 20), 1, 6, 1), /^Error: device is off$/);
  }
  // The device itself answered with an error, so it is on
  assert.throws(() => hidpp.replyTo(pad([0x11, 1, 0xff, 6, 0x1b, 5], 20), 1, 6, 1), /refused the request \(error 5\)/);
  assert.throws(() => hidpp.replyTo(pad([0x10, 1, 0x8f, 6, 0x1b, 0x01], 20), 1, 6, 1), /refused/);
  // Errors for someone else's request (another feature, or G HUB's function and software id)
  assert.equal(hidpp.replyTo(pad([0x11, 1, 0xff, 9, 0x1b, 5], 20), 1, 6, 1), null);
  assert.equal(hidpp.replyTo(pad([0x11, 1, 0xff, 6, 0x1a, 5], 20), 1, 6, 1), null);
  assert.equal(hidpp.replyTo(pad([0x10, 1, 0x8f, 6, 0x13, 0x09], 20), 1, 6, 1), null);
});

test('HID++ battery features decode percent, levels, and voltage', () => {
  assert.deepEqual(hidpp.parseUnified([73, 4, 0, 0]), { capacity: 73, charging: false });
  assert.deepEqual(hidpp.parseUnified([0, 2, 1, 1]), { capacity: 20, charging: true });
  assert.deepEqual(hidpp.parseUnified([0, 8, 3, 1]), { capacity: 100, charging: true });
  assert.deepEqual(hidpp.parseStatus([50, 30, 0]), { capacity: 50, charging: false });
  assert.equal(hidpp.parseStatus([0, 0, 1]).charging, true);
  assert.equal(hidpp.parseVoltage([0x0f, 0x00, 0x00]).capacity, 53);
  assert.equal(hidpp.parseVoltage([0x10, 0x00, 0x80]).charging, true);
});

test('Razer requests carry the checksum OpenRazer computes', () => {
  const report = razer.buildRequest(0x1f, 0x80);
  assert.equal(report.length, 90);
  assert.deepEqual(report.slice(0, 8), [0, 0x1f, 0, 0, 0, 2, 7, 0x80]);
  assert.equal(report[88], 2 ^ 7 ^ 0x80);
});

test('Razer replies are checked before use', () => {
  const reply = new Array(90).fill(0);
  Object.assign(reply, { 0: 2, 6: 7, 7: 0x80, 9: 128 });
  assert.equal(razer.parseReply(reply, 0x80)[1], 128);
  assert.equal(razer.parseReply(reply, 0x84), null);
  assert.equal(razer.parseReply({ ...reply, length: 90, 0: 3, slice: reply.slice }, 0x80), null);
});

test('Razer table uses the transaction id each model needs', () => {
  const pids = new Set(razerDevices.map(([pid]) => pid));
  assert.equal(pids.size, razerDevices.length);
  const viper = razerDevices.find(([, , name]) => name === 'viper v2 pro wireless');
  assert.equal(viper[1], 0x1f);
});

test('DualSense reads battery over USB and Bluetooth', () => {
  const usb = new Array(64).fill(0);
  usb[0] = 0x01;
  usb[53] = 0x07;
  assert.deepEqual(playstation.parseDualSense(usb), { capacity: 75, charging: false });
  usb[53] = 0x14;
  assert.deepEqual(playstation.parseDualSense(usb), { capacity: 45, charging: true });
  usb[53] = 0x2a;
  assert.deepEqual(playstation.parseDualSense(usb), { capacity: 100, charging: true });
  usb[53] = 0xa0;
  assert.equal(playstation.parseDualSense(usb), null);
  const bt = new Array(78).fill(0);
  bt[0] = 0x31;
  bt[54] = 0x09;
  assert.equal(playstation.parseDualSense(bt, true).capacity, 95);
});

test('a short Bluetooth report is never mistaken for an empty battery', () => {
  const short = new Array(78).fill(0); // what the real controller sent: padded with zeros
  short[0] = 0x01;
  assert.equal(playstation.parseDualSense(short, true), null);
  assert.equal(playstation.parseDualShock4(short, true), null);
});

test('DualShock 4 reads battery over USB and Bluetooth', () => {
  const usb = new Array(64).fill(0);
  usb[0] = 0x01;
  usb[30] = 0x05;
  assert.deepEqual(playstation.parseDualShock4(usb), { capacity: 55, charging: false });
  usb[30] = 0x1b;
  assert.deepEqual(playstation.parseDualShock4(usb), { capacity: 100, charging: true });
  const bt = new Array(78).fill(0);
  bt[0] = 0x11;
  bt[32] = 0x12;
  assert.deepEqual(playstation.parseDualShock4(bt, true), { capacity: 25, charging: true });
});

test('Audeze request matches the documented bytes', () => {
  const report = audeze.buildRequest();
  assert.equal(report.length, 62);
  assert.deepEqual(report.slice(0, 10), [0x06, 7, 0x80, 0x05, 0x5a, 3, 0, 0xd6, 0x0c, 0x00]);
});

test('Audeze finds the battery in the message stream, even split across reports', () => {
  const ack = [0x07, 7, 0x80, 0x05, 0x5b, 3, 0, 0xd6, 0x0c, 0x00];
  assert.deepEqual(audeze.parseReports([pad(ack, 62), pad([0x07, 9, 0x80, 0x05, 0x5d, 5, 0, 0xd6, 0x0c, 0, 0, 87], 62)]), { capacity: 87, charging: null });
  assert.equal(audeze.parseReports([pad([0x07, 7, 0x80, 0x05, 0x5b, 3, 0, 0xd6, 0x0c, 0x05], 62)]).off, true);
  assert.equal(audeze.parseReports([pad(ack, 62)]), null);
  assert.equal(audeze.parseReports([pad([0x07, 0, 0x80, 0x05, 0x5d, 5, 0, 0xd6, 0x0c, 0, 0, 87], 62)]), null);
  const split = [pad([0x07, 5, 0x80, 0x05, 0x5d, 5, 0, 0xd6], 62), pad([0x07, 4, 0x80, 0x0c, 0, 0, 42], 62)];
  assert.equal(audeze.parseReports(split).capacity, 42);
});

test('devices are routed to the right driver, and unknown ones are left alone', () => {
  const channel = (usagePage, usage, iface) => ({ usagePage, usage, interface: iface, path: `${usagePage}/${usage}` });
  const device = (vendorId, productId, product, channels) => ({ vendorId, productId, product, channels });
  const id = (d) => (detectDriver(d) || { id: null }).id;
  assert.equal(id(device(0x046d, 0x0ab5, 'G733', [channel(0xff43, 0x0202, 3), channel(0xff00, 2, 2)])), 'tabled');
  assert.equal(id(device(0x046d, 0xc548, 'USB Receiver', [channel(0xff00, 2, 2)])), 'hidpp');
  assert.equal(id(device(0x1532, 0x00a6, 'Razer', [channel(1, 2, 0)])), 'razer');
  assert.equal(id(device(0x054c, 0x0ce6, 'DualSense', [channel(1, 5, 3)])), 'playstation');
  assert.equal(id(device(0x3329, 0x4b19, 'Audeze Maxwell', [channel(0xff13, 1, 3)])), 'audeze');
  assert.equal(id(device(0x1b1c, 0x1b73, 'K70', [channel(0xff42, 1, 1)])), null);
  assert.equal(id(device(0x1234, 0x5678, 'Unknown', [channel(0xff00, 1, 0)])), null);
});

test('the same Bluetooth address means the same device, however it was reached', () => {
  const windows = { id: 'bt:BTHLE\\Dev_d228599c0140\\8&1420c792&0&d228599c0140' };
  const hid = { id: '1133:45122:d228599c0140', serialNumber: 'd228599c0140' };
  const saved = { id: '1133:45122:d228599c0140' };
  assert.equal(identityOf(windows), 'mac:d228599c0140');
  assert.equal(identityOf(hid), identityOf(windows));
  assert.equal(identityOf(saved), identityOf(windows));
  assert.equal(identityOf({ id: '13652:62858:' }), null);
  assert.equal(identityOf({ id: '1:2:ABC123', serialNumber: 'ABC123' }), null);
});

test('a card reads directly before asking Windows', () => {
  const card = { id: 'bt:x', driverId: 'system', links: [{ id: '1:2:abc', driverId: 'hidpp', profile: null }] };
  assert.deepEqual(routesOf(card).map((r) => r.id), ['1:2:abc', 'bt:x']);
});

test('duplicate cards merge, keeping the name and the longer history', () => {
  const plans = planMerges({
    a: { id: 'a', identity: 'mac:1', history: [1, 2, 3] },
    b: { id: 'b', identity: 'mac:1', customName: 'My pad', history: [1] },
    c: { id: 'c', identity: 'mac:2', history: [] },
    d: { id: 'd', history: [] },
  });
  assert.equal(plans.length, 1);
  assert.equal(plans[0].keep.id, 'b');
  assert.deepEqual(plans[0].drop.map((c) => c.id), ['a']);
});

test('two controllers with different addresses stay separate', () => {
  assert.equal(planMerges({ a: { id: 'a', identity: 'mac:1' }, b: { id: 'b', identity: 'mac:2' } }).length, 0);
});

test('helpers scale and interpolate within range', () => {
  assert.equal(scale(2, 0, 4), 50);
  assert.equal(scale(9, 0, 4), 100);
  const curve = [[4000, 100], [3500, 0]];
  assert.equal(fromVoltage(4100, curve), 100);
  assert.equal(fromVoltage(3750, curve), 50);
  assert.equal(fromVoltage(3000, curve), 0);
});

test('a Windows scan parses one device or many, and rejects nonsense', () => {
  assert.equal(parseScan('[{"id":"bt:1","name":"Mouse","capacity":90,"connected":true}]').length, 1);
  assert.equal(parseScan('{"id":"bt:1","name":"Mouse","capacity":90}').length, 1);
  assert.equal(parseScan('[{"id":"bt:1","capacity":250}]').length, 0);
  assert.equal(parseScan('not json'), null);
});

test('switched-off devices read as off instead of a made-up level', () => {
  const aerox = entry(0x1038, 0x1838);
  assert.deepEqual(aerox.steps[0].parse([0xd2, 0]), { offline: true }); // rivalcfg: level -5
  assert.deepEqual(aerox.steps[0].parse([0xd2, 0x7f]), { offline: true });
  assert.deepEqual(entry(0x1038, 0x1830).steps[0].parse([0xff, 0, 0]), { offline: true });
  const g733 = entry(0x046d, 0x0ab5).steps[0];
  assert.deepEqual(g733.parse(pad([0x11, 0xff, 0xff, 0x08, 0x0a, 0x05], 20)), { offline: true });
  // Answers to other software's requests are not this headset's battery
  assert.equal(g733.parse(pad([0x11, 0xff, 0xff, 0x08, 0x1c, 0x05], 20)), null);
  assert.equal(g733.parse(pad([0x11, 0xff, 0x04, 0x0a, 0x0f, 0xa0, 1], 20)), null);
  assert.equal(g733.parse(pad([0x11, 0xff, 0x08, 0x1a, 0x0f, 0xa0, 1], 20)), null);
});

test('a razer receiver that times out on the mouse means the mouse is off', async () => {
  const timedOut = razer.buildRequest(0x1f, 0x80);
  timedOut[0] = 0x04;
  const dev = { sendFeatureReport: async () => {}, getFeatureReport: async () => [0, ...timedOut] };
  const session = require('../src/main/hid/session');
  const acquire = session.acquire;
  session.acquire = async () => dev;
  try {
    await assert.rejects(razer.readBattery({ id: 'r', productId: razerDevices[0][0], channels: [{ path: 'p', interface: 0 }] }), /^Error: device is not answering$/);
  } finally {
    session.acquire = acquire;
  }
});

test('a table device whose dongle never answers is not answering, unless it is on its cable', async () => {
  const exchange = require('../src/main/hid/drivers/exchange');
  const original = exchange.exchange;
  delete require.cache[require.resolve('../src/main/hid/drivers/tabled')];
  exchange.exchange = async () => { throw new Error('timeout waiting for battery response'); };
  try {
    const tabled = require('../src/main/hid/drivers/tabled');
    const device = { vendorId: 0x03f0, productId: 0x098d, channels: [{ path: 'a', usagePage: 0xff00 }, { path: 'b', usagePage: 0xff01 }] };
    await assert.rejects(tabled.readBattery(device), /^Error: headset is not answering$/);
    const cable = { vendorId: 0x1038, productId: 0x183a, channels: [{ path: 'c', usagePage: 0xffc0, interface: 3 }] };
    await assert.rejects(tabled.readBattery(cable), /^Error: timeout waiting for battery response$/);
  } finally {
    exchange.exchange = original;
    delete require.cache[require.resolve('../src/main/hid/drivers/tabled')];
  }
});

test('Logitech: a device that stops answering reads as off on the same poll, an unplugged one does not', async () => {
  const exchange = require('../src/main/hid/drivers/exchange');
  const original = exchange.exchange;
  const fresh = () => {
    delete require.cache[require.resolve('../src/main/hid/drivers/hidpp')];
    return require('../src/main/hid/drivers/hidpp');
  };
  const receiver = { product: 'USB Receiver', vendorId: 0x046d, channels: [{ path: 'r', usagePage: 0xff00, usage: 0x02 }] };
  try {
    // Slot 1 holds a mouse with Unified Battery at index 6, then it goes quiet.
    let on = true;
    exchange.exchange = async (channel, request, accept) => {
      const [, device, index, fnSw] = request;
      if (!on || device !== 1) throw new Error('timeout waiting for battery response');
      if (index === 0) return accept(pad([0x11, 1, 0, fnSw, request[4] === 0x10 && request[5] === 0x04 ? 6 : 0], 20));
      return accept(pad([0x11, 1, 6, fnSw, 64, 4, 0, 0], 20));
    };
    const hidpp2 = fresh();
    assert.equal((await hidpp2.readBattery(receiver)).capacity, 64);
    on = false;
    await assert.rejects(hidpp2.readBattery(receiver), /^Error: device is not answering$/);

    // Unplugged: the channel itself fails, which must reach the poller as it is.
    exchange.exchange = async () => { throw new Error('could not read data from device'); };
    await assert.rejects(fresh().readBattery(receiver), /could not read data/);
  } finally {
    exchange.exchange = original;
    delete require.cache[require.resolve('../src/main/hid/drivers/hidpp')];
  }
});

test('DualShock 4 adapter with no controller on it reads as off, not as a low battery', () => {
  const usb = new Array(64).fill(0);
  usb[0] = 0x01;
  usb[31] = 0x04;
  assert.deepEqual(playstation.parseDualShock4(usb, false, true), { off: true });
  usb[31] = 0x00;
  usb[30] = 0x05;
  assert.deepEqual(playstation.parseDualShock4(usb, false, true), { capacity: 55, charging: false });
  usb[31] = 0x04; // a controller on its own cable never reports this; only the adapter is checked
  assert.deepEqual(playstation.parseDualShock4(usb), { capacity: 55, charging: false });
});

test('Audeze talks on the collection HeadsetControl uses first', () => {
  const order = audeze.candidates({ channels: [
    { path: 'consumer', usagePage: 0x0c, usage: 1 },
    { path: 'other', usagePage: 0xff00, usage: 1 },
    { path: 'command', usagePage: 0xff13, usage: 1 },
  ] }).map((c) => c.path);
  assert.deepEqual(order, ['command', 'other', 'consumer']);
});

const test = require('node:test');
const assert = require('node:assert');
const Module = require('node:module');

const fakeHid = { HIDAsync: {} };
const load = Module._load;
Module._load = function (request, ...rest) {
  if (request === 'node-hid') return fakeHid;
  return load.call(this, request, ...rest);
};
const { capture } = require('../src/main/hid/inspector');
Module._load = load;

// Run a full scan against one fake channel, with the clock accelerated so 30s takes moments.
async function scan(channel, device) {
  const realNow = Date.now;
  const realSetTimeout = global.setTimeout;
  let offset = 0;
  offsetRead = (ms) => { offset += ms; };
  Date.now = () => realNow() + offset;
  global.setTimeout = (fn, ms, ...args) => { offset += ms; return realSetTimeout(fn, 0, ...args); };
  fakeHid.HIDAsync.open = async () => device;
  try {
    return await capture({ channels: [channel] });
  } finally {
    Date.now = realNow;
    global.setTimeout = realSetTimeout;
  }
}

let offsetRead = () => {};
function fakeDevice({ read, feature }) {
  return {
    reads: 0,
    writes: 0,
    closes: 0,
    featureCalls: 0,
    async read(ms) { this.reads += 1; offsetRead(ms); await null; return read(this); },
    async write() { this.writes += 1; },
    async close() { this.closes += 1; },
    async getFeatureReport(id, len) { this.featureCalls += 1; return feature(id, len); },
  };
}

test('a collection with no input reports keeps having its feature reports polled', async () => {
  const dev = fakeDevice({
    read() { throw new Error('could not read data from device'); },
    feature(id, len) {
      if (id !== 3 || len !== 8) throw new Error('invalid report');
      return Buffer.from([3, 90, 0, 0, 0, 0, 0, 0]);
    },
  });
  const frames = await scan({ path: 'no-input', usagePage: 0xff04, usage: 2 }, dev);
  assert.equal(frames.length, 1);
  assert.ok(frames[0].count > 5, `expected repeated polling, saw ${frames[0].count}`);
  assert.equal(frames[0].usage, 2, 'calibration needs the usage to find this collection again');
  assert.equal(dev.closes, 0);
});

test('after the first sweep only supported feature reports are polled', async () => {
  const dev = fakeDevice({
    read() { return Buffer.alloc(0); },
    feature(id, len) {
      if (id !== 2 || len !== 16) throw new Error('invalid report');
      return Buffer.alloc(16, 7);
    },
  });
  const frames = await scan({ path: 'one-report', usagePage: 0xff02, usage: 1 }, dev);
  const sweep = 8 * 3;
  assert.equal(dev.featureCalls - sweep, frames[0].count - 1);
});

test('standard collections are never written to or read for input', async () => {
  const dev = fakeDevice({
    read() { throw new Error('must not read'); },
    feature() { throw new Error('invalid report'); },
  });
  await scan({ path: 'keyboard', usagePage: 1, usage: 6 }, dev);
  assert.equal(dev.writes, 0);
  assert.equal(dev.reads, 0);
});

test('input frames are captured from vendor collections', async () => {
  let sent = false;
  const dev = fakeDevice({
    read() { if (sent) return Buffer.alloc(0); sent = true; return Buffer.from([5, 1, 80]); },
    feature() { throw new Error('invalid report'); },
  });
  const frames = await scan({ path: 'vendor', usagePage: 0xff00, usage: 1 }, dev);
  assert.equal(frames[0].reportKind, 'input');
  assert.equal(frames[0].reportId, 5);
  assert.deepEqual(frames[0].bytes, [5, 1, 80]);
});

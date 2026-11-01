const test = require('node:test');
const assert = require('node:assert');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const childProcess = require('node:child_process');

function fakeChild() {
  const c = new EventEmitter();
  c.stdout = new PassThrough();
  c.killed = false;
  c.kill = () => { c.killed = true; };
  return c;
}

const spawned = [];
childProcess.spawn = () => { const c = fakeChild(); spawned.push(c); return c; };
const monitor = require('../src/main/monitor');

test('a killed reader exiting late does not untrack its replacement', () => {
  monitor.start('headset', null, null);
  const first = spawned[spawned.length - 1];

  // poller.restart(): stop the old reader and immediately start a new one.
  monitor.stop('headset');
  monitor.start('headset', null, null);
  const second = spawned[spawned.length - 1];
  assert.notEqual(first, second);

  // The old process's exit is only delivered now.
  first.emit('exit');

  assert.equal(monitor.isActive('headset'), true, 'replacement must stay tracked');
  monitor.stop('headset');
  assert.equal(second.killed, true, 'replacement must remain stoppable');
});

test('a reader exiting on its own frees the slot', () => {
  monitor.start('headset2', null, null);
  spawned[spawned.length - 1].stdout.write('{"event":"ready"}\n');
  return new Promise((r) => setImmediate(r)).then(() => {
    spawned[spawned.length - 1].emit('exit');
    assert.equal(monitor.isActive('headset2'), false);
  });
});

test('falls through interpreters that exit without running the script', () => {
  // On Windows, "python" is often a store alias that just exits.
  const states = [];
  const before = spawned.length;
  monitor.start('headset3', null, (s) => states.push(s));
  spawned[before].emit('exit');
  assert.equal(spawned.length, before + 2, 'should try the next launcher');
  assert.equal(monitor.isActive('headset3'), true);
  spawned[before + 1].emit('exit');
  spawned[before + 2].emit('exit');
  assert.deepEqual(states, ['python-missing']);
  assert.equal(monitor.isActive('headset3'), false);
});

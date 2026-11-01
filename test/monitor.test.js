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
  spawned[spawned.length - 1].emit('exit');
  assert.equal(monitor.isActive('headset2'), false);
});

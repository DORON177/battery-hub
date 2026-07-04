// Main-process proxy to the isolated node-hid worker (see hid-worker.js).
// All HID enumeration / battery reads / capture go through here. If the worker process
// dies (e.g. a native heap crash inside node-hid), the main app stays alive: pending calls
// reject, and the next call transparently respawns the worker.
const { utilityProcess } = require('electron');
const path = require('path');

const WORKER = path.join(__dirname, 'hid-worker.js');

let child = null;
let seq = 0;
const pending = new Map(); // requestId -> { resolve, reject, timer }

function rejectAll(reason) {
  for (const [, p] of pending) {
    clearTimeout(p.timer);
    p.reject(new Error(reason));
  }
  pending.clear();
}

function spawn() {
  child = utilityProcess.fork(WORKER, [], { stdio: 'ignore' });
  child.on('message', (msg) => {
    const p = pending.get(msg.id);
    if (!p) return;
    pending.delete(msg.id);
    clearTimeout(p.timer);
    if (msg.ok) p.resolve(msg.result);
    else p.reject(new Error(msg.error));
  });
  // A crash or clean exit lands here; drop the handle so the next call respawns.
  child.on('exit', () => {
    child = null;
    rejectAll('hid worker exited');
  });
}

function call(cmd, args, timeoutMs) {
  return new Promise((resolve, reject) => {
    if (!child) {
      try { spawn(); } catch (e) { return reject(e); }
    }
    const id = ++seq;
    const timer = setTimeout(() => {
      if (pending.has(id)) { pending.delete(id); reject(new Error(`${cmd} timed out`)); }
    }, timeoutMs);
    pending.set(id, { resolve, reject, timer });
    try {
      child.postMessage({ id, cmd, args });
    } catch (e) {
      pending.delete(id);
      clearTimeout(timer);
      reject(e);
    }
  });
}

module.exports = {
  enumerate: () => call('enumerate', [], 8000),
  // Headroom over the drivers' own internal timeouts (generic input-mode waits up to 8s).
  readBattery: (driverId, device, profile) => call('readBattery', [driverId, device, profile || null], 12000),
  // Must exceed inspector.js CAPTURE_MS (30s scan) plus channel open/close overhead.
  capture: (device) => call('capture', [device], 45000),
  stop: () => { if (child) { try { child.kill(); } catch (_) {} child = null; } rejectAll('hid client stopped'); },
};

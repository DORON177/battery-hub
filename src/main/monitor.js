// Persistent battery monitors for event-driven devices (the MCHOSE headset).
//
// These devices only push a frame when the battery changes or the headset is power-
// cycled, and powering on re-enumerates the USB dongle — which invalidates any HID
// handle opened beforehand. Reliably surviving that reconnect is exactly what the
// user's proven Python/hidapi widget does, so rather than reimplement it against
// node-hid we spawn the bundled Python reader (src/main/hid/headset_reader.py) as a
// long-lived subprocess and consume its JSON event stream.
const { spawn } = require('child_process');
const path = require('path');
const readline = require('readline');

const SCRIPT = path.join(__dirname, 'hid', 'headset_reader.py');
const PY_CANDIDATES = ['python', 'python3', 'py'];

const active = new Map(); // deviceId -> { child }

function spawnReader(pyIndex) {
  return spawn(PY_CANDIDATES[pyIndex], [SCRIPT], { windowsHide: true });
}

// onReading({capacity}) fires on each battery update; onStatus(state) on state changes
// ('disconnected' | 'off' | 'python-missing' | 'unavailable').
function start(deviceId, onReading, onStatus) {
  if (active.has(deviceId)) return true;

  const attempt = (pyIndex) => {
    const tryNext = () => {
      if (pyIndex + 1 < PY_CANDIDATES.length) return attempt(pyIndex + 1);
      if (onStatus) onStatus('python-missing');
      return false;
    };

    let child;
    try {
      child = spawnReader(pyIndex);
    } catch (_) {
      return tryNext();
    }

    active.set(deviceId, { child });
    let started = false; // the reader script is really running under this interpreter

    const rl = readline.createInterface({ input: child.stdout });
    rl.on('line', (line) => {
      let msg;
      try { msg = JSON.parse(line); } catch (_) { return; }
      if (msg.event === 'ready') {
        started = true;
      } else if (msg.event === 'battery' && onReading) {
        onReading({ capacity: msg.capacity, charging: null, voltageMv: null });
      } else if (msg.event === 'status' && onStatus) {
        onStatus(msg.state);
      }
    });

    // A killed reader's exit arrives after any replacement has started, so only clear the
    // slot if it still belongs to this child. Otherwise the replacement goes untracked:
    // nothing can stop it, and the next poll spawns another one alongside it.
    const release = () => {
      const entry = active.get(deviceId);
      if (!entry || entry.child !== child) return false;
      active.delete(deviceId);
      return true;
    };

    // Command not found, or a launcher that exits without running the script: the Windows
    // "python" store alias, or an interpreter without the hid module. Try the next one.
    child.on('error', () => { if (release()) tryNext(); });
    child.on('exit', () => { if (release() && !started) tryNext(); });
    return true;
  };

  return attempt(0);
}

function stop(deviceId) {
  const entry = active.get(deviceId);
  if (!entry) return;
  try { entry.child.kill(); } catch (_) {}
  active.delete(deviceId);
}

function isActive(id) {
  return active.has(id);
}

function stopAll() {
  for (const id of Array.from(active.keys())) stop(id);
}

module.exports = { start, stop, isActive, stopAll };

// Batteries read through Windows rather than HID: paired Bluetooth devices and Xbox controllers.
// PowerShell is slow to start, so one watcher stays running while any such device is tracked.
const { spawn, execFile } = require('child_process');
const path = require('path');

const SCRIPT = path.join(__dirname, 'system-batteries.ps1');
const ARGS = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', SCRIPT];
const SCAN_TIMEOUT_MS = 20000;
const WATCH_EVERY_S = 10; // cheap once running: it asks the device manager directly

let watcher = null;
let latest = new Map(); // id -> { id, name, kind, capacity, connected }
let seenAt = 0;

function parseScan(line) {
  try {
    const list = JSON.parse(line);
    return (Array.isArray(list) ? list : [list]).filter((d) => d && d.id && d.capacity >= 0 && d.capacity <= 100);
  } catch (_) {
    return null;
  }
}

function remember(list) {
  latest = new Map(list.map((d) => [d.id, d]));
  seenAt = Date.now();
}

function runScript() {
  return new Promise((resolve) => {
    execFile('powershell.exe', ARGS, { windowsHide: true, timeout: SCAN_TIMEOUT_MS, encoding: 'utf8' }, (err, stdout, stderr) => {
      const list = err ? null : parseScan(stdout.trim().split(/\r?\n/).pop());
      resolve({ list, error: list ? null : String(stderr || (err && err.message) || 'no output').slice(0, 200) });
    });
  });
}

// One fresh look, for the Add device list.
async function scan() {
  if (process.platform !== 'win32') return [];
  const { list } = await runScript();
  if (list) remember(list);
  return list || [];
}

// For the support check: can PowerShell run the script at all?
async function selfTest() {
  if (process.platform !== 'win32') return { ok: true, count: 0 };
  const { list, error } = await runScript();
  return list ? { ok: true, count: list.length } : { ok: false, error };
}

function startWatching() {
  if (watcher || process.platform !== 'win32') return;
  watcher = spawn('powershell.exe', [...ARGS, '-Every', String(WATCH_EVERY_S), '-ParentId', String(process.pid)], { windowsHide: true });
  let buffer = '';
  watcher.stdout.setEncoding('utf8');
  watcher.stdout.on('data', (chunk) => {
    buffer += chunk;
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop();
    for (const line of lines) {
      const list = parseScan(line);
      if (list) remember(list);
    }
  });
  watcher.on('error', () => { watcher = null; });
  watcher.on('exit', () => { watcher = null; });
}

function stopWatching() {
  if (watcher) watcher.kill();
  watcher = null;
}

const get = (id) => latest.get(id) || null;
const list = () => Array.from(latest.values());
const hasScanned = () => seenAt > 0;
const isSystemId = (id) => /^(bt|xinput):/.test(id);

module.exports = { scan, selfTest, startWatching, stopWatching, get, list, hasScanned, isSystemId, parseScan };

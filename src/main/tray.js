const { Tray, Menu, nativeImage } = require('electron');
const path = require('path');

// System-tray battery indicators, in one of two modes:
//   'perDevice' — one tray icon per paired device (default)
//   'list'      — a single tray icon; all devices are listed in its tooltip + right-click menu
//
// Glyphs are PRE-RENDERED PNG files (assets/tray/*.png, built by scripts/make-icon.js) — the
// app never runs a canvas / hidden window / builds a COM image at runtime, which was crashing
// Windows' shell COM layer (combase.dll). Here we just load the matching file for a Tray.

const TRAY_DIR = path.join(__dirname, '..', '..', 'assets', 'tray');

let handlers = { open: () => {}, quit: () => {} };
let mode = 'perDevice';
const devices = new Map();     // id -> info { name, capacity, charging, offline }  (source of truth)
const perTrays = new Map();    // id -> { tray, lastKey }   (perDevice mode)
let listTray = null;           // single Tray                (list mode)
const imageCache = new Map();  // file -> nativeImage

function setHandlers(open, quit) {
  handlers = { open, quit };
}

function imageFile(fill, charging, offline) {
  if (offline || fill == null) return 'tray-offline.png';
  if (charging) return 'tray-charging.png';
  const bucket = Math.max(0, Math.min(100, Math.round(fill / 5) * 5));
  return `tray-${bucket}.png`;
}

function imageFor(fill, charging, offline) {
  const file = imageFile(fill, charging, offline);
  let img = imageCache.get(file);
  if (!img) {
    img = nativeImage.createFromPath(path.join(TRAY_DIR, file));
    imageCache.set(file, img);
  }
  return { img, file };
}

function statusText(info) {
  if (info.offline || info.capacity == null) return 'Not connected';
  if (info.charging) return `Charging · ${info.capacity}%`;
  return `${info.capacity}%`;
}

// info: { name, capacity, charging, offline }
function updateDevice(id, info) {
  devices.set(id, { ...info });
  if (mode === 'list') renderList();
  else renderPerDeviceOne(id);
}

function removeDevice(id) {
  devices.delete(id);
  const entry = perTrays.get(id);
  if (entry) { try { entry.tray.destroy(); } catch (_) {} perTrays.delete(id); }
  if (mode === 'list') renderList();
}

// ---- per-device mode ----

function renderPerDeviceOne(id) {
  const info = devices.get(id);
  if (!info) return;
  const offline = info.offline || info.capacity == null;
  const { img, file } = imageFor(info.capacity, info.charging, offline);
  const key = `${file}|${info.name}`;

  let entry = perTrays.get(id);
  if (entry && entry.lastKey === key) return; // nothing changed; skip

  if (!entry) {
    const tray = new Tray(img);
    tray.on('click', () => handlers.open());
    entry = { tray, lastKey: key };
    perTrays.set(id, entry);
  } else {
    entry.tray.setImage(img);
    entry.lastKey = key;
  }

  const status = statusText(info);
  entry.tray.setToolTip(`${info.name} — ${status}`);
  entry.tray.setContextMenu(Menu.buildFromTemplate([
    { label: info.name, enabled: false },
    { label: status, enabled: false },
    { type: 'separator' },
    { label: 'Open Battery Hub', click: () => handlers.open() },
    { label: 'Quit Battery Hub', click: () => handlers.quit() },
  ]));
}

// ---- single-list mode ----

function renderList() {
  const list = Array.from(devices.values());
  if (list.length === 0) {
    if (listTray) { try { listTray.destroy(); } catch (_) {} listTray = null; }
    return;
  }

  // Icon reflects the lowest-charge online device (so the tray still conveys urgency);
  // if none are online, show the offline glyph.
  let lowest = null;
  for (const d of list) {
    if (d.offline || d.capacity == null) continue;
    if (!lowest || d.capacity < lowest.capacity) lowest = d;
  }
  const { img } = lowest
    ? imageFor(lowest.capacity, lowest.charging, false)
    : imageFor(null, false, true);

  if (!listTray) {
    listTray = new Tray(img);
    listTray.on('click', () => handlers.open());
  } else {
    listTray.setImage(img);
  }

  listTray.setToolTip(['Battery Hub', ...list.map((d) => `${d.name} — ${statusText(d)}`)].join('\n'));
  const items = [{ label: 'Battery Hub', enabled: false }, { type: 'separator' }];
  for (const d of list) items.push({ label: `${d.name} — ${statusText(d)}`, enabled: false });
  items.push(
    { type: 'separator' },
    { label: 'Open Battery Hub', click: () => handlers.open() },
    { label: 'Quit Battery Hub', click: () => handlers.quit() },
  );
  listTray.setContextMenu(Menu.buildFromTemplate(items));
}

// ---- mode / lifecycle ----

function destroyTrays() {
  for (const [, e] of perTrays) { try { e.tray.destroy(); } catch (_) {} }
  perTrays.clear();
  if (listTray) { try { listTray.destroy(); } catch (_) {} listTray = null; }
}

function rebuild() {
  destroyTrays();
  if (mode === 'list') renderList();
  else for (const id of devices.keys()) renderPerDeviceOne(id);
}

function setMode(newMode) {
  const m = newMode === 'list' ? 'list' : 'perDevice';
  if (m === mode) return;
  mode = m;
  rebuild();
}

// Drop trays for devices that are no longer saved.
function sync(savedIds) {
  for (const id of Array.from(devices.keys())) {
    if (!savedIds.includes(id)) removeDevice(id);
  }
}

function destroyAll() {
  destroyTrays();
}

module.exports = { setHandlers, setMode, updateDevice, removeDevice, sync, destroyAll };

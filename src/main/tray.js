const { Tray, Menu, nativeImage } = require('electron');
const path = require('path');

// One system-tray icon per paired device, each showing that device's battery level as a
// small battery glyph. The glyphs are PRE-RENDERED PNG files (assets/tray/*.png, built by
// scripts/make-icon.js) — the app never runs a canvas / hidden window / builds a COM image
// at runtime, which was crashing Windows' shell COM layer (combase.dll). Here we just load
// the matching file and hand it to Tray.

const TRAY_DIR = path.join(__dirname, '..', '..', 'assets', 'tray');

let handlers = { open: () => {}, quit: () => {} };
const trays = new Map();      // id -> { tray, lastKey }
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

// info: { name, capacity, charging, offline }
function updateDevice(id, info) {
  const offline = info.offline || info.capacity == null;
  const { img, file } = imageFor(info.capacity, info.charging, offline);
  const key = `${file}|${info.name}`;

  let entry = trays.get(id);
  if (entry && entry.lastKey === key) return; // nothing changed; skip

  if (!entry) {
    const tray = new Tray(img);
    tray.on('click', () => handlers.open());
    entry = { tray, lastKey: key };
    trays.set(id, entry);
  } else {
    entry.tray.setImage(img);
    entry.lastKey = key;
  }

  const status = offline ? 'Not connected'
    : info.charging ? `Charging · ${info.capacity}%`
    : `${info.capacity}%`;
  entry.tray.setToolTip(`${info.name} — ${status}`);
  entry.tray.setContextMenu(Menu.buildFromTemplate([
    { label: info.name, enabled: false },
    { label: status, enabled: false },
    { type: 'separator' },
    { label: 'Open Battery Hub', click: () => handlers.open() },
    { label: 'Quit Battery Hub', click: () => handlers.quit() },
  ]));
}

function removeDevice(id) {
  const entry = trays.get(id);
  if (entry) {
    try { entry.tray.destroy(); } catch (_) {}
    trays.delete(id);
  }
}

// Drop trays for devices that are no longer saved.
function sync(savedIds) {
  for (const id of Array.from(trays.keys())) {
    if (!savedIds.includes(id)) removeDevice(id);
  }
}

function destroyAll() {
  for (const id of Array.from(trays.keys())) removeDevice(id);
}

module.exports = { setHandlers, updateDevice, removeDevice, sync, destroyAll };

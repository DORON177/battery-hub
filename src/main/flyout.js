const { BrowserWindow, screen } = require('electron');
const path = require('path');
const store = require('./store');

// The small glass panel above the tray. Built ahead of time and hidden rather than closed, so a
// click opens it at once. The glass belongs to the window, so Windows' own show and hide
// animation carries it while the page inside rises. Both alternatives failed when measured:
// setOpacity leaves an acrylic window blank here, and moving the window blocks for 14-26 ms a
// step, which caps the motion near 27 fps. That animation needs a thick frame, hence resizable.
const WIDTH = 300;
const ROW = 45;
const CHROME = 62;
const EXIT_MS = 90;
const EDGE = 12;

let win = null;
let hiddenAt = 0;
let polishWindow = () => {};
let hideTimer = null;
let items = [];

function sorted(devices) {
  const rank = (d) => (d.offline || d.capacity == null ? 2 : d.charging ? 1 : 0);
  return [...devices].sort((a, b) => rank(a) - rank(b) || (a.capacity ?? 0) - (b.capacity ?? 0));
}

function create() {
  win = new BrowserWindow({
    width: WIDTH,
    height: CHROME + ROW,
    show: false,
    frame: false,
    resizable: true,
    movable: false,
    minimizable: false,
    maximizable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    backgroundColor: '#00000000',
    backgroundMaterial: 'acrylic',
    webPreferences: {
      backgroundThrottling: false, // keep painting while hidden so it opens on current data
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.loadFile(path.join(__dirname, '..', 'renderer', 'flyout.html'));
  win.once('ready-to-show', () => polishWindow(win));
  win.on('will-resize', (e) => e.preventDefault());
  win.on('blur', () => {
    hiddenAt = Date.now();
    hide();
  });
  win.on('closed', () => { win = null; });
}

function place(trayBounds) {
  const height = CHROME + ROW * Math.max(1, items.length);
  const { workArea } = screen.getDisplayNearestPoint({ x: trayBounds.x, y: trayBounds.y });
  const x = Math.round(Math.min(trayBounds.x + trayBounds.width / 2 - WIDTH / 2, workArea.x + workArea.width - WIDTH - EDGE));
  win.setBounds({ x: Math.max(workArea.x + EDGE, x), y: workArea.y + workArea.height - height - EDGE, width: WIDTH, height });
}

function update(devices) {
  items = sorted(devices);
  if (win && !win.isDestroyed()) win.webContents.send('flyout-data', items);
}

function open() {
  clearTimeout(hideTimer);
  win.webContents.send('flyout-open', !store.getSetting('reduceMotion'));
  win.show();
  win.focus();
}

function toggle(trayBounds, devices) {
  // Clicking the tray icon while open blurs the panel first; don't reopen it on that same click.
  if (Date.now() - hiddenAt < 250) return;
  if (!win || win.isDestroyed()) create();
  update(devices);
  place(trayBounds);
  if (win.webContents.isLoading()) win.webContents.once('did-finish-load', () => { win.webContents.send('flyout-data', items); open(); });
  else open();
}

function hide() {
  if (!win || win.isDestroyed() || !win.isVisible()) return;
  if (store.getSetting('reduceMotion')) {
    win.hide();
    return;
  }
  win.webContents.send('flyout-close');
  clearTimeout(hideTimer);
  hideTimer = setTimeout(() => { if (win && !win.isDestroyed()) win.hide(); }, EXIT_MS);
}

function prepare(polish) {
  polishWindow = polish;
  if (!win) create();
}

function destroy() {
  if (win && !win.isDestroyed()) win.destroy();
  win = null;
}

const current = () => items;

module.exports = { prepare, toggle, update, hide, destroy, current };

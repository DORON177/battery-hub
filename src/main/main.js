const { app, BrowserWindow, ipcMain, nativeTheme, Menu, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const https = require('https');

// Where update checks look — the public GitHub repo's latest release.
const UPDATE_REPO = 'DORON177/battery-hub';

// ---- Windows stability switches (must run before app 'ready') ----
// This app lives in the tray and hides/shows its window constantly. Chromium's native
// window-occlusion tracking is a well-known source of random access-violation crashes in
// exactly that scenario (seen here as faults in textinputframework.dll / combase.dll), so
// turn it off. Also drop GPU compositing to hardware only when available — a lightweight
// dashboard doesn't need it and it removes a whole class of driver-level crashes.
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');
app.disableHardwareAcceleration();

// ---- crash logging & resilience ----
// Everything the app logs (and any fatal error) goes to a file next to the settings so
// crashes leave a trail instead of a window that just vanishes.
const LOG_FILE = path.join(app.getPath('userData'), 'battery-hub.log');
function logLine(tag, msg) {
  const line = `[${new Date().toISOString()}] ${tag} ${msg}\n`;
  try { fs.appendFileSync(LOG_FILE, line); } catch (_) {}
  if (tag === 'ERROR' || tag === 'FATAL') console.error(line.trim());
}
// A stray exception in a callback (a bad HID frame, a tray redraw race) must never take
// the whole app down — log it and keep running.
process.on('uncaughtException', (err) => logLine('FATAL', `uncaughtException: ${err && err.stack || err}`));
process.on('unhandledRejection', (reason) => logLine('ERROR', `unhandledRejection: ${reason && reason.stack || reason}`));

Menu.setApplicationMenu(null);
// Required on Windows for toast notifications to display. Without a registered Start-menu
// shortcut Windows shows this string as the toast's app name, so keep it human-readable.
app.setAppUserModelId('Battery Hub');

const { detectDriver } = require('./hid/drivers');
const hidClient = require('./hid/hid-client');
const store = require('./store');
const poller = require('./poller');
const tray = require('./tray');
const notifier = require('./notifier');

const ICON = path.join(__dirname, '..', '..', 'assets', 'icon.png');
let mainWindow = null;
let isQuitting = false;

// Single instance — a second launch just focuses the running window. Crucially we
// `return` here so a second instance does NOT run any of the setup below: otherwise it
// would briefly boot its own poller (fighting the primary for the mouse's exclusive HID
// handle) and tray before quitting — a race that can crash both. `return` is valid at the
// top level of a CommonJS module (Node wraps it in a function).
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
  return;
}
app.on('second-instance', () => showWindow());

function applyTheme() {
  const theme = store.getSetting('theme') || 'system';
  nativeTheme.themeSource = theme; // 'system' | 'light' | 'dark'
}

function applyLoginItem() {
  const openAtLogin = !!store.getSetting('launchAtLogin');
  const startMinimized = !!store.getSetting('startMinimized');
  app.setLoginItemSettings({
    openAtLogin,
    args: startMinimized ? ['--hidden'] : [],
  });
}

// Single place that fans a device update out to the UI, tray, and notifications.
function broadcast(deviceState) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('battery-update', deviceState);
  }
  try { notifier.check(deviceState); } catch (e) { logLine('ERROR', `notifier failed: ${e && e.stack || e}`); }
  if (store.getSetting('trayEnabled')) {
    const reading = deviceState.lastReading;
    try {
      tray.updateDevice(deviceState.id, {
        name: deviceState.customName || deviceState.product || 'Device',
        capacity: reading ? reading.capacity : null,
        charging: !!(reading && reading.charging) && deviceState.online !== false,
        offline: deviceState.online === false,
      });
    } catch (e) { logLine('ERROR', `tray update failed: ${e && e.stack || e}`); }
  }
}

function restartPoller() {
  poller.restart(broadcast);
}

function showWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow(true);
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function createWindow(forceShow) {
  const startMinimized = !forceShow && (store.getSetting('startMinimized') || process.argv.includes('--hidden'));

  mainWindow = new BrowserWindow({
    width: 960,
    height: 660,
    minWidth: 720,
    minHeight: 500,
    show: false,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#1c1c1e' : '#ececef',
    frame: false,
    titleBarStyle: 'hidden',
    icon: ICON,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  mainWindow.once('ready-to-show', () => {
    if (!startMinimized) mainWindow.show();
  });

  mainWindow.webContents.on('render-process-gone', (evt, details) => {
    console.error('renderer process gone:', details);
  });

  // Close-to-tray: hide instead of quitting, unless the user really quit. Blur first so no
  // text control still owns the Windows input (TSF) context when the window vanishes.
  mainWindow.on('close', (e) => {
    if (!isQuitting && store.getSetting('closeToTray') && store.getSetting('trayEnabled')) {
      e.preventDefault();
      try { if (!mainWindow.webContents.isDestroyed()) mainWindow.blurWebView(); } catch (_) {}
      mainWindow.hide();
    }
  });
}

function quitApp() {
  isQuitting = true;
  tray.destroyAll();
  poller.stop();
  hidClient.stop();
  app.quit();
}

// Surface renderer/GPU/utility process crashes so a blanked window leaves a trail.
app.on('render-process-gone', (e, wc, details) => logLine('FATAL', `render-process-gone: ${JSON.stringify(details)}`));
app.on('child-process-gone', (e, details) => logLine('ERROR', `child-process-gone: ${JSON.stringify(details)}`));

app.whenReady().then(() => {
  logLine('INFO', `app ready (v${app.getVersion()}) — logging to ${LOG_FILE}`);
  applyTheme();
  applyLoginItem();
  tray.setHandlers(showWindow, quitApp);
  createWindow();
  poller.start(broadcast);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow(true);
    else showWindow();
  });
});

app.on('window-all-closed', () => {
  // With close-to-tray the window hides rather than closes, so this only fires on a
  // real quit. Keep running on macOS convention; on Windows we quit.
  if (process.platform !== 'darwin' && isQuitting) app.quit();
});

app.on('before-quit', () => { isQuitting = true; });

// ---- IPC: devices ----

ipcMain.handle('devices:list-live', async () => {
  const devices = await hidClient.enumerate();
  return devices.map((d) => ({
    id: d.id,
    vendorId: d.vendorId,
    productId: d.productId,
    product: d.product,
    manufacturer: d.manufacturer,
    channelCount: d.channels.length,
    suggestedDriver: detectDriver(d) ? detectDriver(d).id : null,
  }));
});

ipcMain.handle('devices:list-saved', () => store.getDevices());

ipcMain.handle('devices:add', (evt, { id, driverId, profile, product, manufacturer }) => {
  const saved = store.upsertDevice(id, {
    driverId, profile: profile || null, product, manufacturer, hidden: false,
  });
  restartPoller();
  return saved;
});

ipcMain.handle('devices:remove', (evt, id) => {
  store.removeDevice(id);
  notifier.reset(id);
  tray.removeDevice(id);
  restartPoller();
  return true;
});

ipcMain.handle('devices:reorder', (evt, ids) => store.reorderDevices(ids));

ipcMain.handle('devices:rename', (evt, { id, name }) => {
  const clean = (name || '').trim();
  const saved = store.upsertDevice(id, { customName: clean || null });
  restartPoller();
  return saved;
});

ipcMain.handle('devices:capture', async (evt, id) => {
  const live = (await hidClient.enumerate()).find((d) => d.id === id);
  if (!live) throw new Error('device not connected');
  return hidClient.capture(live);
});

ipcMain.handle('devices:poll-now', async () => {
  const results = [];
  await poller.pollOnce((deviceState) => {
    results.push(deviceState);
    broadcast(deviceState);
  }, { force: true });
  return results;
});

// ---- IPC: settings ----

ipcMain.handle('settings:get', () => store.getSettings());

ipcMain.handle('settings:set', (evt, patch) => {
  const before = store.getSettings();
  const after = store.setSettings(patch);

  if ('theme' in patch) applyTheme();
  if ('launchAtLogin' in patch || 'startMinimized' in patch) applyLoginItem();
  if ('pollIntervalSec' in patch) restartPoller();
  if ('trayEnabled' in patch && !patch.trayEnabled) tray.destroyAll();
  if ('trayEnabled' in patch && patch.trayEnabled) restartPoller();

  return after;
});

// ---- IPC: updates ----

// a > b for dotted numeric versions (e.g. "1.0.3" > "1.0.2")
function isNewerVersion(a, b) {
  const pa = String(a).split('.').map((n) => parseInt(n, 10) || 0);
  const pb = String(b).split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    if ((pa[i] || 0) > (pb[i] || 0)) return true;
    if ((pa[i] || 0) < (pb[i] || 0)) return false;
  }
  return false;
}

function fetchLatestRelease() {
  return new Promise((resolve, reject) => {
    const req = https.get({
      hostname: 'api.github.com',
      path: `/repos/${UPDATE_REPO}/releases/latest`,
      headers: { 'User-Agent': 'Battery-Hub', Accept: 'application/vnd.github+json' },
      timeout: 10000,
    }, (res) => {
      if (res.statusCode !== 200) { res.resume(); return reject(new Error(`GitHub returned ${res.statusCode}`)); }
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch (e) { reject(e); } });
    });
    req.on('timeout', () => req.destroy(new Error('request timed out')));
    req.on('error', reject);
  });
}

ipcMain.handle('app:version', () => app.getVersion());

ipcMain.handle('app:check-updates', async () => {
  const current = app.getVersion();
  try {
    const rel = await fetchLatestRelease();
    const latest = (rel.tag_name || '').replace(/^v/i, '');
    const exe = (rel.assets || []).find((a) => /\.exe$/i.test(a.name));
    return {
      current,
      latest,
      hasUpdate: !!latest && isNewerVersion(latest, current),
      downloadUrl: exe ? exe.browser_download_url : rel.html_url,
      pageUrl: rel.html_url,
    };
  } catch (e) {
    return { current, error: e.message };
  }
});

ipcMain.handle('app:open-external', (evt, url) => {
  if (/^https:\/\//i.test(url)) shell.openExternal(url);
});

// ---- IPC: window controls ----

ipcMain.on('window:minimize', () => {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.minimize();
});
ipcMain.on('window:close', () => {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.close();
});
ipcMain.on('app:quit', () => quitApp());

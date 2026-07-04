// Dev-only mock of the preload bridge. In Electron the preload script defines
// window.batteryHub, so this block is skipped. In a plain browser (the UI preview
// server) it installs sample data covering every visual state so the layout can be
// perfected without real hardware.
if (!window.batteryHub) {
  const now = Date.now();
  // build a {t,c,ch} history from [hoursAgo, capacity, charging?] tuples
  const mkHist = (spec) => spec.map(([h, c, ch]) => ({ t: now - h * 3600000, c, ch: ch ? 1 : 0 }));
  const sample = {
    'mouse': {
      id: 'mouse', product: 'VXE NordicMouse 1K Dongle', manufacturer: 'Compx',
      driverId: 'kysona', online: true, lastReadingAt: now - 3000,
      lastReading: { capacity: 95, charging: false, voltageMv: 4080 },
      history: mkHist([[6, 100], [5, 99], [4, 98], [3, 97], [2, 96], [1, 95], [0, 95]]),
    },
    'headset': {
      id: 'headset', product: 'MCHOSE V9 Turbo+', manufacturer: 'C-Media Electronics Inc',
      driverId: 'mchose', online: true, lastReadingAt: now - 12000,
      lastReading: { capacity: 40, charging: false, voltageMv: null },
      history: mkHist([[6, 46], [5, 45], [4, 44], [3, 43], [2, 42], [1, 41], [0, 40]]),
    },
    'keyboard': {
      id: 'keyboard', product: 'Keychron K3 Pro', manufacturer: 'Keychron',
      driverId: 'generic', online: true, lastReadingAt: now - 1000,
      lastReading: { capacity: 67, charging: true, voltageMv: null },
      history: mkHist([[1.5, 55, 1], [1, 59, 1], [0.5, 63, 1], [0, 67, 1]]),
    },
    'controller': {
      id: 'controller', product: 'DualSense Controller', manufacturer: 'Sony',
      driverId: 'generic', online: true, lastReadingAt: now - 40000,
      lastReading: { capacity: 14, charging: false, voltageMv: null },
      history: mkHist([[3, 20], [2, 18], [1.5, 17], [1, 16], [0.5, 15], [0, 14]]),
    },
    'buds': {
      id: 'buds', product: 'Galaxy Buds Pro', manufacturer: 'Samsung',
      driverId: 'generic', online: false, lastReadingAt: now - 600000,
      lastReading: { capacity: 58, charging: false, voltageMv: null },
    },
  };

  let mockSettings = {
    pollIntervalSec: 60, theme: 'system', density: 'detailed', accent: '#0a84ff',
    notifyEnabled: true, notifyThreshold: 20, notifyCharged: false,
    trayEnabled: true, trayMode: 'perDevice', closeToTray: true, launchAtLogin: false, startMinimized: false,
  };

  window.batteryHub = {
    listLiveDevices: async () => ([
      { id: 'new1', product: 'Logitech MX Master 4', manufacturer: 'Logitech', channelCount: 3, suggestedDriver: null },
    ]),
    listSavedDevices: async () => sample,
    addDevice: async () => ({}),
    removeDevice: async () => true,
    renameDevice: async (id, name) => { if (sample[id]) sample[id].customName = name; return sample[id]; },
    reorderDevices: async (ids) => { ids.forEach((id, i) => { if (sample[id]) sample[id].order = i; }); return sample; },
    capture: async () => {
      await new Promise((r) => setTimeout(r, 2500)); // simulate a scan
      return [
        { usagePage: 0xff00, reportKind: 'input', reportId: 85, bytes: [85, 1, 78, 0, 0, 0, 0, 0], count: 3 },
        { usagePage: 0xff00, reportKind: 'feature', reportId: 3, bytes: [3, 100, 0, 0], count: 12 },
      ];
    },
    pollNow: async () => Object.values(sample),
    onBatteryUpdate: () => () => {},
    getSettings: async () => ({ ...mockSettings }),
    setSettings: async (patch) => { mockSettings = { ...mockSettings, ...patch }; return { ...mockSettings }; },
    getVersion: async () => '1.1.0',
    onUpdateEvent: (cb) => { window.__updateCb = cb; return () => { window.__updateCb = null; }; },
    checkForUpdates: async () => {
      const fire = (d) => { if (window.__updateCb) window.__updateCb(d); };
      setTimeout(() => fire({ status: 'available', version: '1.1.1' }), 300);
      setTimeout(() => fire({ status: 'downloading', percent: 42 }), 600);
      setTimeout(() => fire({ status: 'downloaded', version: '1.1.1' }), 1000);
      return { status: 'checking', version: '1.1.0' };
    },
    installUpdate: async () => { window.__installed = true; },
    openExternal: async () => {},
    minimizeWindow: () => {},
    closeWindow: () => {},
    quitApp: () => {},
    __mock: true,
  };
}

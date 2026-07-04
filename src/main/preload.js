const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('batteryHub', {
  // devices
  listLiveDevices: () => ipcRenderer.invoke('devices:list-live'),
  listSavedDevices: () => ipcRenderer.invoke('devices:list-saved'),
  addDevice: (payload) => ipcRenderer.invoke('devices:add', payload),
  removeDevice: (id) => ipcRenderer.invoke('devices:remove', id),
  renameDevice: (id, name) => ipcRenderer.invoke('devices:rename', { id, name }),
  reorderDevices: (ids) => ipcRenderer.invoke('devices:reorder', ids),
  capture: (id) => ipcRenderer.invoke('devices:capture', id),
  pollNow: () => ipcRenderer.invoke('devices:poll-now'),
  onBatteryUpdate: (cb) => {
    const listener = (evt, data) => cb(data);
    ipcRenderer.on('battery-update', listener);
    return () => ipcRenderer.removeListener('battery-update', listener);
  },

  // settings
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (patch) => ipcRenderer.invoke('settings:set', patch),

  // window / app
  minimizeWindow: () => ipcRenderer.send('window:minimize'),
  closeWindow: () => ipcRenderer.send('window:close'),
  quitApp: () => ipcRenderer.send('app:quit'),
});

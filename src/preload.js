const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  getConfig: () => ipcRenderer.invoke('config:get'),
  setConfig: (cfg) => ipcRenderer.invoke('config:set', cfg),
  openAccessibilityPrefs: () => ipcRenderer.invoke('prefs:accessibility'),
  listApps: () => ipcRenderer.invoke('apps:list'),
  resolveApps: (bundleIds) => ipcRenderer.invoke('apps:resolve', bundleIds),
});

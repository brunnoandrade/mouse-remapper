const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  platform: process.platform,
  getConfig: () => ipcRenderer.invoke('config:get'),
  setConfig: (cfg) => ipcRenderer.invoke('config:set', cfg),
  setTheme: (theme) => ipcRenderer.invoke('theme:set', theme),
  resetConfig: () => ipcRenderer.invoke('config:reset'),
  exportConfig: () => ipcRenderer.invoke('config:export'),
  importConfig: () => ipcRenderer.invoke('config:import'),
  getPermission: () => ipcRenderer.invoke('permission:status'),
  getLogin: () => ipcRenderer.invoke('login:get'),
  setLogin: (enabled) => ipcRenderer.invoke('login:set', enabled),
  openAccessibilityPrefs: () => ipcRenderer.invoke('prefs:accessibility'),
  listApps: () => ipcRenderer.invoke('apps:list'),
  resolveApps: (bundleIds) => ipcRenderer.invoke('apps:resolve', bundleIds),
});

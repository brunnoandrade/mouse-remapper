const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  getConfig: () => ipcRenderer.invoke('config:get'),
  setConfig: (cfg) => ipcRenderer.invoke('config:set', cfg),
  setTheme: (theme) => ipcRenderer.invoke('theme:set', theme),
  exportConfig: () => ipcRenderer.invoke('config:export'),
  importConfig: () => ipcRenderer.invoke('config:import'),
  getPermission: () => ipcRenderer.invoke('permission:status'),
  getLogin: () => ipcRenderer.invoke('login:get'),
  setLogin: (enabled) => ipcRenderer.invoke('login:set', enabled),
  openAccessibilityPrefs: () => ipcRenderer.invoke('prefs:accessibility'),
  listApps: () => ipcRenderer.invoke('apps:list'),
  resolveApps: (bundleIds) => ipcRenderer.invoke('apps:resolve', bundleIds),
});

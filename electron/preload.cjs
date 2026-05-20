const { contextBridge, ipcRenderer } = require('electron')

function subscribe(channel, callback) {
  const listener = (_event, payload) => callback(payload)
  ipcRenderer.on(channel, listener)
  return () => {
    ipcRenderer.removeListener(channel, listener)
  }
}

contextBridge.exposeInMainWorld('racula', {
  getAppState: () => ipcRenderer.invoke('app:get-state'),
  saveConfig: (config) => ipcRenderer.invoke('config:save', config),
  checkConnection: (reason) => ipcRenderer.invoke('connection:check', reason),
  windowMinimize: () => ipcRenderer.invoke('window:minimize'),
  windowToggleMaximize: () => ipcRenderer.invoke('window:toggle-maximize'),
  windowClose: () => ipcRenderer.invoke('window:close'),
  onConnectionStatus: (callback) => subscribe('connection-status', callback),
  onConfigUpdated: (callback) => subscribe('config-updated', callback),
  onWindowState: (callback) => subscribe('window-state', callback),
})

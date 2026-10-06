const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('trialApi', {
  onAttached: (callback) => ipcRenderer.on('desktop-trial:attached', (_event, status) => callback(status)),
  exit: () => ipcRenderer.invoke('desktop-trial:exit'),
  home: () => ipcRenderer.invoke('desktop-trial:home')
});

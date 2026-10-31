const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('winApi', {
  saveFile: (o) => ipcRenderer.invoke('save-file', o),
  readBackup: () => ipcRenderer.invoke('read-backup'),
  openFolder: () => ipcRenderer.invoke('open-folder'),
  dbLoad: () => ipcRenderer.invoke('db-load'),
  dbSave: (k, v) => ipcRenderer.invoke('db-save', k, v),
  onFlush: (cb) => ipcRenderer.on('flush', async () => { try { await cb(); } catch (e) {} ipcRenderer.send('flushed'); })
});

const { contextBridge, ipcRenderer } = require('electron');
const inv = (c, ...a) => ipcRenderer.invoke(c, ...a);
/* رسائل المزامنة تصل قبل أن تجهز الواجهة: نحتفظ بها حتى تسجّل الواجهة دالة الاستقبال */
const syncCb = { remote: null, status: null, reload: null, imgs: null }, syncBuf = [];
ipcRenderer.on('sync-remote', (e, m) => { if (syncCb.remote) syncCb.remote(m); else syncBuf.push(m); });
ipcRenderer.on('sync-status', (e, m) => { if (syncCb.status) syncCb.status(m); });
ipcRenderer.on('sync-reload', () => { if (syncCb.reload) syncCb.reload(); });
ipcRenderer.on('sync-imgs', (e, m) => { if (syncCb.imgs) syncCb.imgs(m); });
let imgBase = ''; try { imgBase = ipcRenderer.sendSync('img-base') || ''; } catch (e) { imgBase = ''; }
contextBridge.exposeInMainWorld('winApi', {
  saveFile: (o) => inv('save-file', o),
  openFolder: () => inv('open-folder'),
  dbLoad: () => inv('db-load'),
  dbSave: (k, v) => inv('db-save', k, v),
  info: () => inv('info'),
  backupNow: () => inv('backup-now'),
  listBackups: () => inv('list-backups'),
  restore: (n) => inv('restore-backup', n),
  wipe: () => inv('wipe-data'),
  odooRpc: (cfg, s, m, a) => inv('odoo-rpc', cfg, s, m, a),
  machineId: () => inv('machine-id'),
  licLoad: () => inv('lic-load'),
  licSave: (t) => inv('lic-save', t),
  syncInfo: () => inv('sync-info'),
  syncSetup: (o) => inv('sync-setup', o),
  syncDiscover: () => inv('sync-discover'),
  syncPush: (o) => inv('sync-push', o),
  syncLease: (k, n) => inv('sync-lease', k, n),
  syncFull: () => inv('sync-full'),
  onSyncRemote: (cb) => { syncCb.remote = cb; syncBuf.splice(0).forEach((m) => cb(m)); },
  onSyncStatus: (cb) => { syncCb.status = cb; },
  onSyncReload: (cb) => { syncCb.reload = cb; },
  onSyncImgs: (cb) => { syncCb.imgs = cb; },
  imgPut: (b64) => inv('img-put', b64),
  imgBase,
  onFlush: (cb) => ipcRenderer.on('flush', async () => { try { await cb(); } catch (e) {} ipcRenderer.send('flushed'); })
});

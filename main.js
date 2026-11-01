const { app, BrowserWindow, Menu, ipcMain, shell } = require('electron');
const path = require('path');
const fs = require('fs');

/* منع فتح أكثر من نسخة من البرنامج */
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) { app.quit(); }

let win = null;
const root = () => path.join(app.getPath('desktop'), 'أسواق بدر');
const safe = (s) => String(s || '').replace(/[\\/:*?"<>|]/g, '_');
const dbDir = () => { const d = path.join(app.getPath('userData'), 'db'); fs.mkdirSync(d, { recursive: true }); return d; };

ipcMain.handle('save-file', async (e, o) => {
  const dir = path.join(root(), safe(o.folder));
  fs.mkdirSync(dir, { recursive: true });
  const f = path.join(dir, safe(o.name));
  fs.writeFileSync(f, o.b64 ? Buffer.from(o.b64, 'base64') : (o.text || ''));
  return f;
});

ipcMain.handle('read-backup', async () => {
  try { return fs.readFileSync(path.join(root(), 'Backup', 'backup.json'), 'utf8'); } catch (e) { return null; }
});

ipcMain.handle('open-folder', async () => { fs.mkdirSync(root(), { recursive: true }); return shell.openPath(root()); });

/* قاعدة البيانات: ملف JSON لكل جزء داخل مجلد بيانات البرنامج */
ipcMain.handle('db-load', async () => {
  const out = {}, d = dbDir();
  for (const f of fs.readdirSync(d)) {
    if (!f.endsWith('.json')) continue;
    try { out[f.slice(0, -5)] = JSON.parse(fs.readFileSync(path.join(d, f), 'utf8')); } catch (e) {}
  }
  return out;
});

ipcMain.handle('db-save', async (e, k, v) => {
  const d = dbDir(), f = path.join(d, safe(k) + '.json'), tmp = f + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(v));
  fs.renameSync(tmp, f);
  return true;
});

function createWindow() {
  win = new BrowserWindow({
    width: 1280, height: 860, title: 'أسواق بدر', autoHideMenuBar: true,
    icon: path.join(__dirname, 'build', 'icon.png'),
    webPreferences: { contextIsolation: true, nodeIntegration: false, preload: path.join(__dirname, 'preload.js') }
  });
  Menu.setApplicationMenu(null);
  win.loadFile(path.join(__dirname, 'www', 'index.html'));

  let closing = false;
  win.on('close', (ev) => {
    if (closing) return;
    ev.preventDefault();
    closing = true;
    win.webContents.send('flush');
    setTimeout(() => { win && win.destroy(); }, 4000);
  });
  ipcMain.on('flushed', () => { if (win) win.destroy(); });
  win.on('closed', () => { win = null; });
}

if (gotLock) {
  app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
  app.whenReady().then(createWindow);
  app.on('window-all-closed', () => app.quit());
}

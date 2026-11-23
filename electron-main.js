const { app, BrowserWindow, Menu, ipcMain, shell, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const zlib = require('zlib');
const os = require('os');
const odooClient = require('./odoo-client');
const { SyncManager } = require('./sync-main');
const { createImgStore } = require('./img-store');
const { pathToFileURL } = require('url');
const SyncCore = require('./www/js/sync-core.js');

/* منع فتح أكثر من نسخة من البرنامج */
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) app.quit();

let win = null;
/* مسار الحفظ: بارتشن D ثم مجلد "RMT System" (وإن لم يوجد D فمجلد المستندات) */
let BRAND = { name: 'RMT System', folder: 'RMT System', licFile: '.rmt-system.lic' };
try { BRAND = require('./brand-config.json'); } catch (e) {}
const root = () => {
  let base;
  try { base = fs.existsSync('D:\\') ? 'D:\\' : app.getPath('documents'); } catch (e) { base = app.getPath('documents'); }
  return path.join(base, BRAND.folder);
};
const safe = (s) => String(s || '').replace(/[\\/:*?"<>|]/g, '_').replace(/[. ]+$/, '').slice(0, 120) || '_';
const dbDir = () => { const d = path.join(app.getPath('userData'), 'db'); fs.mkdirSync(d, { recursive: true }); return d; };
const bkDir = () => path.join(root(), 'النسخ الاحتياطي');

/* صور المنتجات: ملفات داخل db/img (الأكبر حتى 512 بكسل + نسخة مصغّرة للقوائم) */
const imgStore = createImgStore(() => path.join(dbDir(), 'img'), (buf, kind) => {
  const img = nativeImage.createFromBuffer(buf);
  if (img.isEmpty()) return null;
  const sz = img.getSize(), enc = (im) => (kind === 'png' ? im.toPNG() : im.toJPEG(85));
  const fit = (max) => (Math.max(sz.width, sz.height) <= max ? null : img.resize(sz.width >= sz.height ? { width: max, quality: 'best' } : { height: max, quality: 'best' }));
  const m = fit(512), s = fit(192);
  return { main: m ? enc(m) : buf, thumb: s ? enc(s) : (m ? enc(m) : buf) };
});

/* المزامنة على الشبكة المحلية (منفرد / سيرفر / مستخدم) */
let sync = null;
const getSync = () => sync || (sync = new SyncManager({
  userData: app.getPath('userData'), dbDir, hostname: os.hostname(),
  toRenderer: (ch, p) => { try { if (win && !win.isDestroyed()) win.webContents.send(ch, p); } catch (e) { /* ignore */ } },
  backup: (tag) => makeBackup(tag), img: imgStore
}));
const syncOn = () => { const s = getSync(); return s.active && !!s.S; };

/* حفظ ملفات Excel: folder يمكن أن يحتوي على مسارات فرعية مفصولة بـ / */
ipcMain.handle('save-file', async (e, o) => {
  const dir = path.join(root(), ...String(o.folder || '').split('/').filter(Boolean).map(safe));
  fs.mkdirSync(dir, { recursive: true });
  const f = path.join(dir, safe(o.name));
  fs.writeFileSync(f, o.b64 ? Buffer.from(o.b64, 'base64') : (o.text || ''));
  return f;
});
ipcMain.handle('open-folder', async () => { fs.mkdirSync(root(), { recursive: true }); return shell.openPath(root()); });

/* قاعدة البيانات: ملف JSON لكل جزء (كتابة آمنة) */
ipcMain.handle('db-load', () => {
  if (syncOn()) return getSync().dbLoad();
  const out = {}, d = dbDir();
  for (const f of fs.readdirSync(d)) {
    if (!f.endsWith('.json')) continue;
    try { out[f.slice(0, -5)] = JSON.parse(fs.readFileSync(path.join(d, f), 'utf8')); } catch (e) {}
  }
  return out;
});
ipcMain.handle('db-save', async (e, k, v) => {
  /* في وضع الشبكة: الواجهة تحفظ هنا الأشياء المحلية فقط (السلة والعدّادات وإعدادات أودو)، والباقي يمر عبر المزامنة */
  if (syncOn() && SyncCore.LOCAL_FILES.indexOf(k) < 0) return true;
  const f = path.join(dbDir(), safe(k) + '.json'), tmp = f + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(v));
  fs.renameSync(tmp, f);
  return true;
});

ipcMain.handle('odoo-rpc', async (e, cfg, service, method, args) => odooClient.call(cfg, service, method, args));

ipcMain.on('img-base', (e) => { try { e.returnValue = pathToFileURL(path.join(dbDir(), 'img')).href + '/'; } catch (x) { e.returnValue = ''; } });
ipcMain.handle('img-put', (e, b64) => { const r = imgStore.put(b64); if (r.name && getSync().mode === 'client') getSync().imgAdded(); return r; });
ipcMain.handle('sync-info', () => getSync().info());
ipcMain.handle('sync-setup', async (e, o) => { const r = await getSync().setup(o); return r; });
ipcMain.handle('sync-discover', () => SyncManager.discover());
ipcMain.handle('sync-push', (e, o) => getSync().push((o && o.ops) || []));
ipcMain.handle('sync-lease', (e, k, n) => getSync().leaseFor(k, n));
ipcMain.handle('sync-full', () => getSync().fullResync());

/* رقم الجهاز: بصمة ثابتة من اسم الجهاز وعنوان الشبكة والمعالج */
ipcMain.handle('machine-id', async () => {
  const crypto = require('crypto');
  const macs = [];
  const ni = os.networkInterfaces();
  Object.keys(ni).forEach((k) => ni[k].forEach((i) => { if (!i.internal && i.mac && i.mac !== '00:00:00:00:00:00') macs.push(i.mac); }));
  macs.sort();
  const raw = [os.hostname(), macs[0] || '', (os.cpus()[0] || {}).model || '', os.platform()].join('|');
  const h = crypto.createHash('sha256').update('rmt-mid|' + raw).digest('hex').toUpperCase().slice(0, 12);
  return h.slice(0, 4) + '-' + h.slice(4, 8) + '-' + h.slice(8, 12);
});

/* ===== الترخيص: نسختان خارج قاعدة البيانات ===== */
const licFiles = () => [path.join(app.getPath('userData'), 'lic.dat'), path.join(os.homedir(), BRAND.licFile)];
ipcMain.handle('lic-load', async () => licFiles().map((f) => { try { return fs.readFileSync(f, 'utf8'); } catch (e) { return null; } }));
ipcMain.handle('lic-save', async (e, t) => { licFiles().forEach((f) => { try { fs.writeFileSync(f, t); } catch (er) {} }); return true; });

/* ===== النسخ الاحتياطي (كل ساعتين) ===== */
const p2 = (n) => String(n).padStart(2, '0');
function listBackups() {
  try {
    return fs.readdirSync(bkDir()).filter((f) => /^Backup-.*\.json\.gz$/.test(f))
      .map((f) => { const st = fs.statSync(path.join(bkDir(), f)); return { name: f, size: st.size, mtime: st.mtimeMs }; })
      .sort((a, b) => b.mtime - a.mtime);
  } catch (e) { return []; }
}
function makeBackup(tag) {
  const d = dbDir(), all = {};
  for (const f of fs.readdirSync(d)) {
    if (!f.endsWith('.json')) continue;
    try { all[f.slice(0, -5)] = JSON.parse(fs.readFileSync(path.join(d, f), 'utf8')); } catch (e) {}
  }
  if (!Object.keys(all).length) return null;
  const t = new Date();
  const name = `Backup-${t.getFullYear()}-${p2(t.getMonth() + 1)}-${p2(t.getDate())}_${p2(t.getHours())}-${p2(t.getMinutes())}-${p2(t.getSeconds())}${tag ? '-' + tag : ''}.json.gz`;
  fs.mkdirSync(bkDir(), { recursive: true });
  const f = path.join(bkDir(), name);
  fs.writeFileSync(f + '.tmp', zlib.gzipSync(JSON.stringify(all)));
  fs.renameSync(f + '.tmp', f);
  /* الاحتفاظ بآخر 150 نسخة */
  listBackups().slice(150).forEach((b) => { try { fs.unlinkSync(path.join(bkDir(), b.name)); } catch (e) {} });
  return name;
}
const clearDb = () => { const d = dbDir(); fs.readdirSync(d).forEach((f) => { if (f.endsWith('.json')) fs.unlinkSync(path.join(d, f)); }); };

ipcMain.handle('info', async () => { const l = listBackups(); return { root: root(), last: l.length ? l[0].mtime : null, version: app.getVersion() }; });
ipcMain.handle('backup-now', async () => makeBackup('يدوي'));
ipcMain.handle('list-backups', async () => listBackups());
ipcMain.handle('restore-backup', async (e, name) => {
  if (!/^Backup-[\w\-.]+\.json\.gz$/.test(name)) throw new Error('bad name');
  if (getSync().mode === 'client') throw new Error('الاسترجاع من جهاز السيرفر فقط');
  const all = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(bkDir(), name))).toString('utf8'));
  makeBackup('قبل-الاسترجاع');
  clearDb();
  for (const k of Object.keys(all)) fs.writeFileSync(path.join(dbDir(), safe(k) + '.json'), JSON.stringify(all[k]));
  if (getSync().mode === 'server') getSync().reloadFromDisk();   // العملاء يعيدون تحميل البيانات من السيرفر تلقائيًا
  return true;
});
ipcMain.handle('wipe-data', async () => {
  if (getSync().mode === 'client') throw new Error('الحذف من جهاز السيرفر فقط');
  makeBackup('قبل-الحذف'); clearDb();
  if (getSync().mode === 'server') { fs.writeFileSync(path.join(dbDir(), 'set.json'), JSON.stringify({ seeded: true, seededC: true })); getSync().reloadFromDisk(); }
  return true;
});

function startBackupTimer() {
  const TWO = 2 * 60 * 60 * 1000;
  const auto = () => { try { makeBackup('تلقائي'); } catch (e) {} };
  setTimeout(() => { const l = listBackups(); if (!l.length || Date.now() - l[0].mtime > TWO) auto(); }, 60 * 1000);
  setInterval(auto, TWO);
}

/* التحديث: عند تثبيت نسخة جديدة فوق القديمة تبقى البيانات (في مجلد بيانات البرنامج) وتُؤخذ نسخة احتياطية قبل أول تشغيل */
function checkUpdate() {
  try {
    const vf = path.join(app.getPath('userData'), 'version.txt'), cur = app.getVersion();
    let old = ''; try { old = fs.readFileSync(vf, 'utf8').trim(); } catch (e) {}
    const hasData = fs.readdirSync(dbDir()).some((f) => f.endsWith('.json'));
    if (hasData && old !== cur) makeBackup('قبل-تحديث-' + (old || 'قديم') + '-إلى-' + cur);
    fs.writeFileSync(vf, cur);
  } catch (e) {}
}
function createWindow() {
  win = new BrowserWindow({
    width: 1280, height: 860, title: BRAND.name, autoHideMenuBar: true,
    icon: path.join(__dirname, 'build', 'icon.png'),
    webPreferences: { contextIsolation: true, nodeIntegration: false, preload: path.join(__dirname, 'electron-preload.js') }
  });
  Menu.setApplicationMenu(null);
  win.loadFile(path.join(__dirname, 'www', 'index.html'));
  let closing = false;
  win.on('close', (ev) => {
    if (closing) return;
    ev.preventDefault();
    closing = true;
    win.webContents.send('flush');
    setTimeout(() => { if (win) win.destroy(); }, 4000);
  });
  ipcMain.on('flushed', () => { if (win) win.destroy(); });
  win.on('closed', () => { win = null; });
}
if (gotLock) {
  app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
  app.whenReady().then(() => { checkUpdate(); try { getSync().init(); } catch (e) { /* يعمل منفردًا لو تعذر */ } createWindow(); startBackupTimer(); });
  app.on('before-quit', () => { try { if (sync) sync.stop(); } catch (e) { /* ignore */ } });
  app.on('window-all-closed', () => app.quit());
}

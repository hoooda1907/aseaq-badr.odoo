/* اختبار بكود الواجهة الحقيقي (lib/data/pos/sync…) داخل بيئة معزولة لكل جهاز، متصلة عبر مدير مزامنة حقيقي — node test/ui.test.js */
const assert = require('assert'), fs = require('fs'), os = require('os'), path = require('path'), vm = require('vm');
const { SyncManager } = require('../sync-main.js');
const Core = require('../www/js/sync-core.js');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms, msg) { const t = Date.now(); while (Date.now() - t < (ms || 8000)) { if (await fn()) return; await sleep(30); } throw new Error('timeout: ' + msg); }
let n = 0; const ok = (m) => { n++; console.log('✔', m); };
const JS = ['sync-core', 'lib', 'data', 'pos', 'purch', 'bills', 'cus', 'inv', 'acc', 'hr', 'lic', 'br', 'offers', 'reports', 'payroll', 'prod', 'mfg', 'odoo', 'sync'];

function device(name) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rmtui-' + name + '-')), u = path.join(root, 'u'), db = path.join(u, 'db');
  fs.mkdirSync(db, { recursive: true });
  const cbs = {}, buf = [], d = { name, db, reloads: 0 }, ipc = (x) => (x === undefined ? undefined : JSON.parse(JSON.stringify(x)));
  const mgr = new SyncManager({
    userData: u, dbDir: () => db, hostname: name, backup() {},
    toRenderer(ch, p) { p = ipc(p); if (ch === 'sync-remote') { if (cbs.remote) cbs.remote(p); else buf.push(p); } if (ch === 'sync-status' && cbs.status) cbs.status(p); if (ch === 'sync-reload') d.reloads++; }
  });
  mgr.cfg.discPort = 47311;
  const store = {};
  const winApi = {
    dbLoad: async () => mgr.active ? ipc(mgr.dbLoad()) : (() => { const o = {}; fs.readdirSync(db).forEach((f) => { if (f.endsWith('.json')) o[f.slice(0, -5)] = JSON.parse(fs.readFileSync(path.join(db, f), 'utf8')); }); return o; })(),
    dbSave: async (k, v) => { v = ipc(v); if (mgr.active && Core.LOCAL_FILES.indexOf(k) < 0) return true; fs.writeFileSync(path.join(db, k + '.json'), JSON.stringify(v)); return true; },
    syncInfo: async () => ipc(mgr.info()), syncSetup: (o) => mgr.setup(o), syncDiscover: () => SyncManager.discover({ targets: ['127.0.0.1'], port: 47311, wait: 300 }),
    syncPush: async (o) => mgr.push(ipc(o).ops), syncLease: (k, c) => mgr.leaseFor(k, c), syncFull: () => mgr.fullResync(),
    onSyncRemote: (cb) => { cbs.remote = cb; buf.splice(0).forEach(cb); }, onSyncStatus: (cb) => { cbs.status = cb; }, onSyncReload: () => {}, onFlush() {}
  };
  const el = () => ({ style: {}, dataset: {}, classList: { add() {}, remove() {} }, appendChild() {}, addEventListener() {}, setAttribute() {}, hidden: false, contains: () => false });
  const sb = { console, setTimeout, clearTimeout, setInterval, clearInterval, Date, Math, JSON, Promise, Object, Array, Set, Map, String, Number, parseInt, parseFloat, isNaN, isFinite, encodeURIComponent, decodeURIComponent, unescape, escape, Error, RegExp, Intl, Blob: function () {}, URL: { createObjectURL() {} }, Image: function () {}, FileReader: function () {},
    document: { addEventListener() {}, getElementById: () => null, querySelectorAll: () => [], createElement: el, head: { appendChild() {} }, activeElement: null }, location: { reload() {} },
    localStorage: { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } }, XLSX: {} };
  sb.window = sb; sb.self = sb; sb.window.winApi = winApi; sb.BRAND = { id: 'rmt', name: 'T', adminName: 'admin', adminHash: 'x', licensed: false };
  vm.createContext(sb);
  JS.forEach((f) => vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'www', 'js', f + '.js'), 'utf8'), sb, { filename: f + '.js' }));
  d.mgr = mgr; d.sb = sb;
  d.run = (code) => vm.runInContext(code, sb);
  d.boot = async () => { await d.run('(async()=>{await dbLoad();await syncInit();reindex()})()'); };
  d.stk = () => d.run("stk('الفرع','P1')");
  return d;
}
const SELL = (q) => `(async()=>{const no=nextNo('sale');addStk('الفرع','P1',-${q});D.sales.push({no,type:'sale',br:'الفرع',lines:[{id:'P1',qty:${q}}],total:10*${q}});save('sales','stock','cnt');await flush();return no})()`;

(async () => {
  const S = device('srv'), A = device('A'), B = device('B');
  fs.writeFileSync(path.join(S.db, 'products.json'), JSON.stringify([{ id: 'P1', name: 'لبن', bc: '111', price: 10, cost: 7 }]));
  fs.writeFileSync(path.join(S.db, 'stock.json'), JSON.stringify({ 'الفرع': { P1: 100 } }));
  fs.writeFileSync(path.join(S.db, 'sales.json'), JSON.stringify([{ no: 77, type: 'sale', br: 'الفرع', lines: [], total: 1 }]));
  fs.writeFileSync(path.join(S.db, 'cnt.json'), JSON.stringify({ sale: 5 }));
  /* السيرفر */
  let r = await S.mgr.setup({ mode: 'server', key: 'abcd', port: 47310, name: 'سيرفر' }); assert.ok(r.ok);
  S.mgr.cfg.discPort = 47311; S.mgr.stop(); S.mgr.cfg.mode = 'server'; S.mgr.init();
  await S.boot(); assert.strictEqual(S.run('D.products.length'), 1); assert.ok(S.run('SYNC.on'));
  ok('جهاز السيرفر يقلع بكود الواجهة الحقيقي ويقرأ البيانات القديمة');
  /* عميلان */
  r = await A.mgr.setup({ mode: 'client', host: '127.0.0.1', port: 47310, key: 'abcd' }); assert.ok(r.ok, r.err);
  r = await B.mgr.setup({ mode: 'client', host: '127.0.0.1', port: 47310, key: 'abcd' }); assert.ok(r.ok, r.err);
  await A.boot(); await B.boot();
  assert.strictEqual(A.stk(), 100); assert.ok(A.run("SYNC.mode==='client'")); await until(() => A.mgr.connected && B.mgr.connected, 6000, 'اتصال');
  ok('عميلان يقلعان ويحصلان على المنتجات والمخزون');
  /* فهرس المنتجات يتحدث عند وصول منتج جديد */
  await S.run("(async()=>{D.products.push({id:'P9',name:'جبنة',bc:'999',price:30});save('products');await flush()})()");
  await until(() => A.run("find('999').length")===1 && B.run("find('999').length")===1, 5000, 'فهرس المنتج الجديد');
  ok('منتج جديد من السيرفر يظهر في بحث الباركود على العميلين فورًا');
  /* بيع من 3 أجهزة */
  const nos = await Promise.all([S.run(SELL(1)), A.run(SELL(3)), B.run(SELL(2))]);
  await until(() => [S, A, B].every((d) => d.stk() === 94), 6000, 'المخزون 94');
  await until(() => [S, A, B].every((d) => d.run('D.sales.length') === 4), 6000, 'الفواتير');
  assert.strictEqual(new Set(nos).size, 3); assert.ok(Math.min(...nos) > 77, 'الترقيم يبدأ بعد آخر فاتورة موجودة ' + nos);
  ok('3 أجهزة تبيع بنفس اللحظة: أرقام فواتير فريدة تكمل بعد 77، والمخزون 94 في كل مكان');
  /* 30 بيعة متتالية */
  const all = []; for (let i = 0; i < 15; i++) { all.push(await A.run(SELL(1)), await B.run(SELL(1))); }
  assert.strictEqual(new Set(all).size, 30); await until(() => [S, A, B].every((d) => d.stk() === 64 && d.run('D.sales.length') === 34), 8000, 'تقارب بعد 30 بيعة');
  ok('30 بيعة من جهازين (مع تجديد حجز الأرقام تلقائيًا): لا تكرار والكل متطابق');
  /* تعديل سعر على السيرفر يصل للعميل ويؤثر على السعر الفعلي */
  await S.run("(async()=>{PI.id.P1.price=12;save('products');await flush()})()");
  await until(() => A.run("effPrice(PI.id.P1,'الفرع').price") === 12, 5000, 'السعر');
  ok('تعديل السعر من السيرفر يصل لشاشة العميل (effPrice=12)');
  /* إعدادات أودو محلية ولا تنتقل */
  await A.run("(async()=>{D.set.odoo={on:true,key:'SECRET-A'};D.set.tax={on:true,rate:14};save('set');await flush()})()");
  await until(() => S.run('JSON.stringify(D.set.tax)') === '{"on":true,"rate":14}', 5000, 'ضريبة');
  assert.ok(!S.run("'odoo' in D.set")); assert.ok(!fs.readFileSync(path.join(S.db, 'set.json'), 'utf8').includes('SECRET'));
  assert.ok(fs.readFileSync(path.join(A.db, 'localset.json'), 'utf8').includes('SECRET-A'));
  ok('الضريبة تنتقل بين الأجهزة، ومفتاح أودو يبقى على جهازه فقط');
  /* انقطاع ثم عودة */
  S.mgr.stop(); await sleep(150);
  await A.run(SELL(4)); await B.run(SELL(5));
  S.mgr.cfg.mode = 'server'; S.mgr.init();
  await until(() => [S, A, B].every((d) => d.stk() === 55) && A.mgr.cs.outbox.length === 0 && B.mgr.cs.outbox.length === 0, 15000, 'تقارب بعد العودة');
  ok('السيرفر وقع، العميلان باعا، رجع السيرفر: كل شيء تقارب (55)');
  [A, B, S].forEach((d) => d.mgr.stop());
  console.log('\nنجحت ' + n + ' اختبارات واجهة'); process.exit(0);
})().catch((e) => { console.error('✘ فشل:', e); process.exit(1); });

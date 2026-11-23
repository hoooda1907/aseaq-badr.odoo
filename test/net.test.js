/* اختبار الشبكة الكامل: سيرفر + عميلين على نفس الجهاز (منافذ تجريبية)  —  node test/net.test.js */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { SyncManager } = require('../sync-main.js');
const Core = require('../www/js/sync-core.js');
const { createImgStore } = require('../img-store.js');

const PORT = 47210, DPORT = 47211, KEY = 'secret-123';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms, msg) { const t = Date.now(); while (Date.now() - t < (ms || 8000)) { if (await fn()) return; await sleep(25); } throw new Error('timeout: ' + (msg || fn)); }
let n = 0;
const ok = (m) => { n++; console.log('✔', m); };

/* جهاز كامل = مدير مزامنة + «واجهة» تحاكي الواجهة الحقيقية (نفس منطق sync.js) */
function makeDev(name, port) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rmt-' + name + '-'));
  const u = path.join(root, 'u'), db = path.join(u, 'db'); fs.mkdirSync(db, { recursive: true });
  const dev = { name, root, u, db, reloads: 0, remoteSeqs: [], imgNotes: 0 };
  dev.env = {
    userData: u, dbDir: () => db, hostname: name, backup() {}, img: createImgStore(() => path.join(db, 'img')),
    toRenderer(ch, p) {
      if (ch === 'sync-imgs') dev.imgNotes++;
      if (ch === 'sync-remote') { dev.remoteSeqs.push(p.seq); if (dev.D) Core.applyOps(dev.D, p.ops, dev.base); }
      if (ch === 'sync-reload') { dev.reloads++; dev.load(); }
    }
  };
  dev.m = new SyncManager(dev.env);
  if (port) dev.m.cfg.discPort = DPORT;
  dev.load = () => {
    const all = dev.m.dbLoad(); dev.D = Core.emptyState();
    Core.ALL.forEach((k) => { dev.D[k] = JSON.parse(JSON.stringify(all[k])); });
    dev.base = Core.makeBase(dev.D);
    dev.leases = {};
  };
  dev.flush = () => { const ops = Core.diff(dev.D, dev.base); Core.chunk(ops, 1000).forEach((c) => dev.m.push(c)); };
  /* بيع: ينقص المخزون ويضيف فاتورة برقم محجوز */
  dev.sell = async (br, id, q) => {
    if (!dev.leases.sale || dev.leases.sale.lo > dev.leases.sale.hi) dev.leases.sale = await dev.m.leaseFor('sale', 5);
    const no = dev.leases.sale.lo++;
    dev.D.stock[br][id] = Core.r3(dev.D.stock[br][id] - q);
    dev.D.sales.push({ no, br, lines: [{ id, q }] });
    dev.flush(); return no;
  };
  dev.stop = () => dev.m.stop();
  return dev;
}
const stockOf = (d) => d.D.stock['الفرع'].P1;

(async () => {
  /* ---------- السيرفر: بيانات موجودة مسبقًا (جهاز كان يعمل منفردًا) ---------- */
  const S = makeDev('srv');
  fs.writeFileSync(path.join(S.db, 'products.json'), JSON.stringify([{ id: 'P1', name: 'لبن', price: 10, cost: 7 }, { id: 'P2', name: 'جبن', price: 20, cost: 15 }]));
  fs.writeFileSync(path.join(S.db, 'stock.json'), JSON.stringify({ 'الفرع': { P1: 100, P2: 50 } }));
  fs.writeFileSync(path.join(S.db, 'sales.json'), JSON.stringify([{ no: 40, br: 'الفرع' }]));
  fs.writeFileSync(path.join(S.db, 'set.json'), JSON.stringify({ tax: { on: false }, odoo: { key: 'ODOO-SECRET' } }));
  fs.writeFileSync(path.join(S.db, 'cnt.json'), JSON.stringify({ sale: 12 }));
  let r = await S.m.setup({ mode: 'server', key: KEY, port: PORT, name: 'سيرفر الفرع' });
  assert.ok(r.ok); S.m.cfg.discPort = DPORT; S.m.stop(); S.m.cfg.mode = 'server'; S.m.init();
  await sleep(100); S.load();
  assert.ok(!('odoo' in S.D.set), 'إعدادات أودو لا تدخل نسخة السيرفر المتزامنة');
  assert.ok(JSON.parse(fs.readFileSync(path.join(S.db, 'localset.json'), 'utf8')).odoo, 'وتبقى محفوظة محليًا');
  ok('السيرفر يشتغل ببيانات الجهاز القديمة (وأودو تبقى محلية)');

  /* ---------- انضمام عميلين ---------- */
  const A = makeDev('A'), B = makeDev('B');
  r = await A.m.setup({ mode: 'client', host: '127.0.0.1', port: PORT, key: 'wrong-key' });
  assert.ok(!r.ok && /الرمز/.test(r.err)); ok('رمز خاطئ يُرفض برسالة واضحة');
  r = await A.m.setup({ mode: 'client', host: '127.0.0.1', port: PORT, key: KEY }); assert.ok(r.ok, r.err);
  r = await B.m.setup({ mode: 'client', host: '127.0.0.1', port: PORT, key: KEY }); assert.ok(r.ok, r.err);
  A.load(); B.load();
  assert.deepStrictEqual(A.D.products, S.D.products); assert.strictEqual(stockOf(B), 100);
  await until(() => A.m.connected && B.m.connected, 5000, 'اتصال العملاء');
  ok('عميلان ينضمان ويحصلان على نسخة كاملة من البيانات');

  /* ---------- اكتشاف تلقائي ---------- */
  const found = await SyncManager.discover({ targets: ['127.0.0.1'], port: DPORT, wait: 500 });
  assert.ok(found.length === 1 && found[0].port === PORT && found[0].name === 'سيرفر الفرع'); ok('اكتشاف السيرفر تلقائيًا على الشبكة');

  /* ---------- بيع متزامن من 3 أجهزة على نفس الصنف ---------- */
  const nos = await Promise.all([A.sell('الفرع', 'P1', 3), B.sell('الفرع', 'P1', 2), (async () => { S.D.stock['الفرع'].P1 -= 1; S.D.sales.push({ no: 999, srv: 1 }); S.flush(); return 999; })()]);
  await until(() => stockOf(A) === 94 && stockOf(B) === 94 && stockOf(S) === 94, 6000, 'تجمّع المخزون');
  await until(() => A.D.sales.length === 4 && B.D.sales.length === 4 && S.D.sales.length === 4, 6000, 'وصول الفواتير');
  assert.strictEqual(new Set(nos).size, 3); ok('بيع متزامن من 3 أجهزة: المخزون 94 على الجميع وكل الفواتير وصلت');

  /* ---------- أرقام الفواتير لا تتكرر ---------- */
  const all = [];
  for (let i = 0; i < 12; i++) { all.push(await A.sell('الفرع', 'P1', 1), await B.sell('الفرع', 'P1', 1)); }
  assert.strictEqual(new Set(all).size, all.length);
  assert.ok(Math.min(...all) > 40, 'الترقيم يكمل من آخر رقم موجود');
  await until(() => stockOf(A) === 70 && stockOf(B) === 70 && stockOf(S) === 70, 8000, 'المخزون بعد 24 بيعة');
  ok('24 فاتورة من جهازين بأرقام فريدة تكمل من آخر رقم، والمخزون 70');

  /* ---------- تعديل أسعار من جهازين على حقول مختلفة ---------- */
  A.D.products[0].price = 11; A.flush(); B.D.products[0].cost = 8; B.flush();
  await until(() => [A, B, S].every((d) => d.D.products[0].price === 11 && d.D.products[0].cost === 8), 5000, 'دمج الحقول');
  ok('تعديل السعر من جهاز والتكلفة من آخر: الاثنان يبقيان');

  /* ---------- انقطاع السيرفر ثم عودته: العمل يكمل والإرسال يتم لاحقًا ---------- */
  S.m.stop(); await sleep(200);
  await A.sell('الفرع', 'P1', 4); await B.sell('الفرع', 'P1', 5);   // أرقام محجوزة مسبقًا تكفي
  assert.ok(A.m.cs.outbox.length >= 1 && B.m.cs.outbox.length >= 1); assert.strictEqual(stockOf(A), 66);
  S.m.cfg.mode = 'server'; S.m.init();     // يعيد التشغيل من نفس الملفات (يحاكي إغلاق وفتح البرنامج)
  await until(() => A.m.connected && B.m.connected && A.m.cs.outbox.length === 0 && B.m.cs.outbox.length === 0, 15000, 'إعادة الاتصال وإرسال الطابور');
  await until(() => stockOf(A) === 61 && stockOf(B) === 61, 8000, 'تقارب المخزون بعد العودة');
  assert.strictEqual(S.m.S.stock['الفرع'].P1, 61); ok('انقطاع السيرفر: العملاء كملوا بيع، وبعد عودته تقاربت البيانات (61) بدون فقد أو تكرار');

  /* ---------- نفس الدفعة تُرسل مرتين: تُحتسب مرة واحدة ---------- */
  const ops = [{ c: 'stock', t: 'add', b: 'الفرع', i: 'P2', d: -7 }];
  await A.m.request('POST', '/sync/push', { bid: 5000000000000, ops });
  await A.m.request('POST', '/sync/push', { bid: 5000000000000, ops });
  assert.strictEqual(S.m.S.stock['الفرع'].P2, 43); ok('إعادة إرسال نفس الدفعة لا تكرر الخصم');

  /* ---------- قطع اتصال العميل B فقط: يلحق ما فاته ---------- */
  const seqB = B.m.cs.seq; B.m.dropStream();
  await A.sell('الفرع', 'P1', 1); await A.sell('الفرع', 'P1', 1);
  await until(() => stockOf(B) === 59 && B.m.cs.seq > seqB, 10000, 'B يلحق'); ok('عميل انقطع اتصاله لحظيًا يلحق التغييرات الفائتة تلقائيًا');

  /* ---------- إغلاق وفتح البرنامج على عميل أثناء غياب السيرفر: الطابور لا يضيع ---------- */
  S.m.stop(); await sleep(200);
  const before = stockOf(A);
  await A.sell('الفرع', 'P1', 2);
  A.m.stop(); const m2 = new SyncManager(A.env); m2.init(); A.m = m2; A.load();
  assert.strictEqual(stockOf(A), before - 2, 'النسخة المحلية احتفظت بالبيعة'); assert.ok(m2.cs.outbox.length >= 1, 'طابور الإرسال محفوظ على القرص');
  S.m.cfg.mode = 'server'; S.m.init();
  await until(() => A.m.connected && A.m.cs.outbox.length === 0 && S.m.S.stock['الفرع'].P1 === before - 2 && stockOf(B) === before - 2, 15000, 'تقارب بعد إعادة تشغيل العميل');
  ok('عميل أُغلق وفُتح وهو غير متصل: بيعته بقيت محفوظة وانتقلت للسيرفر ثم للجميع بعد عودته');

  /* ---------- صور المنتجات: ترفع من عميل وتصل للسيرفر ثم للعميل الآخر ---------- */
  const jpg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0]), Buffer.alloc(2000, 7), Buffer.from([0xff, 0xd9])]);
  const put = A.m.env.img.put(jpg.toString('base64')); assert.ok(put.name);
  A.D.products.push({ id: 'P3', name: 'صنف بصورة', price: 5, img: put.name }); A.flush();
  await until(() => S.m.env.img.has(put.name) && S.m.env.img.has(S.m.env.img.thumbName(put.name)), 12000, 'وصول الصورة للسيرفر');
  await until(() => B.m.env.img.has(put.name) && B.m.env.img.has(B.m.env.img.thumbName(put.name)), 12000, 'وصول الصورة للعميل الثاني');
  assert.ok(B.imgNotes >= 1 && S.imgNotes >= 1, 'الواجهة تُبلَّغ بوصول صور جديدة');
  assert.ok(B.D.products.some((p) => p.id === 'P3' && p.img === put.name));
  assert.ok(B.m.env.img.read(put.name).equals(jpg)); ok('صورة منتج رُفعت من عميل: وصلت للسيرفر ثم للعميل الآخر (الكبيرة والمصغّرة) والواجهتان اتبلّغت');
  /* ملف بتوقيع/اسم غير صالح لا يُقبل */
  let bad = null; try { await A.m.request('POST', '/sync/img?n=' + encodeURIComponent('../../evil.jpg'), jpg); } catch (e) { bad = e; }
  assert.ok(bad && bad.code === 400); ok('اسم ملف صورة غير صالح (محاولة الخروج من المجلد) يُرفض');

  /* ---------- استرجاع نسخة على السيرفر: العملاء يعيدون التحميل ---------- */
  const rel = A.reloads;
  fs.writeFileSync(path.join(S.db, 'stock.json'), JSON.stringify({ 'الفرع': { P1: 500, P2: 1 } }));
  S.m.reloadFromDisk();
  await until(() => A.reloads > rel && stockOf(A) === 500 && stockOf(B) === 500, 10000, 'إعادة التحميل'); ok('بعد استرجاع نسخة احتياطية على السيرفر العملاء يعيدون التحميل تلقائيًا');

  [A, B, S].forEach((d) => d.stop());
  console.log('\nنجحت ' + n + ' اختبارات شبكة');
  process.exit(0);
})().catch((e) => { console.error('✘ فشل:', e); process.exit(1); });

/* اختبار الصور: قراءة CSV الضخم، التعرف على أعمدة الصور، الاستيراد المنفرد/المدمج، وعدم التأثير على الصور الموجودة — node test/img.test.js
   يستخدم ملفاتك الحقيقية لو وُجدت في /mnt/user-data/uploads وإلا يولّد بيانات تجريبية. */
const assert = require('assert'), fs = require('fs'), os = require('os'), path = require('path'), vm = require('vm');
const { createImgStore } = require('../img-store.js');
const JS = ['sync-core', 'lib', 'data', 'pos', 'purch', 'bills', 'cus', 'inv', 'acc', 'hr', 'lic', 'br', 'offers', 'reports', 'payroll', 'prod', 'mfg', 'odoo', 'sync'];
const eq = (a, b, m) => assert.strictEqual(JSON.stringify(a), JSON.stringify(b), m);
let n = 0; const ok = (m) => { n++; console.log('✔', m); };

/* صورة JPEG صغيرة صالحة (يدويًا): تكفي لاختبار الحفظ بدون nativeImage */
const jpg = (seed) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0]), Buffer.alloc(300, seed), Buffer.from([0xff, 0xd9])]);
const b64 = (b) => b.toString('base64');

function env() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rmtimg-'));
  const store = createImgStore(() => path.join(dir, 'img'));
  const el = () => ({ style: {}, dataset: {}, classList: { add() {}, remove() {} }, appendChild() {}, addEventListener() {}, hidden: false });
  const sb = { console, setTimeout, clearTimeout, setInterval, clearInterval, Date, Math, JSON, Promise, Object, Array, Set, Map, String, Number, parseInt, parseFloat, isNaN, isFinite, encodeURIComponent, decodeURIComponent, Error, RegExp, Intl, TextDecoder,
    Blob: function () {}, URL: { createObjectURL() {} }, Image: function () {}, FileReader: function () {}, location: { reload() {} }, XLSX: {},
    document: { addEventListener() {}, getElementById: () => null, querySelectorAll: () => [], createElement: el, head: { appendChild() {} }, activeElement: null },
    localStorage: { getItem: () => null, setItem() {} } };
  sb.window = sb; sb.self = sb; sb.BRAND = { id: 'rmt', name: 'T', licensed: false };
  sb.window.winApi = { imgBase: 'file:///x/img/', imgPut: async (s) => store.put(s), dbLoad: async () => ({}), dbSave: async () => true, onFlush() {} };
  vm.createContext(sb);
  JS.forEach((f) => vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'www', 'js', f + '.js'), 'utf8'), sb, { filename: f + '.js' }));
  vm.runInContext('reindex()', sb);
  return { sb, store, dir, run: (c) => vm.runInContext(c, sb) };
}

/* ---------- 1) قارئ CSV ---------- */
{
  const E = env();
  const rows = E.sb.parseCsv('\uFEFFa,b,c\r\n"x, y","he said ""hi""",3\r\n"سطر\nجديد",,\r\n');
  eq(rows, [['a', 'b', 'c'], ['x, y', 'he said "hi"', '3'], ['سطر\nجديد', '', '']]);
  eq(E.sb.parseCsv('a;b\n1;2\n'), [['a', 'b'], ['1', '2']]);
  const big = 'A'.repeat(600000);
  const r2 = E.sb.parseCsv('h1,img\nP1,"' + big + '"\nP2,short');
  assert.strictEqual(r2[1][1].length, 600000); assert.strictEqual(r2.length, 3);
  ok('قارئ CSV: اقتباس وأسطر داخل الخلية وفاصلة منقوطة وخلية بحجم 600 ألف حرف');
}

/* ---------- 2) التعرف على أعمدة الصور ---------- */
{
  const E = env(), cols = (h) => E.run('imgCols(' + JSON.stringify(h) + ')');
  eq(Array.from(cols(['الاسم', 'صورة', 'صورة 512', 'صورة 256'])), [2, 3, 1]);       // 512 ثم 256 ثم العادي
  eq(Array.from(cols(['name', '512'])), [1]);
  eq(Array.from(cols(['name', 'صور 512'])), [1]);
  eq(Array.from(cols(['name', 'Image_256', 'image'])), [1, 2]);
  eq(Array.from(cols(['name', 'صورة الرسم البياني المفتوح في الموقع الإلكتروني', 'هل يمكن تكبير الصورة 1024', 'آخر صورة للتقييم'])), []);
  ok('التعرف التلقائي: صورة / صور 512 / 512 / 256 / image_256 — واستبعاد حقول الرسم البياني والتقييم والتكبير');
}

/* ---------- 3) الاستيراد المدمج ثم تحديث بدون عمود الصور ---------- */
(async () => {
  const E = env(), A = jpg(1), B = jpg(2);
  const imp = async (rows) => { const r = E.run('importProducts').call ? E.sb.importProducts(rows) : null; if (r && r.imgs && r.imgs.length) await E.sb.attachImages(r.imgs); return r; };
  let r = await imp([['معرف خارجي', 'باركود', 'الاسم', 'سعر البيع', 'صورة 512'], ['x.1', '111', 'لبن', '10', b64(A).padEnd(300, 'A').slice(0, 0) + b64(A)], ['x.2', '222', 'جبن', '20', '']]);
  assert.strictEqual(r.add, 2); assert.strictEqual(r.imgs.length, 1);
  const img1 = E.run("PI.id['x.1'].img"); assert.ok(/^[0-9a-f]{16}\.jpg$/.test(img1)); assert.ok(!E.run("PI.id['x.2'].img"));
  assert.ok(E.store.has(img1) && E.store.has(E.store.thumbName(img1)), 'الكبيرة والمصغّرة محفوظتان');
  ok('استيراد منتجات مع عمود صورة: الصورة تُحفظ وتُربط بالمنتج، والصف الفاضي لا صورة له');

  r = await imp([['معرف خارجي', 'باركود', 'الاسم', 'سعر البيع'], ['x.1', '111', 'لبن', '15'], ['x.2', '222', 'جبن', '25']]);
  assert.strictEqual(r.upd, 2); assert.strictEqual(E.run("PI.id['x.1'].price"), 15); assert.strictEqual(E.run("PI.id['x.1'].img"), img1);
  ok('تحديث المنتجات بدون عمود صور: الأسعار تتغير والصور الموجودة تبقى كما هي');

  r = await imp([['معرف خارجي', 'باركود', 'الاسم', 'سعر البيع', '256'], ['x.1', '111', 'لبن', '16', '']]);
  assert.strictEqual(E.run("PI.id['x.1'].img"), img1); assert.strictEqual(E.run("PI.id['x.1'].price"), 16);
  ok('عمود الصور موجود لكن خلية المنتج فاضية: الصورة القديمة تبقى');

  r = await imp([['معرف خارجي', 'باركود', 'الاسم', 'سعر البيع', 'صورة 256'], ['x.1', '111', 'لبن', '16', b64(B)]]);
  assert.notStrictEqual(E.run("PI.id['x.1'].img"), img1); assert.ok(E.run("PI.id['x.1'].img"));
  ok('صورة جديدة في الشيت تستبدل القديمة');

  /* ---------- 4) استيراد صور فقط ---------- */
  const C = jpg(3), Dd = jpg(4);
  r = E.sb.importProducts([['معرف خارجي', 'صورة 512'], ['x.2', b64(C)], ['zzz', b64(Dd)], ['x.1', 'محتوى هذه الخلية طويل جداً بالنسبة لملف Excel']]);
  assert.ok(r.imgOnly); assert.strictEqual(r.imgs.length, 1); assert.strictEqual(r.miss.length, 1); assert.strictEqual(r.bad, 1);
  const before = JSON.stringify(E.run("PI.id['x.2']"));
  await E.sb.attachImages(r.imgs);
  const after = E.run("PI.id['x.2']"); assert.ok(after.img); assert.strictEqual(after.name, 'جبن'); assert.strictEqual(after.price, 25);
  ok('استيراد صور فقط بالمعرف الخارجي: يربط الصورة ولا يغيّر بيانات المنتج، ويبلّغ عن غير المطابق (1) وغير الصالح (1)');

  r = E.sb.importProducts([['باركود', 'image_512'], ['111', b64(A)]]);
  assert.ok(r.imgOnly && r.imgs.length === 1 && r.imgs[0].id === 'x.1'); ok('استيراد صور فقط بالباركود');

  /* ---------- 5) عرض الصورة في الواجهة ---------- */
  const html = E.run("pimg({img:'0123456789abcdef.jpg'})"), ph = E.run("pimg({},0,1)"), none = E.run("pimg({})");
  assert.ok(html.includes('0123456789abcdef.s.jpg') && html.includes('data-fb="file:///x/img/0123456789abcdef.jpg"'));
  assert.ok(ph.includes('ph') && none === ''); ok('عرض الصورة: مصغّرة مع احتياطي للكبيرة، ومربع رمادي للجداول عند عدم وجود صورة');

  /* ---------- 6) ملفاتك الحقيقية (لو موجودة) ---------- */
  const up = '/mnt/user-data/uploads/';
  if (fs.existsSync(up + 'مش_صور.csv')) {
    const E2 = env();
    const rows = E2.sb.parseCsv(fs.readFileSync(up + 'مش_صور.csv', 'utf8'));
    const head = rows[0], ci = E2.run('imgCols(' + JSON.stringify(head) + ')');
    assert.ok(ci.length >= 1, 'تعرّف على عمود الصورة في ملفك: ' + head.join(' | '));
    const ei = head.findIndex((h) => /معرف/.test(h));
    rows.slice(1).forEach((r) => E2.run('D.products.push(' + JSON.stringify({ id: r[ei], name: 'p' + r[ei], bc: '', price: 1 }) + ')'));
    E2.run('reindex()');
    const cnt = rows.length - 1, res = E2.sb.importProducts(rows);
    assert.ok(res.imgOnly && res.imgs.length === cnt && !res.miss.length && !res.bad, JSON.stringify({ i: res.imgs && res.imgs.length, m: res.miss, b: res.bad }));
    const sv = await E2.sb.attachImages(res.imgs); assert.strictEqual(sv.fail, 0);
    ok('ملفك الحقيقي «مش_صور.csv»: ' + res.imgs.length + ' صور اتعرفت واتربطت بمنتجاتها بالمعرف الخارجي');
  }
  if (fs.existsSync(up + 'صورة_٤.csv')) {
    const E3 = env(), rows = E3.sb.parseCsv(fs.readFileSync(up + 'صورة_٤.csv', 'utf8')), h = rows[0];
    const ci = Array.from(E3.run('imgCols(' + JSON.stringify(h) + ')'));
    assert.strictEqual(h[ci[0]], 'صورة 512');
    E3.run('D.products.push({id:"AN0026",name:"x",bc:"6222014317019",ref:"AN0026"});reindex()');
    const res = E3.sb.importProducts(rows);
    assert.ok(!res.err && res.imgs.length === 1 && res.add === 0, JSON.stringify({ e: res.err, i: res.imgs && res.imgs.length, a: res.add }));
    await E3.sb.attachImages(res.imgs);
    const nm = E3.run("PI.bc['6222014317019'][0].img"); assert.ok(nm);
    assert.ok(E3.store.read(nm).length > 50000 && E3.store.read(nm).length < 70000, 'اختار نسخة 512 (حوالي 62 ك.ب) وليس 1700 ولا 256');
    ok('ملفك «صورة_٤.csv» (3 أعمدة صور مع الاسم والباركود): اختار «صورة 512» تلقائيًا وربطها بالمنتج الموجود بالباركود');
  }
  console.log('\nنجحت ' + n + ' اختبارات صور'); process.exit(0);
})().catch((e) => { console.error('✘ فشل:', e); process.exit(1); });

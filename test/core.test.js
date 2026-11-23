/* اختبار محرك المزامنة: node test/core.test.js */
const assert = require('assert');
const C = require('../www/js/sync-core.js');
const cp = x => JSON.parse(JSON.stringify(x));
const mk = () => { const D = C.emptyState(); D.cnt = {}; D.held = []; return D; };
let n = 0;
const t = (name, fn) => { fn(); n++; console.log('✔', name); };
/* جهاز: D + base ، ويتبادل العمليات مع جهاز آخر */
const dev = D => ({ D, base: C.makeBase(D) });
const push = (a, keys) => C.diff(a.D, a.base, keys);
const recv = (b, ops) => C.applyOps(b.D, cp(ops), b.base);

t('إضافة وتعديل وحذف منتج ينتقل لجهاز آخر', () => {
  const A = dev(mk()), B = dev(mk());
  A.D.products.push({ id: 'P1', name: 'لبن', price: 10, cost: 7 });
  recv(B, push(A));
  assert.deepStrictEqual(B.D.products, A.D.products);
  A.D.products[0].price = 12;
  const ops = push(A);
  assert.strictEqual(ops.length, 1); assert.strictEqual(ops[0].t, 'upd'); assert.deepStrictEqual(ops[0].s, { price: 12 });
  recv(B, ops);
  assert.strictEqual(B.D.products[0].price, 12);
  A.D.products.length = 0;
  recv(B, push(A));
  assert.strictEqual(B.D.products.length, 0);
});

t('بيع متزامن من جهازين على نفس الصنف: المخزون يتجمع ولا يُستبدل', () => {
  const S0 = mk(); S0.stock['فرع'] = { P1: 10 };
  const A = dev(cp(S0)), B = dev(cp(S0));
  A.D.stock['فرع'].P1 = 7;   // باع 3
  B.D.stock['فرع'].P1 = 8;   // باع 2
  const oa = push(A), ob = push(B);
  recv(B, oa); recv(A, ob);
  assert.strictEqual(A.D.stock['فرع'].P1, 5);
  assert.strictEqual(B.D.stock['فرع'].P1, 5);
  assert.deepStrictEqual(push(A), []); assert.deepStrictEqual(push(B), []);   // لا ارتداد للعمليات
});

t('تعديل حقلين مختلفين على نفس المنتج من جهازين: الاثنان يبقيان', () => {
  const S0 = mk(); S0.products.push({ id: 'P1', name: 'س', price: 10, cost: 7 });
  const A = dev(cp(S0)), B = dev(cp(S0));
  A.D.products[0].price = 15; B.D.products[0].cost = 8;
  const oa = push(A), ob = push(B);
  recv(B, oa); recv(A, ob);
  assert.deepStrictEqual(A.D.products[0], { id: 'P1', name: 'س', price: 15, cost: 8 });
  assert.deepStrictEqual(B.D.products[0], A.D.products[0]);
  assert.deepStrictEqual(push(A), []); assert.deepStrictEqual(push(B), []);
});

t('تعديل محلي لم يُرسل بعد لا يُمسح عند وصول تعديل بعيد على نفس الحقل', () => {
  const S0 = mk(); S0.products.push({ id: 'P1', name: 'س', price: 10, cost: 7 });
  const A = dev(cp(S0)), B = dev(cp(S0));
  A.D.products[0].price = 20;
  const oa = push(A);
  B.D.products[0].price = 99;          // تعديل محلي معلّق عند B
  recv(B, oa);
  assert.strictEqual(B.D.products[0].price, 99);
  const ob = push(B);                  // يُرسل لاحقًا ويكسب (آخر كاتب)
  assert.deepStrictEqual(ob.map(o => o.s), [{ price: 99 }]);
  recv(A, ob);
  assert.strictEqual(A.D.products[0].price, 99);
});

t('فواتير بمفتاح no وتحويلات وحذف جماعي', () => {
  const A = dev(mk()), B = dev(mk());
  for (let i = 1; i <= 50; i++) A.D.sales.push({ no: i, total: i });
  recv(B, push(A));
  assert.strictEqual(B.D.sales.length, 50);
  A.D.sales = A.D.sales.filter(s => s.no % 2);   // حذف نصف السجلات
  recv(B, push(A));
  assert.deepStrictEqual(B.D.sales.map(s => s.no), A.D.sales.map(s => s.no));
});

t('الطبقات والإعدادات والحضور: آخر تعديل يكسب، وإعدادات أودو لا تُزامَن', () => {
  const A = dev(mk()), B = dev(mk());
  A.D.layers['فرع'] = { P1: [{ q: 5, c: 3 }] };
  A.D.set.tax = { on: true, rate: 14 }; A.D.set.odoo = { key: 'SECRET' };
  A.D.att['E1|2026-01-01'] = { in: '09:00' };
  const ops = push(A);
  assert.ok(!JSON.stringify(ops).includes('SECRET'));
  recv(B, ops);
  assert.deepStrictEqual(B.D.layers['فرع'].P1, [{ q: 5, c: 3 }]);
  assert.deepStrictEqual(B.D.set, { tax: { on: true, rate: 14 } });
  delete A.D.set.tax;
  recv(B, push(A));
  assert.deepStrictEqual(B.D.set, {});
});

t('تطبيق نفس العملية على نسخة السيرفر (بدون base) يعطي نفس النتيجة', () => {
  const A = dev(mk()), SRV = mk();
  A.D.products.push({ id: 'P1', name: 'ز', price: 5 }); A.D.stock['ف'] = { P1: 4 };
  C.applyOps(SRV, cp(push(A)));
  assert.deepStrictEqual(SRV.products, A.D.products); assert.deepStrictEqual(SRV.stock, A.D.stock);
});

t('حد أدنى للعدّادات من السجلات الموجودة', () => {
  const S = mk(); S.sales.push({ no: 120 }); S.products.push({ id: 'P55' }, { id: '6221234' }); S.cnt = { sale: 10, prod: 3 };
  const f = C.counterFloor(S);
  assert.strictEqual(f.sale, 120); assert.strictEqual(f.prod, 55); assert.strictEqual(f.ses, 0);
});

t('التحقق من العمليات يرفض الأشكال الغريبة', () => {
  const ok = C.validateOps([{ c: 'stock', t: 'add', b: 'a', i: 'b', d: 1 }, { c: 'hack', t: 'put' }, { c: 'products', t: 'put', k: '1' }, null, { c: 'stock', t: 'add', b: 'a', i: 'b', d: 'x' }]);
  assert.strictEqual(ok.length, 1);
});
console.log('\nنجحت ' + n + ' اختبارات');

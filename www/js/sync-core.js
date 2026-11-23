/* ===== محرك المزامنة المشترك (يعمل داخل الواجهة وداخل Node) =====
   الفكرة: كل جهاز يقارن بياناته بآخر نسخة متزامنة (base) فيستخرج «عمليات» صغيرة:
   - قوائم السجلات (منتجات، فواتير…): إضافة / تعديل حقول / حذف بالمعرّف
   - المخزون: فروقات (+/-) فلا تضيع حركة جهازين في نفس اللحظة
   - الطبقات والإعدادات والحضور: آخر تعديل يكسب
   ثم تُرسل العمليات للسيرفر ويوزعها على باقي الأجهزة. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SyncCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* المجموعات القابلة للمزامنة ومفتاح المعرّف لكل قائمة */
  const LIST_KEYS = {
    products: 'id', suppliers: 'id', employees: 'id', customers: 'id', sales: 'no', sessions: 'id',
    cash: 'id', purchases: 'id', payments: 'id', transfers: 'no', cpay: 'id', boms: 'pid', mfg: 'id',
    uoms: 'name', pret: 'id', hradj: 'id', adv: 'id', closings: null, recs: 'id', bills: 'id'
  };
  const LEAF_KEYS = ['att', 'payrolls', 'set'];
  const ALL = Object.keys(LIST_KEYS).concat(['stock', 'layers'], LEAF_KEYS);
  /* محلي لكل جهاز ولا يُزامَن: الطلبات المعلّقة (السلة)، العدّادات، وإعدادات أودو (فيها مفتاح الـ API) */
  const LOCAL_FILES = ['held', 'cnt', 'localset'];
  const LOCAL_SET = ['odoo'];
  const SEP = '\u0001';

  const r3 = n => Math.round((+n || 0) * 1000) / 1000;
  const cp = x => (x === undefined ? undefined : JSON.parse(JSON.stringify(x)));
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

  function keyOf(c, r) {
    const f = LIST_KEYS[c];
    const v = f ? r[f] : r.at;
    return v === undefined || v === null ? '~' + JSON.stringify(r) : String(v);
  }
  const isList = c => Object.prototype.hasOwnProperty.call(LIST_KEYS, c);

  /* حالة فارغة بنفس شكل D */
  function emptyState() {
    const S = { stock: {}, layers: {}, att: {}, payrolls: {}, set: {} };
    Object.keys(LIST_KEYS).forEach(c => { S[c] = []; });
    return S;
  }

  /* ===== آخر نسخة متزامنة ===== */
  function makeBase(D) {
    const b = { lists: {}, stock: new Map(), layers: new Map(), leaf: {} };
    Object.keys(LIST_KEYS).forEach(c => {
      const m = new Map();
      (D[c] || []).forEach(r => m.set(keyOf(c, r), JSON.stringify(r)));
      b.lists[c] = m;
    });
    const st = D.stock || {};
    Object.keys(st).forEach(br => Object.keys(st[br] || {}).forEach(id => b.stock.set(br + SEP + id, r3(st[br][id]))));
    const ly = D.layers || {};
    Object.keys(ly).forEach(br => Object.keys(ly[br] || {}).forEach(id => b.layers.set(br + SEP + id, JSON.stringify(ly[br][id]))));
    LEAF_KEYS.forEach(c => {
      const m = new Map(), o = D[c] || {};
      Object.keys(o).forEach(k => {
        if (c === 'set' && LOCAL_SET.indexOf(k) >= 0) return;
        const s = JSON.stringify(o[k]);
        if (s !== undefined) m.set(k, s);
      });
      b.leaf[c] = m;
    });
    return b;
  }

  /* ===== استخراج العمليات من التغييرات المحلية (ويحدّث base في نفس اللحظة) ===== */
  function diff(D, base, only) {
    const ops = [];
    const want = c => !only || only.indexOf(c) >= 0;
    Object.keys(LIST_KEYS).forEach(c => {
      if (!want(c)) return;
      const m = base.lists[c] || (base.lists[c] = new Map());
      const seen = new Set();
      (D[c] || []).forEach(r => {
        const k = keyOf(c, r), s = JSON.stringify(r);
        seen.add(k);
        const o = m.get(k);
        if (o === undefined) { ops.push({ c, t: 'put', k, r: JSON.parse(s) }); m.set(k, s); return; }
        if (o === s) return;
        const a = JSON.parse(o), b = JSON.parse(s), set = {}, un = [];
        Object.keys(b).forEach(f => { if (!same(a[f], b[f])) set[f] = b[f]; });
        Object.keys(a).forEach(f => { if (!(f in b)) un.push(f); });
        if (Object.keys(set).length || un.length) ops.push({ c, t: 'upd', k, s: set, u: un });
        m.set(k, s);
      });
      Array.from(m.keys()).forEach(k => { if (!seen.has(k)) { ops.push({ c, t: 'del', k }); m.delete(k); } });
    });
    if (want('stock')) {
      const cur = new Map(), st = D.stock || {};
      Object.keys(st).forEach(br => Object.keys(st[br] || {}).forEach(id => cur.set(br + SEP + id, r3(st[br][id]))));
      cur.forEach((v, k) => {
        const old = base.stock.get(k) || 0, d = r3(v - old);
        if (Math.abs(d) > 1e-9) { const p = k.split(SEP); ops.push({ c: 'stock', t: 'add', b: p[0], i: p.slice(1).join(SEP), d }); }
        base.stock.set(k, v);
      });
      Array.from(base.stock.keys()).forEach(k => {
        if (cur.has(k)) return;
        const old = base.stock.get(k) || 0;
        if (Math.abs(old) > 1e-9) { const p = k.split(SEP); ops.push({ c: 'stock', t: 'add', b: p[0], i: p.slice(1).join(SEP), d: r3(-old) }); }
        base.stock.delete(k);
      });
    }
    if (want('layers')) {
      const cur = new Map(), ly = D.layers || {};
      Object.keys(ly).forEach(br => Object.keys(ly[br] || {}).forEach(id => cur.set(br + SEP + id, JSON.stringify(ly[br][id]))));
      cur.forEach((s, k) => {
        if (base.layers.get(k) === s) return;
        const p = k.split(SEP);
        ops.push({ c: 'layers', t: 'set', b: p[0], i: p.slice(1).join(SEP), v: JSON.parse(s) });
        base.layers.set(k, s);
      });
      Array.from(base.layers.keys()).forEach(k => {
        if (cur.has(k)) return;
        const p = k.split(SEP);
        ops.push({ c: 'layers', t: 'set', b: p[0], i: p.slice(1).join(SEP), v: null });
        base.layers.delete(k);
      });
    }
    LEAF_KEYS.forEach(c => {
      if (!want(c)) return;
      const m = base.leaf[c] || (base.leaf[c] = new Map()), o = D[c] || {};
      Object.keys(o).forEach(k => {
        if (c === 'set' && LOCAL_SET.indexOf(k) >= 0) return;
        const s = JSON.stringify(o[k]);
        if (s === undefined) return;
        if (m.get(k) !== s) { ops.push({ c, t: 'set', k, v: JSON.parse(s) }); m.set(k, s); }
      });
      Array.from(m.keys()).forEach(k => { if (!(k in o)) { ops.push({ c, t: 'unset', k }); m.delete(k); } });
    });
    return ops;
  }

  /* ===== تطبيق عمليات (من السيرفر أو من جهاز آخر) على D أو على نسخة السيرفر.
     لو مُرّر base: تُحمى التعديلات المحلية التي لم تُرسل بعد، ويُحدَّث base ليطابق ما وصل. ===== */
  function replaceInPlace(t, src) {
    Object.keys(t).forEach(f => { if (!(f in src)) delete t[f]; });
    Object.keys(src).forEach(f => { t[f] = src[f]; });
  }

  function applyOps(S, ops, base) {
    const touched = new Set(), idx = {}, dead = {};
    const getIdx = c => {
      if (idx[c]) return idx[c];
      const arr = S[c] || (S[c] = []), m = new Map();
      arr.forEach(r => m.set(keyOf(c, r), r));
      return (idx[c] = m);
    };
    ops.forEach(o => {
      const c = o.c;
      if (isList(c)) {
        const m = getIdx(c), bm = base ? (base.lists[c] || (base.lists[c] = new Map())) : null;
        if (o.t === 'del') {
          const r = m.get(o.k);
          if (r) { (dead[c] = dead[c] || new Set()).add(r); m.delete(o.k); }
          if (bm) bm.delete(o.k);
          touched.add(c); return;
        }
        let s, u;
        if (o.t === 'put') { s = cp(o.r); u = null; } else if (o.t === 'upd') { s = cp(o.s) || {}; u = o.u || []; } else return;
        const ex = m.get(o.k);
        if (!ex) {
          if (o.t === 'upd') return; /* تعديل على سجل غير موجود: يُتجاهل */
          (S[c] || (S[c] = [])).push(s);
          m.set(o.k, s);
          if (bm) bm.set(o.k, JSON.stringify(s));
          touched.add(c); return;
        }
        if (o.t === 'put') u = Object.keys(ex).filter(f => !(f in s));
        let pending = null, old = null;
        if (bm) {
          const bs = bm.get(o.k);
          if (bs === undefined) return; /* سجل محلي جديد لم يُرسل بنفس المعرّف: نحتفظ بالمحلي */
          old = JSON.parse(bs); pending = new Set();
          new Set(Object.keys(ex).concat(Object.keys(old))).forEach(f => { if (!same(ex[f], old[f])) pending.add(f); });
        }
        Object.keys(s).forEach(f => { if (!(pending && pending.has(f))) ex[f] = s[f]; });
        u.forEach(f => { if (!(pending && pending.has(f))) delete ex[f]; });
        if (bm) {
          const nb = {};
          Object.keys(ex).forEach(f => {
            if (pending.has(f)) { if (f in s) nb[f] = s[f]; else if (!u.includes(f)) nb[f] = old[f]; } else nb[f] = ex[f];
          });
          pending.forEach(f => { if (!(f in ex) && f in old && !u.includes(f) && !(f in s)) nb[f] = old[f]; });
          bm.set(o.k, JSON.stringify(nb));
        }
        touched.add(c);
      } else if (c === 'stock' && o.t === 'add') {
        const d = +o.d || 0;
        S.stock = S.stock || {};
        const bo = S.stock[o.b] || (S.stock[o.b] = {});
        bo[o.i] = r3((bo[o.i] || 0) + d);
        if (base) { const k = o.b + SEP + o.i; base.stock.set(k, r3((base.stock.get(k) || 0) + d)); }
        touched.add('stock');
      } else if (c === 'layers' && o.t === 'set') {
        S.layers = S.layers || {};
        const k = o.b + SEP + o.i, ser = o.v === null || o.v === undefined ? undefined : JSON.stringify(o.v);
        if (base) {
          const cur = (S.layers[o.b] || {})[o.i], curS = cur === undefined ? undefined : JSON.stringify(cur), bs = base.layers.get(k);
          if (curS !== bs) { if (ser === undefined) base.layers.delete(k); else base.layers.set(k, ser); return; } /* تعديل محلي معلّق */
          if (ser === undefined) base.layers.delete(k); else base.layers.set(k, ser);
        }
        if (ser === undefined) { if (S.layers[o.b]) delete S.layers[o.b][o.i]; } else (S.layers[o.b] || (S.layers[o.b] = {}))[o.i] = JSON.parse(ser);
        touched.add('layers');
      } else if (LEAF_KEYS.indexOf(c) >= 0 && (o.t === 'set' || o.t === 'unset')) {
        if (c === 'set' && LOCAL_SET.indexOf(o.k) >= 0) return;
        S[c] = S[c] || {};
        const ser = o.t === 'set' ? JSON.stringify(o.v) : undefined;
        if (base) {
          const m = base.leaf[c] || (base.leaf[c] = new Map()), curS = S[c][o.k] === undefined ? undefined : JSON.stringify(S[c][o.k]);
          if (curS !== m.get(o.k)) { if (ser === undefined) m.delete(o.k); else m.set(o.k, ser); return; }
          if (ser === undefined) m.delete(o.k); else m.set(o.k, ser);
        }
        if (ser === undefined) delete S[c][o.k]; else S[c][o.k] = JSON.parse(ser);
        touched.add(c);
      }
    });
    Object.keys(dead).forEach(c => {
      const arr = S[c], dd = dead[c];
      let j = 0;
      for (let i = 0; i < arr.length; i++) if (!dd.has(arr[i])) arr[j++] = arr[i];
      arr.length = j;
    });
    return touched;
  }

  /* تنظيف ما يصل من الشبكة: نقبل أشكالًا معروفة فقط */
  function validateOps(ops) {
    if (!Array.isArray(ops)) return [];
    return ops.filter(o => {
      if (!o || typeof o !== 'object' || typeof o.c !== 'string') return false;
      if (isList(o.c)) return (o.t === 'put' && o.r && typeof o.r === 'object' && typeof o.k === 'string') || (o.t === 'upd' && typeof o.k === 'string' && o.s && typeof o.s === 'object') || (o.t === 'del' && typeof o.k === 'string');
      if (o.c === 'stock') return o.t === 'add' && typeof o.b === 'string' && typeof o.i === 'string' && typeof o.d === 'number' && isFinite(o.d);
      if (o.c === 'layers') return o.t === 'set' && typeof o.b === 'string' && typeof o.i === 'string';
      if (LEAF_KEYS.indexOf(o.c) >= 0) return (o.t === 'set' || o.t === 'unset') && typeof o.k === 'string';
      return false;
    });
  }

  function chunk(ops, n) {
    const out = [];
    for (let i = 0; i < ops.length; i += n) out.push(ops.slice(i, i + n));
    return out;
  }

  /* أقل قيمة آمنة لكل عدّاد: أكبر رقم موجود فعلًا في السجلات */
  const CNT_SRC = {
    sale: ['sales', 'no'], pur: ['purchases', 'id'], ses: ['sessions', 'id'], tr: ['transfers', 'no'], pay: ['payments', 'id'],
    cash: ['cash', 'id'], prod: ['products', 'id', 'P'], sup: ['suppliers', 'id', 'S'], emp: ['employees', 'id', 'E'],
    cus: ['customers', 'id', 'C'], cpay: ['cpay', 'id'], mfg: ['mfg', 'id'], pret: ['pret', 'id'], adj: ['hradj', 'id'],
    adv: ['adv', 'id'], rec: ['recs', 'id'], bill: ['bills', 'id']
  };
  const CNT_KEYS = Object.keys(CNT_SRC);
  function counterFloor(S) {
    const out = {};
    CNT_KEYS.forEach(k => {
      const [c, f, pre] = CNT_SRC[k];
      let mx = (S.cnt && +S.cnt[k]) || 0;
      (S[c] || []).forEach(r => {
        let v = r[f];
        if (pre) { if (typeof v !== 'string' || v.charAt(0) !== pre) return; v = v.slice(1); }
        v = Number(v);
        if (isFinite(v) && v > mx && v < 1e12) mx = v;
      });
      out[k] = mx;
    });
    return out;
  }

  return { LIST_KEYS, LEAF_KEYS, ALL, LOCAL_FILES, LOCAL_SET, CNT_KEYS, emptyState, makeBase, diff, applyOps, validateOps, chunk, counterFloor, keyOf, r3 };
});

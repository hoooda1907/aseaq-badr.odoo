/* ===== ربط الواجهة بالمزامنة على الشبكة المحلية =====
   - يستخرج التغييرات من D عند كل حفظ ويرسلها للسيرفر عبر العملية الرئيسية
   - يطبّق التغييرات الواصلة من الأجهزة الأخرى على D
   - يحجز أرقام الفواتير وغيرها من السيرفر حتى لا يتكرر رقم بين جهازين
   - شاشة «الشبكة والمزامنة» لاختيار وضع الجهاز (منفرد / سيرفر / مستخدم) */
const SYNC = { on: false, mode: 'standalone', base: null, q: [], sending: false, leases: {}, info: null, stale: false, lastRefresh: 0 };
const LEASE_SIZE = { sale: 20, ses: 5, tr: 5 }, LEASE_DEF = 10, LEASE_LOW = 5;
const LEASE_KEYS = ['sale', 'pur', 'ses', 'tr', 'pay', 'cash', 'prod', 'sup', 'emp', 'cus', 'cpay', 'mfg', 'pret', 'adj', 'adv', 'rec', 'bill'];
const leaseStoreKey = () => 'rmt_leases_' + ((SYNC.info && SYNC.info.devId) || 'x');

/* يُستدعى بعد تحميل البيانات: يعرف الوضع الحالي ويجهّز نقطة المقارنة */
async function syncInit(all) {
  SYNC.on = false; SYNC.mode = 'standalone';
  if (!(api && api.syncInfo)) return;
  try { SYNC.info = await api.syncInfo(); } catch (e) { return; }
  SYNC.mode = SYNC.info.mode;
  if (SYNC.mode === 'standalone') return;
  SYNC.on = true; SYNC.base = SyncCore.makeBase(D);
  try { SYNC.leases = JSON.parse(localStorage.getItem(leaseStoreKey()) || '{}'); } catch (e) { SYNC.leases = {}; }
  if (api.onSyncRemote) api.onSyncRemote(syncRemote);
  if (api.onSyncStatus) api.onSyncStatus(i => { SYNC.info = i; syncChip(); if (LAST && LAST.v === 'sync') syncPaint(); });
  if (api.onSyncReload) api.onSyncReload(() => location.reload());
  if (api.onSyncImgs) api.onSyncImgs(() => { if (LAST && LAST.v === 'pos' && typeof renderGrid === 'function') { try { renderGrid(); } catch (e) { /* ignore */ } } else syncRefreshView(new Set(['products'])); });
  syncChip();
  await Promise.all(LEASE_KEYS.map(k => syncLease(k, true)));
}

/* ===== إرسال التغييرات ===== */
async function syncFlush(keys) {
  const ks = keys.filter(k => SyncCore.ALL.indexOf(k) >= 0);
  const loc = keys.filter(k => SyncCore.LOCAL_FILES.indexOf(k) >= 0 || (k === 'set'));
  /* الأشياء المحلية (الطلبات المعلّقة والعدّادات وإعدادات أودو) تُحفظ في الجهاز فقط */
  for (const k of loc) {
    if (k === 'set') { if (D.set.odoo !== undefined) try { await api.dbSave('localset', { odoo: D.set.odoo }); } catch (e) { /* ignore */ } continue; }
    try { await api.dbSave(k, D[k]); } catch (e) { say('تعذر حفظ البيانات: ' + k, 1); }
  }
  if (ks.length) {
    const ops = SyncCore.diff(D, SYNC.base, ks);
    if (ops.length) SyncCore.chunk(ops, 800).forEach(c => SYNC.q.push(c));
  }
  await syncDrain();
}
async function syncDrain() {
  if (SYNC.sending) { while (SYNC.sending) await new Promise(r => setTimeout(r, 20)); if (!SYNC.q.length) return; }
  SYNC.sending = true;
  try {
    while (SYNC.q.length) {
      const c = SYNC.q[0];
      try { await api.syncPush({ ops: c }); SYNC.q.shift(); } catch (e) { say('تعذر حفظ البيانات — أعد المحاولة', 1); await new Promise(r => setTimeout(r, 1500)); }
    }
  } finally { SYNC.sending = false; }
}

/* ===== استقبال تغييرات الأجهزة الأخرى ===== */
function syncRemote(msg) {
  let touched;
  try { touched = SyncCore.applyOps(D, msg.ops, SYNC.base); } catch (e) { say('خطأ في استقبال تحديث من جهاز آخر', 1); return; }
  if (touched.has('products') || touched.has('uoms')) reindex();
  if (touched.has('set')) { syncBranches(); applyLogo(); }
  syncRefreshView(touched);
}
const PASSIVE = ['home', 'products', 'inventory', 'review', 'accounts', 'customers', 'suppliers', 'purchases', 'employees', 'branches'];
function syncRefreshView(touched) {
  if (!ME) return;
  const busy = !$('md').hidden || (document.activeElement && /^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement.tagName) && $('main').contains(document.activeElement));
  if (!busy && PASSIVE.indexOf(LAST.v) >= 0 && LAST.a == null && Date.now() - SYNC.lastRefresh > 4000) {
    SYNC.lastRefresh = Date.now(); SYNC.stale = false;
    try { V[LAST.v](); } catch (e) { /* ignore */ }
  } else if (LAST.v !== 'pos') SYNC.stale = true;
  syncChip();
}
A.syncRefresh = () => { SYNC.stale = false; SYNC.lastRefresh = Date.now(); go(LAST.v, LAST.a); };

/* ===== الأرقام المحجوزة (فواتير، جلسات…): كل جهاز عنده مجموعة أرقام خاصة به ===== */
function leaseLeft(k) { return (SYNC.leases[k] || []).reduce((a, r) => a + Math.max(0, r[1] - r[0] + 1), 0); }
function leaseSave() { try { localStorage.setItem(leaseStoreKey(), JSON.stringify(SYNC.leases)); } catch (e) { /* ignore */ } }
async function syncLease(k, force) {
  if (!SYNC.on || SYNC._busy && SYNC._busy[k]) return;
  const size = LEASE_SIZE[k] || LEASE_DEF;
  if (!force && leaseLeft(k) >= LEASE_LOW) return;
  if (leaseLeft(k) >= size * 2) return;
  (SYNC._busy = SYNC._busy || {})[k] = 1;
  try {
    const r = await api.syncLease(k, size);
    (SYNC.leases[k] = SYNC.leases[k] || []).push([r.lo, r.hi]); leaseSave();
  } catch (e) { /* غير متصل: نستخدم الأرقام المحجوزة سابقًا */ } finally { SYNC._busy[k] = 0; }
}
/* حجز عدد كبير من الأرقام دفعة واحدة قبل عمليات الاستيراد الضخمة (آلاف العملاء أو الموردين) */
async function syncReserve(k, n) {
  if (!SYNC.on || !k) return;
  n = Math.min((n || 0) + 10, 200000);
  while (leaseLeft(k) < n) {
    const need = Math.min(1000, n - leaseLeft(k));
    try { const r = await api.syncLease(k, need); (SYNC.leases[k] = SYNC.leases[k] || []).push([r.lo, r.hi]); leaseSave(); }
    catch (e) { say('تعذر حجز أرقام للاستيراد — تأكد من الاتصال بالسيرفر', 1); throw e; }
  }
}
/* بديل ++D.cnt.x : رقم فريد على كل الأجهزة */
function nextNo(k) {
  if (!SYNC.on) return ++D.cnt[k];
  const q = SYNC.leases[k] || (SYNC.leases[k] = []);
  while (q.length && q[0][0] > q[0][1]) q.shift();
  if (!q.length) { say('انتهت أرقام المستندات المحجوزة لهذا الجهاز — اتصل بالسيرفر ثم أعد المحاولة', 1); syncLease(k, true); throw new Error('no numbers'); }
  const n = q[0][0]++;
  leaseSave();
  if (leaseLeft(k) < LEASE_LOW) syncLease(k);
  return n;
}

/* ===== شريط الحالة ===== */
function syncChip() {
  let c = $('syncChip');
  if (!c) { c = document.createElement('button'); c.id = 'syncChip'; c.dataset.a = 'syncChipGo'; const w = $('who'); if (w && w.parentNode) w.parentNode.insertBefore(c, w.nextSibling); else return; }
  const i = SYNC.info;
  if (!SYNC.on || !i) { c.hidden = true; return; }
  c.hidden = false;
  if (SYNC.stale) { c.textContent = '🔄 وصلت تحديثات — اضغط لتحديث الشاشة'; c.dataset.a = 'syncRefresh'; return; }
  c.dataset.a = 'syncChipGo';
  if (i.mode === 'server') { const n = (i.devices || []).filter(d => d.online).length; c.textContent = '🖥️ سيرفر — ' + n + ' جهاز متصل'; }
  else if (i.connected) c.textContent = '🟢 متصل بالسيرفر' + (i.pending ? ' — جاري إرسال ' + i.pending : '');
  else c.textContent = '🟠 غير متصل بالسيرفر' + (i.pending ? ' — ' + i.pending + ' عملية محفوظة للإرسال' : ' — العمل مستمر');
}
A.syncChipGo = () => go('sync');

/* ===== شاشة الشبكة والمزامنة ===== */
const SYN = { found: [], busy: false };
function syncPaint() {
  const i = SYNC.info || { mode: 'standalone' };
  const modeTxt = { standalone: 'جهاز منفرد (بدون ربط)', server: 'سيرفر (يحتفظ بالبيانات ويوزّعها)', client: 'مستخدم (متصل بسيرفر الفرع)' }[i.mode];
  const dev = (i.devices || []).map(d => `<tr><td class="l">${esc(d.name)}</td><td>${esc(d.ip || '')}</td><td>${d.online ? '🟢 متصل' : '⚪ غير متصل'}</td><td>${esc(fdate(d.last))}</td></tr>`).join('');
  const st = `<div class="card"><div class="ttl" style="font-size:17px">حالة هذا الجهاز</div>
   <div>الوضع الحالي: <b>${modeTxt}</b></div><div class="mut">اسم الجهاز: ${esc(i.devName || '')}</div>
   ${i.mode === 'server' ? `<div class="mut">عناوين هذا الجهاز على الشبكة (اكتبها في الأجهزة الأخرى لو لم تظهر تلقائيًا): <b style="direction:ltr;display:inline-block">${esc((i.ips || []).join(' ، ') || '—')}</b> — المنفذ ${i.port}</div>${tbl(['الجهاز', 'العنوان', 'الحالة', 'آخر ظهور'], dev || '<tr><td colspan="4" class="mut">لم يتصل أي جهاز بعد</td></tr>')}` : ''}
   ${i.mode === 'client' ? `<div>السيرفر: <b>${esc(i.serverName || '')}</b> (${esc(i.host || '')}) — ${i.connected ? '<span style="color:var(--ok)">متصل</span>' : '<span class="err">غير متصل</span>'}</div><div class="mut">عمليات بانتظار الإرسال: ${i.pending || 0}</div><button data-a="synFull" style="margin-top:8px">⬇️ إعادة تحميل كل البيانات من السيرفر</button>` : ''}
   ${i.error ? `<div class="err" style="margin-top:6px">${esc(i.error)}</div>` : ''}</div>`;
  const found = SYN.found.map((s, n) => `<div class="row" style="padding:8px;border-bottom:1px solid var(--bd)"><b style="flex:1">${esc(s.name)} <span class="mut" style="direction:ltr;display:inline-block">${esc(s.host)}</span></b><button class="p" data-a="synPick" data-n="${n}">اختيار</button></div>`).join('');
  const setup = `<div class="card"><div class="ttl" style="font-size:17px">تغيير وضع هذا الجهاز</div>
   <div class="mut" style="margin-bottom:8px">جهاز السيرفر واحد فقط في الفرع، وهو الجهاز الذي عليه البيانات. باقي الأجهزة (الكاشيرات والاستلامات) «مستخدم». كل الأجهزة تحتاج نفس الرمز السري.</div>
   <div class="row"><button class="p" data-a="synServer">🖥️ اجعل هذا الجهاز سيرفرًا</button><button data-a="synFind">🔍 البحث عن سيرفر على الشبكة</button>${i.mode !== 'standalone' ? '<button class="d" data-a="synOff">إيقاف الربط (جهاز منفرد)</button>' : ''}</div>
   <div id="synFound" style="margin-top:8px">${SYN.busy ? '<span class="mut">جاري البحث…</span>' : found}</div>
   <div class="row" style="margin-top:8px"><button data-a="synManual">✍️ إدخال عنوان السيرفر يدويًا</button></div></div>`;
  setMain(`<div class="ttl">الشبكة والمزامنة</div>${st}${setup}
   <div class="card mut">⚠️ عند أول تشغيل للسيرفر قد يسأل ويندوز عن السماح بالاتصال — اختر «السماح» للشبكات الخاصة. ولو الإنترنت مقطوع والشبكة المحلية شغالة تستمر الأجهزة في العمل والمزامنة مع بعضها.</div>`);
}
V.sync = () => {
  if (!ME.admin) { say('للإدارة فقط', 1); return go('home'); }
  if (!(api && api.syncInfo)) { setMain('<div class="card err">الربط على الشبكة متاح في نسخة ويندوز فقط</div>'); return; }
  api.syncInfo().then(i => { SYNC.info = i; syncPaint(); });
};
async function syncApply(o) {
  await flush();
  const r = await api.syncSetup(o);
  if (!r || !r.ok) { say((r && r.err) || 'تعذر الإعداد', 1); return r; }
  say('تم — جاري إعادة التشغيل…'); setTimeout(() => location.reload(), 900); return r;
}
A.synServer = async () => {
  const r = await formDlg('جعل هذا الجهاز سيرفرًا', [{ k: 'n', l: 'اسم السيرفر (يظهر للأجهزة الأخرى)', v: (SYNC.info && SYNC.info.devName) || '' }, { k: 'k', l: 'الرمز السري للشبكة (4 خانات على الأقل — نفسه يُكتب في كل الأجهزة)' }, { k: 'p', l: 'المنفذ', t: 'number', v: 4720 }], 'تفعيل');
  if (!r) return;
  if (!(await dlg('هذا الجهاز سيصبح هو مصدر البيانات لباقي الأجهزة، وبياناته الحالية هي اللي هتتوزّع. متابعة؟', { yes: 'متابعة' }))) return;
  syncApply({ mode: 'server', name: r.n, key: r.k, port: r.p });
};
A.synFind = async () => {
  SYN.busy = true; SYN.found = []; syncPaint();
  try { SYN.found = await api.syncDiscover(); } catch (e) { SYN.found = []; }
  SYN.busy = false; syncPaint();
  if (!SYN.found.length) say('لم يظهر سيرفر — تأكد أن السيرفر شغال وأن الجدار الناري يسمح، أو اكتب العنوان يدويًا', 1);
};
async function synJoin(host, port) {
  const r = await formDlg('الانضمام لسيرفر ' + host, [{ k: 'k', l: 'الرمز السري للشبكة' }], 'انضمام');
  if (!r) return;
  if (!(await dlg('سيتم استبدال بيانات هذا الجهاز ببيانات السيرفر (تُحفظ نسخة احتياطية من بيانات هذا الجهاز أولًا). متابعة؟', { yes: 'متابعة' }))) return;
  say('جاري تحميل البيانات من السيرفر…');
  syncApply({ mode: 'client', host, port, key: r.k });
}
A.synPick = t => { const s = SYN.found[+t.dataset.n]; if (s) synJoin(s.host, s.port); };
A.synManual = async () => {
  const r = await formDlg('عنوان السيرفر', [{ k: 'h', l: 'عنوان السيرفر (مثال 192.168.1.10)' }, { k: 'p', l: 'المنفذ', t: 'number', v: 4720 }], 'متابعة');
  if (!r || !norm(r.h)) return; synJoin(norm(r.h), +r.p || 4720);
};
A.synOff = async () => {
  if (!(await dlg('إيقاف الربط؟ سيبقى هذا الجهاز بآخر بيانات وصلته ويعمل منفردًا.', { yes: 'إيقاف' }))) return;
  syncApply({ mode: 'standalone' });
};
A.synFull = async () => {
  if (!(await dlg('تحميل كل البيانات من السيرفر من جديد؟ (العمليات التي لم تُرسل بعد لن تضيع)', { yes: 'تحميل' }))) return;
  await flush(); say('جاري التحميل…');
  const r = await api.syncFull(); if (r && !r.ok) say(r.err || 'تعذر التحميل', 1);
};

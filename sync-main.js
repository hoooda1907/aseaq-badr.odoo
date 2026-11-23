/* ===== المزامنة على الشبكة المحلية (تعمل في العملية الرئيسية لإلكترون) =====
   ثلاثة أوضاع:
   - standalone: كما كان (جهاز واحد)
   - server:     هذا الجهاز يحتفظ بالبيانات ويوزّع التغييرات (HTTP + SSE على المنفذ 4720، واكتشاف UDP على 4721)
   - client:     هذا الجهاز يحتفظ بنسخة محلية ويتصل بالسيرفر؛ لو انقطع الاتصال يكمل العمل ويرسل لاحقًا */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const zlib = require('zlib');
const dgram = require('dgram');
const os = require('os');
const Core = require('./www/js/sync-core.js');

const PORT = 4720, DPORT = 4721;
const LOG_MAX_BYTES = 120 * 1024 * 1024, TS_WINDOW = 10 * 60 * 1000, HB_MS = 15000, STALL_MS = 45000;

const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const sign = (key, ts, method, pathq, bodyHash) => crypto.createHmac('sha256', key).update(ts + '\n' + method + '\n' + pathq + '\n' + bodyHash).digest('hex');
const rid = (n) => crypto.randomBytes(n).toString('hex');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const cp = (x) => JSON.parse(JSON.stringify(x));

function readJson(f, def) { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { return def; } }
function writeJson(f, v) { const t = f + '.tmp'; fs.writeFileSync(t, JSON.stringify(v)); fs.renameSync(t, f); }

function localIps() {
  const out = [], ni = os.networkInterfaces();
  Object.keys(ni).forEach((k) => (ni[k] || []).forEach((i) => { if (i.family === 'IPv4' && !i.internal) out.push(i.address); }));
  return out;
}

class SyncManager {
  constructor(env) {
    this.env = env;
    this.cfgFile = path.join(env.userData, 'sync.json');
    this.srvFile = path.join(env.userData, 'sync-server.json');
    this.logFile = path.join(env.userData, 'sync-log.jsonl');
    this.cliFile = path.join(env.userData, 'sync-client.json');
    this.cfg = Object.assign({ mode: 'standalone', port: PORT }, readJson(this.cfgFile, {}));
    if (!this.cfg.devId) { this.cfg.devId = rid(8); this.saveCfg(); }
    if (!this.cfg.devName) { this.cfg.devName = (env.hostname || os.hostname() || 'جهاز'); this.saveCfg(); }
    this.S = null; this.seq = 0; this.rendererFrom = 0;
    this.lastError = ''; this.clients = new Set(); this.timers = [];
    this.connected = false; this.stopped = true;
  }
  get mode() { return this.cfg.mode || 'standalone'; }
  get active() { return this.mode !== 'standalone'; }
  saveCfg() { try { writeJson(this.cfgFile, this.cfg); } catch (e) { /* ignore */ } }

  /* ---------- حالة البيانات (نسخة السيرفر أو النسخة المحلية للعميل) ---------- */
  fileOf(k) { return path.join(this.env.dbDir(), k + '.json'); }
  loadS() {
    const S = Core.emptyState();
    Core.ALL.forEach((k) => { const v = readJson(this.fileOf(k), undefined); if (v !== undefined && v !== null) S[k] = v; });
    /* إعدادات أودو (فيها مفتاح الـ API) تبقى محلية ولا تدخل المزامنة */
    if (S.set && S.set.odoo !== undefined) {
      const ls = readJson(this.fileOf('localset'), {}) || {};
      ls.odoo = S.set.odoo; writeJson(this.fileOf('localset'), ls);
      delete S.set.odoo; writeJson(this.fileOf('set'), S.set);
    }
    this.S = S;
  }
  persist(keys) {
    keys.forEach((k) => { if (Core.ALL.indexOf(k) >= 0) { try { writeJson(this.fileOf(k), this.S[k]); } catch (e) { this.lastError = 'تعذر حفظ ' + k; } } });
  }
  persistAll() { this.persist(Core.ALL); }

  /* ما يقرؤه الواجهة عند التشغيل (وفي نفس اللحظة نبدأ نرسل لها التغييرات الجديدة فقط) */
  dbLoad() {
    const out = {};
    Core.ALL.forEach((k) => { out[k] = this.S[k]; });
    Core.LOCAL_FILES.forEach((k) => { const v = readJson(this.fileOf(k), undefined); if (v !== undefined && v !== null) out[k] = v; });
    out.__seq = this.seq;
    this.rendererFrom = this.seq;
    return out;
  }

  /* ---------- تشغيل / إيقاف ---------- */
  init() {
    if (!this.active) return;
    this.loadS();
    if (this.mode === 'server') this.startServer(); else this.startClient();
  }
  stop() {
    this.stopped = true; this.connected = false;
    this.timers.forEach((t) => clearInterval(t)); this.timers = [];
    this.clients.forEach((c) => { try { c.res.end(); } catch (e) { /* ignore */ } }); this.clients.clear();
    if (this.srv) { try { this.srv.close(); } catch (e) { /* ignore */ } this.srv = null; }
    if (this.udp) { try { this.udp.close(); } catch (e) { /* ignore */ } this.udp = null; }
    if (this.streamReq) { try { this.streamReq.destroy(); } catch (e) { /* ignore */ } this.streamReq = null; }
  }

  info() {
    const o = {
      mode: this.mode, devName: this.cfg.devName, devId: this.cfg.devId, port: this.cfg.port || PORT,
      seq: this.seq, error: this.lastError, ips: localIps()
    };
    if (this.mode === 'server') {
      o.connected = !!this.srv; o.serverName = this.cfg.serverName || this.cfg.devName;
      const on = new Set(); this.clients.forEach((c) => on.add(c.dev));
      const dv = (this.meta && this.meta.devices) || {};
      o.devices = Object.keys(dv).map((id) => Object.assign({ id, online: on.has(id) }, dv[id])).sort((a, b) => b.last - a.last);
    }
    if (this.mode === 'client') {
      o.connected = this.connected; o.host = this.cfg.host; o.serverName = (this.cs && this.cs.serverName) || '';
      o.pending = this.cs ? this.cs.outbox.length : 0;
    }
    return o;
  }
  emitStatus() { try { this.env.toRenderer('sync-status', this.info()); } catch (e) { /* ignore */ } }

  /* ===================== السيرفر ===================== */
  startServer() {
    this.stopped = false;
    const m = readJson(this.srvFile, null) || { epoch: rid(6), seq: 0, counters: {}, recent: {}, devices: {} };
    if (!m.recent) m.recent = {};
    this.meta = m;
    this.loadLog();
    const fl = Core.counterFloor(this.S);
    Core.CNT_KEYS.forEach((k) => { m.counters[k] = Math.max(+m.counters[k] || 0, fl[k] || 0); });
    this.seq = Math.max(m.seq || 0, this.log.length ? this.log[this.log.length - 1].seq : 0);
    m.seq = this.seq; this.saveMeta();
    this.srv = http.createServer((q, r) => { this.onReq(q, r).catch((e) => { try { r.writeHead(500); r.end(JSON.stringify({ err: String(e && e.message || e) })); } catch (x) { /* ignore */ } }); });
    this.srv.on('error', (e) => { this.lastError = e.code === 'EADDRINUSE' ? 'المنفذ ' + (this.cfg.port || PORT) + ' مستخدم من برنامج آخر' : String(e.message); this.emitStatus(); });
    this.srv.requestTimeout = 0;
    this.srv.listen(this.cfg.port || PORT, '0.0.0.0', () => { this.lastError = ''; this.emitStatus(); });
    this.startDiscovery();
    this.timers.push(setInterval(() => { this.clients.forEach((c) => { try { c.res.write(':hb\n\n'); } catch (e) { /* ignore */ } }); }, HB_MS));
  }
  saveMeta() { try { writeJson(this.srvFile, this.meta); } catch (e) { /* ignore */ } }
  loadLog() {
    this.log = []; this.logBytes = 0;
    let txt = ''; try { txt = fs.readFileSync(this.logFile, 'utf8'); } catch (e) { return; }
    txt.split('\n').forEach((l) => {
      if (!l) return;
      try { const e = JSON.parse(l); e.size = l.length; this.log.push(e); this.logBytes += l.length; } catch (x) { /* سطر تالف */ }
    });
    this.trimLog();
    if (this.logBytes > 0 && txt.length > LOG_MAX_BYTES * 2) { try { fs.writeFileSync(this.logFile, this.log.map((e) => JSON.stringify({ seq: e.seq, dev: e.dev, ts: e.ts, ops: e.ops })).join('\n') + '\n'); } catch (e) { /* ignore */ } }
  }
  trimLog() { while (this.logBytes > LOG_MAX_BYTES && this.log.length > 1) this.logBytes -= this.log.shift().size; }

  noteDevice(dev, name, ip) {
    const d = this.meta.devices;
    if (!d[dev]) d[dev] = { idx: Object.keys(d).length + 1, name: name || dev, first: Date.now() };
    d[dev].last = Date.now(); d[dev].ip = ip || d[dev].ip; if (name) d[dev].name = name;
    this.devDirty = true;
  }

  /* تطبيق دفعة عمليات من أي جهاز (بما فيه جهاز السيرفر نفسه) */
  commit(dev, bid, rawOps) {
    const ops = Core.validateOps(rawOps);
    /* منع التكرار: نتذكر آخر 300 دفعة لكل جهاز (لو أُعيد إرسال نفس الدفعة نردّ بنفس الرقم دون تطبيقها) */
    const rec = this.meta.recent[dev] || (this.meta.recent[dev] = []);
    if (bid !== undefined) { const f = rec.find((x) => x[0] === bid); if (f) return { seq: f[1], dup: true }; }
    if (!ops.length) return { seq: this.seq };
    const touched = Core.applyOps(this.S, ops);
    this.persist(Array.from(touched));
    this.seq += 1;
    const e = { seq: this.seq, dev, ts: Date.now(), ops };
    const line = JSON.stringify(e);
    e.size = line.length; this.log.push(e); this.logBytes += e.size; this.trimLog();
    try { fs.appendFileSync(this.logFile, line + '\n'); } catch (x) { this.lastError = 'تعذر كتابة سجل المزامنة'; }
    if (bid !== undefined) { rec.push([bid, this.seq]); if (rec.length > 300) rec.shift(); }
    this.meta.seq = this.seq; this.saveMeta(); this.devDirty = false;
    this.broadcast(e);
    if (dev !== this.cfg.devId && this.seq > this.rendererFrom) { try { this.env.toRenderer('sync-remote', { seq: e.seq, ops }); } catch (x) { /* ignore */ } }
    return { seq: this.seq };
  }
  broadcast(e) {
    const full = 'data: ' + JSON.stringify({ t: 'b', seq: e.seq, dev: e.dev, ops: e.ops }) + '\n\n';
    const own = 'data: ' + JSON.stringify({ t: 'b', seq: e.seq, own: true }) + '\n\n';
    this.clients.forEach((c) => { try { c.res.write(c.dev === e.dev ? own : full); } catch (x) { /* ignore */ } });
  }
  lease(key, n) {
    if (Core.CNT_KEYS.indexOf(key) < 0) throw new Error('عدّاد غير معروف');
    n = Math.max(1, Math.min(1000, parseInt(n, 10) || 20));
    const lo = (this.meta.counters[key] || 0) + 1, hi = lo + n - 1;
    this.meta.counters[key] = hi; this.saveMeta();
    return { lo, hi };
  }
  snapshot() {
    const data = {};
    Core.ALL.forEach((k) => { data[k] = this.S[k]; });
    return { seq: this.seq, epoch: this.meta.epoch, name: this.cfg.serverName || this.cfg.devName, data };
  }
  /* بعد استرجاع نسخة احتياطية أو حذف البيانات على السيرفر: العملاء يعيدون تحميل كل شيء */
  reloadFromDisk() {
    if (this.mode !== 'server') return;
    this.loadS();
    this.meta.epoch = rid(6); this.log = []; this.logBytes = 0; try { fs.writeFileSync(this.logFile, ''); } catch (e) { /* ignore */ }
    const fl = Core.counterFloor(this.S);
    Core.CNT_KEYS.forEach((k) => { this.meta.counters[k] = Math.max(this.meta.counters[k] || 0, fl[k] || 0); });
    this.meta.recent = {}; this.meta.seq = this.seq; this.saveMeta();
    this.clients.forEach((c) => { try { c.res.write('data: ' + JSON.stringify({ t: 'reset' }) + '\n\n'); } catch (e) { /* ignore */ } });
  }

  readBody(q, limit) {
    return new Promise((res, rej) => {
      const ch = []; let n = 0;
      q.on('data', (c) => { n += c.length; if (n > limit) { rej(new Error('too big')); q.destroy(); } else ch.push(c); });
      q.on('end', () => res(Buffer.concat(ch)));
      q.on('error', rej);
    });
  }
  async onReq(q, r) {
    const send = (code, obj, gz) => {
      const body = Buffer.from(JSON.stringify(obj));
      const hd = { 'Content-Type': 'application/json' };
      if (gz) { const z = zlib.gzipSync(body); hd['Content-Encoding'] = 'gzip'; r.writeHead(code, hd); r.end(z); } else { r.writeHead(code, hd); r.end(body); }
    };
    const u = new URL(q.url, 'http://x');
    if (u.pathname.indexOf('/sync/') !== 0) return send(404, { err: 'not found' });
    const body = await this.readBody(q, 300 * 1024 * 1024);
    const dev = String(q.headers['x-rmt-dev'] || ''), ts = String(q.headers['x-rmt-ts'] || ''), sg = String(q.headers['x-rmt-sig'] || '');
    if (!dev || !ts || Math.abs(Date.now() - (+ts || 0)) > TS_WINDOW) return send(401, { err: 'clock' });
    const want = sign(this.cfg.key || '', ts, q.method, q.url, sha(body));
    let ok = false; try { ok = want.length === sg.length && crypto.timingSafeEqual(Buffer.from(want), Buffer.from(sg)); } catch (e) { ok = false; }
    if (!ok) return send(401, { err: 'key' });
    let nm = ''; try { nm = decodeURIComponent(String(q.headers['x-rmt-name'] || '')); } catch (e) { nm = ''; }
    this.noteDevice(dev, nm, (q.socket.remoteAddress || '').replace('::ffff:', ''));
    const p = u.pathname;
    /* صور المنتجات: قائمة الأسماء + تنزيل + رفع (ملفات خام، الاسم = بصمة المحتوى) */
    if (p === '/sync/imglist') return send(200, { names: this.env.img ? this.env.img.list() : [] });
    if (p === '/sync/img') {
      const nm = u.searchParams.get('n') || '', st = this.env.img;
      if (!st || !st.valid(nm)) return send(400, { err: 'name' });
      if (q.method === 'GET') {
        if (!st.has(nm)) return send(404, { err: 'missing' });
        const b = st.read(nm); r.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': b.length }); r.end(b); return;
      }
      try { if (st.writeRaw(nm, body)) { try { this.env.toRenderer('sync-imgs', { n: 1 }); } catch (e) { /* ignore */ } } } catch (e) { return send(400, { err: 'image' }); }
      return send(200, { ok: true });
    }
    let j = {}; if (q.method === 'POST' && body.length) { try { j = JSON.parse(body.toString('utf8')); } catch (e) { return send(400, { err: 'json' }); } }
    if (p === '/sync/hello') return send(200, { ok: true, seq: this.seq, epoch: this.meta.epoch, name: this.cfg.serverName || this.cfg.devName });
    if (p === '/sync/snapshot') return send(200, this.snapshot(), true);
    if (p === '/sync/push' && q.method === 'POST') {
      if (!Array.isArray(j.ops)) return send(400, { err: 'ops' });
      const r2 = this.commit(dev, j.bid, j.ops);
      this.emitStatus();
      return send(200, r2);
    }
    if (p === '/sync/lease' && q.method === 'POST') { try { return send(200, this.lease(String(j.key), j.n)); } catch (e) { return send(400, { err: e.message }); } }
    if (p === '/sync/events') return this.openEvents(q, r, u, dev);
    return send(404, { err: 'not found' });
  }
  openEvents(q, r, u, dev) {
    const since = parseInt(u.searchParams.get('since'), 10) || 0, ep = u.searchParams.get('epoch') || '';
    r.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    try { q.socket.setNoDelay(true); q.socket.setTimeout(0); } catch (e) { /* ignore */ }
    const w = (o) => r.write('data: ' + JSON.stringify(o) + '\n\n');
    w({ t: 'hello', seq: this.seq, epoch: this.meta.epoch });
    const first = this.log.length ? this.log[0].seq : this.seq + 1;
    if (!ep || ep !== this.meta.epoch || since > this.seq || (since < this.seq && since + 1 < first)) { w({ t: 'reset' }); r.end(); return; }
    this.log.forEach((e) => { if (e.seq > since) w(e.dev === dev ? { t: 'b', seq: e.seq, own: true } : { t: 'b', seq: e.seq, dev: e.dev, ops: e.ops }); });
    const cl = { res: r, dev };
    this.clients.add(cl); this.emitStatus();
    r.on('close', () => { this.clients.delete(cl); this.emitStatus(); });
  }

  /* ---------- اكتشاف السيرفرات على الشبكة (UDP) ---------- */
  startDiscovery() {
    try {
      const s = dgram.createSocket({ type: 'udp4', reuseAddr: true });
      s.on('error', () => { /* الاكتشاف اختياري */ });
      s.on('message', (msg, ri) => {
        if (String(msg).indexOf('RMT-DISCOVER') !== 0) return;
        const rep = Buffer.from(JSON.stringify({ n: this.cfg.serverName || this.cfg.devName, p: this.cfg.port || PORT, e: this.meta.epoch }));
        try { s.send(rep, ri.port, ri.address); } catch (e) { /* ignore */ }
      });
      s.bind(this.cfg.discPort || DPORT);
      this.udp = s;
    } catch (e) { /* ignore */ }
  }
  static discover(opts) {
    opts = opts || {};
    return new Promise((resolve) => {
      const found = {};
      let s; try { s = dgram.createSocket('udp4'); } catch (e) { return resolve([]); }
      const done = () => { try { s.close(); } catch (e) { /* ignore */ } resolve(Object.keys(found).map((k) => found[k])); };
      s.on('error', done);
      s.on('message', (msg, ri) => { try { const o = JSON.parse(String(msg)); found[ri.address + ':' + o.p] = { host: ri.address, port: o.p, name: o.n, epoch: o.e }; } catch (e) { /* ignore */ } });
      s.bind(0, () => {
        try { s.setBroadcast(true); } catch (e) { /* ignore */ }
        const targets = opts.targets || ['255.255.255.255'];
        if (!opts.targets) {
          const ni = os.networkInterfaces();
          Object.keys(ni).forEach((k) => (ni[k] || []).forEach((i) => {
            if (i.family !== 'IPv4' || i.internal || !i.netmask) return;
            const a = i.address.split('.').map(Number), m = i.netmask.split('.').map(Number);
            targets.push(a.map((x, n) => (x & m[n]) | (~m[n] & 255)).join('.'));
          }));
        }
        const port = opts.port || DPORT;
        targets.forEach((t) => { try { s.send(Buffer.from('RMT-DISCOVER'), port, t); } catch (e) { /* ignore */ } });
        setTimeout(done, opts.wait || 1500);
      });
    });
  }

  /* ===================== العميل ===================== */
  loadCS() { this.cs = Object.assign({ seq: 0, epoch: '', outbox: [], lastBid: 0, serverName: '' }, readJson(this.cliFile, {})); this.seq = this.cs.seq; }
  saveCS() { try { writeJson(this.cliFile, this.cs); } catch (e) { this.lastError = 'تعذر حفظ طابور الإرسال'; } }

  request(method, pathq, bodyObj, opt) {
    opt = opt || {};
    return new Promise((resolve, reject) => {
      const data = bodyObj === undefined ? Buffer.alloc(0) : Buffer.isBuffer(bodyObj) ? bodyObj : Buffer.from(JSON.stringify(bodyObj));
      const ts = String(Date.now());
      const h = {
        'x-rmt-dev': this.cfg.devId, 'x-rmt-ts': ts, 'x-rmt-name': encodeURIComponent(this.cfg.devName || ''),
        'x-rmt-sig': sign(opt.key || this.cfg.key || '', ts, method, pathq, sha(data)), 'content-type': Buffer.isBuffer(bodyObj) ? 'application/octet-stream' : 'application/json', 'content-length': data.length
      };
      const q = http.request({ host: opt.host || this.cfg.host, port: opt.port || this.cfg.port || PORT, path: pathq, method, headers: h, timeout: opt.timeout || 30000 }, (res) => {
        const ch = []; res.on('data', (c) => ch.push(c));
        res.on('end', () => {
          try {
            let b = Buffer.concat(ch);
            if (res.headers['content-encoding'] === 'gzip') b = zlib.gunzipSync(b);
            if (opt.raw && res.statusCode === 200) return resolve(b);
            const j = b.length ? JSON.parse(b.toString('utf8')) : {};
            if (res.statusCode !== 200) { const er = new Error(j.err || ('HTTP ' + res.statusCode)); er.code = res.statusCode; er.detail = j.err; return reject(er); }
            resolve(j);
          } catch (e) { reject(e); }
        });
      });
      q.on('timeout', () => q.destroy(new Error('timeout')));
      q.on('error', reject);
      q.end(data);
    });
  }
  static explain(e) {
    if (e && e.detail === 'key') return 'الرمز السري غير صحيح';
    if (e && e.detail === 'clock') return 'ساعة أحد الجهازين غير مضبوطة (الفرق أكبر من 10 دقائق)';
    return 'تعذر الاتصال بالسيرفر — تأكد من العنوان وأن البرنامج شغال على جهاز السيرفر وأن الجدار الناري يسمح بالاتصال';
  }

  startClient() {
    this.stopped = false; this.loadCS();
    this.timers.push(setInterval(() => this.imgSync(), 60000));
    this.loop();
  }
  /* مزامنة ملفات الصور في الاتجاهين: ننزّل ما ينقصنا ونرفع ما ينقص السيرفر */
  imgSyncSoon(ms) { if (this.imgT || this.mode !== 'client') return; this.imgT = setTimeout(() => { this.imgT = null; this.imgSync(); }, ms || 1500); }
  async imgSync() {
    const st = this.env.img;
    if (!st || this.mode !== 'client' || !this.connected || this.imgBusy) return;
    this.imgBusy = true;
    try {
      const r = await this.request('GET', '/sync/imglist');
      const remote = new Set(r.names || []), local = new Set(st.list());
      const down = Array.from(remote).filter((n) => !local.has(n)), up = Array.from(local).filter((n) => !remote.has(n));
      const pool = async (arr, fn) => { let i = 0; await Promise.all([0, 1, 2, 3].map(async () => { while (i < arr.length) { const n = arr[i++]; try { await fn(n); } catch (e) { /* يُعاد في الدورة القادمة */ } } })); };
      await pool(down, async (n) => { st.writeRaw(n, await this.request('GET', '/sync/img?n=' + encodeURIComponent(n), undefined, { raw: true, timeout: 60000 })); });
      await pool(up, async (n) => { await this.request('POST', '/sync/img?n=' + encodeURIComponent(n), st.read(n), { timeout: 60000 }); });
      if (down.length) { try { this.env.toRenderer('sync-imgs', { n: down.length }); } catch (e) { /* ignore */ } }
    } catch (e) { /* غير متصل: نحاول لاحقًا */ } finally { this.imgBusy = false; }
  }
  async loop() {
    let delay = 1000;
    while (!this.stopped) {
      const ok = await this.openStream();
      if (this.stopped) break;
      if (this.connected) { this.connected = false; this.emitStatus(); }
      if (ok) delay = 1000; else delay = Math.min(delay * 1.5, 10000);
      await sleep(delay);
    }
  }
  openStream() {
    return new Promise((resolve) => {
      const pathq = '/sync/events?since=' + this.cs.seq + '&epoch=' + encodeURIComponent(this.cs.epoch || '');
      const ts = String(Date.now());
      const h = { 'x-rmt-dev': this.cfg.devId, 'x-rmt-ts': ts, 'x-rmt-name': encodeURIComponent(this.cfg.devName || ''), 'x-rmt-sig': sign(this.cfg.key || '', ts, 'GET', pathq, sha(Buffer.alloc(0))) };
      let last = Date.now(), got = false, finished = false;
      const fin = (v) => { if (finished) return; finished = true; clearInterval(wd); this.streamReq = null; resolve(v); };
      const q = http.request({ host: this.cfg.host, port: this.cfg.port || PORT, path: pathq, method: 'GET', headers: h }, (res) => {
        if (res.statusCode !== 200) { this.lastError = res.statusCode === 401 ? 'الرمز السري أو ساعة الجهاز غير صحيحة' : 'خطأ من السيرفر ' + res.statusCode; this.emitStatus(); res.resume(); return fin(false); }
        let buf = ''; res.setEncoding('utf8');
        res.on('data', (c) => {
          last = Date.now(); buf += c;
          let i;
          while ((i = buf.indexOf('\n\n')) >= 0) {
            const ev = buf.slice(0, i); buf = buf.slice(i + 2);
            const ln = ev.split('\n').find((l) => l.indexOf('data: ') === 0);
            if (!ln) continue;
            try { got = true; this.onEvent(JSON.parse(ln.slice(6))); } catch (e) { this.lastError = String(e.message); }
          }
        });
        res.on('end', () => fin(got)); res.on('error', () => fin(got));
      });
      q.on('error', () => { if (!this.connected) { this.lastError = 'تعذر الاتصال بالسيرفر'; } fin(false); });
      q.end();
      this.streamReq = q;
      const wd = setInterval(() => { if (Date.now() - last > STALL_MS) { try { q.destroy(); } catch (e) { /* ignore */ } } }, 5000);
    });
  }
  dropStream() { if (this.streamReq) { try { this.streamReq.destroy(); } catch (e) { /* ignore */ } } }

  onEvent(m) {
    if (m.t === 'hello') {
      if (this.cs.epoch && m.epoch !== this.cs.epoch) { this.resync(); return; }
      if (!this.cs.epoch) { this.cs.epoch = m.epoch; this.saveCS(); }
      this.connected = true; this.lastError = ''; this.emitStatus(); this.pump(); this.imgSyncSoon(500);
    } else if (m.t === 'reset') {
      this.resync();
    } else if (m.t === 'b') {
      if (m.seq <= this.cs.seq) return;
      if (m.seq !== this.cs.seq + 1) { this.dropStream(); return; }   /* فجوة: نعيد الاتصال ليُعاد الإرسال */
      if (m.own) { this.cs.seq = m.seq; this.seq = m.seq; this.saveCS(); return; }
      const ops = Core.validateOps(m.ops);
      const touched = Core.applyOps(this.S, ops);
      this.persist(Array.from(touched));
      this.cs.seq = m.seq; this.seq = m.seq; this.saveCS();
      if (m.seq > this.rendererFrom) { try { this.env.toRenderer('sync-remote', { seq: m.seq, ops }); } catch (e) { /* ignore */ } }
      if (touched.has('products')) this.imgSyncSoon(2000);
      this.emitStatus();
    }
  }

  /* تحميل نسخة كاملة من السيرفر، مع إعادة تطبيق ما لم يُرسل بعد من هذا الجهاز */
  async resync() {
    if (this.resyncing) return;
    this.resyncing = true;
    try {
      try { this.env.backup('قبل-إعادة-المزامنة'); } catch (e) { /* ignore */ }
      const snap = await this.request('GET', '/sync/snapshot', undefined, { timeout: 600000 });
      const S = Core.emptyState();
      Core.ALL.forEach((k) => { if (snap.data && snap.data[k] !== undefined) S[k] = snap.data[k]; });
      this.cs.outbox.forEach((b) => Core.applyOps(S, cp(Core.validateOps(b.ops))));
      this.S = S; this.persistAll();
      this.cs.seq = snap.seq; this.seq = snap.seq; this.cs.epoch = snap.epoch; this.cs.serverName = snap.name || this.cs.serverName; this.saveCS();
      this.env.toRenderer('sync-reload', {});
      this.dropStream();
    } catch (e) { this.lastError = SyncManager.explain(e); this.emitStatus(); } finally { this.resyncing = false; }
  }

  async pump() {
    if (this.pumping || !this.connected || this.stopped) return;
    this.pumping = true;
    try {
      while (this.cs.outbox.length && this.connected) {
        const b = this.cs.outbox[0];
        try { await this.request('POST', '/sync/push', { bid: b.bid, ops: b.ops }, { timeout: 120000 }); } catch (e) {
          if (e.code === 400) { (this.cs.failed = this.cs.failed || []).push(this.cs.outbox.shift()); this.saveCS(); this.lastError = 'دفعة مرفوضة من السيرفر'; continue; }
          throw e;
        }
        this.cs.outbox.shift(); this.saveCS(); this.emitStatus();
      }
    } catch (e) {
      this.lastError = SyncManager.explain(e);
      setTimeout(() => this.pump(), 3000);
    } finally { this.pumping = false; }
  }

  /* ===================== واجهة الاستخدام من الواجهة الرسومية ===================== */
  push(rawOps) {
    const ops = Core.validateOps(rawOps);
    if (!ops.length) return { ok: true };
    if (this.mode === 'server') { this.commit(this.cfg.devId, undefined, ops); this.emitStatus(); return { ok: true }; }
    if (this.mode !== 'client') return { ok: false };
    const touched = Core.applyOps(this.S, cp(ops));
    this.persist(Array.from(touched));
    const bid = Math.max((this.cs.lastBid || 0) + 1, Date.now());
    this.cs.lastBid = bid; this.cs.outbox.push({ bid, ops }); this.saveCS();
    this.emitStatus(); this.pump();
    return { ok: true };
  }
  /* بعد حفظ صورة محليًا: العميل يرفعها للسيرفر في الخلفية */
  imgAdded() { this.imgSyncSoon(800); }
  async leaseFor(key, n) {
    if (this.mode === 'server') return this.lease(key, n);
    if (this.mode === 'client') return this.request('POST', '/sync/lease', { key, n });
    throw new Error('المزامنة غير مفعّلة');
  }
  async setup(o) {
    o = o || {};
    if (o.mode === 'standalone') {
      this.stop(); this.cfg.mode = 'standalone'; this.saveCfg(); this.emitStatus();
      return { ok: true };
    }
    const key = String(o.key || '').trim();
    if (key.length < 4) return { ok: false, err: 'الرمز السري 4 خانات على الأقل' };
    if (o.mode === 'server') {
      this.stop();
      Object.assign(this.cfg, { mode: 'server', key, port: parseInt(o.port, 10) || PORT, serverName: String(o.name || this.cfg.devName).trim() || this.cfg.devName });
      this.saveCfg();
      this.loadS(); this.startServer();
      return { ok: true, ips: localIps(), port: this.cfg.port };
    }
    if (o.mode === 'client') {
      const host = String(o.host || '').trim(), port = parseInt(o.port, 10) || PORT;
      if (!host) return { ok: false, err: 'اكتب عنوان السيرفر' };
      try {
        await this.request('GET', '/sync/hello', undefined, { host, port, key, timeout: 8000 });
        const snap = await this.request('GET', '/sync/snapshot', undefined, { host, port, key, timeout: 600000 });
        this.stop();
        try { this.env.backup('قبل-الانضمام-للسيرفر'); } catch (e) { /* ignore */ }
        const S = Core.emptyState();
        Core.ALL.forEach((k) => { if (snap.data && snap.data[k] !== undefined) S[k] = snap.data[k]; });
        this.S = S; this.persistAll();
        Object.assign(this.cfg, { mode: 'client', key, host, port });
        this.saveCfg();
        this.cs = { seq: snap.seq, epoch: snap.epoch, outbox: [], lastBid: 0, serverName: snap.name || '' };
        this.seq = snap.seq; this.saveCS();
        this.startClient();
        return { ok: true, serverName: snap.name };
      } catch (e) { return { ok: false, err: SyncManager.explain(e) }; }
    }
    return { ok: false, err: 'وضع غير معروف' };
  }
  /* إعادة تحميل كل البيانات من السيرفر (لعلاج أي اختلاف) */
  async fullResync() { if (this.mode !== 'client') return { ok: false }; this.lastError = ''; await this.resync(); return { ok: !this.lastError, err: this.lastError }; }
}

module.exports = { SyncManager, PORT, DPORT };

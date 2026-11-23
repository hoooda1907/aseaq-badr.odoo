/* ===== مخزن صور المنتجات =====
   الصورة تُحفظ كملف مستقل داخل مجلد البيانات (db/img) واسمه من محتواها: <بصمة>.jpg|png|webp
   ومعها نسخة مصغّرة <بصمة>.s.jpg للقوائم السريعة. المنتج يحتفظ باسم الملف فقط (الحقل img).
   نفس الصورة تُحفظ مرة واحدة مهما تكرر استيرادها، وتنتقل بين الأجهزة بالمزامنة. */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const NAME_RE = /^[0-9a-f]{16}(\.s)?\.(jpg|png|webp)$/;
const MAX_BYTES = 25 * 1024 * 1024;

function kindOf(b) {
  if (b.length > 12 && b[0] === 0xff && b[1] === 0xd8) return 'jpg';
  if (b.length > 12 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'png';
  if (b.length > 12 && b.slice(0, 4).toString() === 'RIFF' && b.slice(8, 12).toString() === 'WEBP') return 'webp';
  return null;
}
const thumbName = (n) => n.replace(/(\.[a-z]+)$/, '.s$1');

/* dirFn: دالة ترجع مجلد الصور — resize(buf, kind) => {main, thumb} | null (اختيارية: في البرنامج تستخدم nativeImage) */
function createImgStore(dirFn, resize) {
  const dir = () => { const d = dirFn(); fs.mkdirSync(d, { recursive: true }); return d; };
  const write = (name, buf) => {
    const f = path.join(dir(), name);
    if (fs.existsSync(f)) return false;
    const t = f + '.tmp'; fs.writeFileSync(t, buf); fs.renameSync(t, f); return true;
  };
  return {
    NAME_RE, thumbName,
    valid: (n) => typeof n === 'string' && NAME_RE.test(n),
    /* حفظ صورة قادمة كنص base64 (من الاستيراد أو من رفع صورة) */
    put(b64) {
      let s = String(b64 || '').replace(/^data:[^,]*,/, '').replace(/\s+/g, '');
      const buf = Buffer.from(s, 'base64');
      if (!buf.length || buf.length > MAX_BYTES) return { err: 'الصورة فارغة أو أكبر من المسموح' };
      const kind = kindOf(buf);
      if (!kind) return { err: 'صيغة الصورة غير مدعومة (المدعوم: JPG وPNG وWebP)' };
      let main = buf, thumb = buf;
      if (resize && kind !== 'webp') {
        let r = null; try { r = resize(buf, kind); } catch (e) { r = null; }
        if (!r) return { err: 'تعذر قراءة الصورة' };
        main = r.main; thumb = r.thumb || r.main;
      }
      const name = crypto.createHash('sha1').update(main).digest('hex').slice(0, 16) + '.' + kind;
      write(name, main); write(thumbName(name), thumb);
      return { name };
    },
    list() { try { return fs.readdirSync(dir()).filter((f) => NAME_RE.test(f)); } catch (e) { return []; } },
    has(n) { return NAME_RE.test(n) && fs.existsSync(path.join(dir(), n)); },
    read(n) { if (!NAME_RE.test(n)) throw new Error('bad name'); return fs.readFileSync(path.join(dir(), n)); },
    /* استقبال ملف جاهز من جهاز آخر */
    writeRaw(n, buf) {
      if (!NAME_RE.test(n) || !buf.length || buf.length > MAX_BYTES || !kindOf(buf)) throw new Error('bad image');
      return write(n, buf);
    }
  };
}
module.exports = { createImgStore, kindOf, thumbName, NAME_RE };

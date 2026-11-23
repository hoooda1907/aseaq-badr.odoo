/* تجهيز نسخة (edition) من نفس الكود: node scripts/brand.js rmt|aswaq */
const fs = require('fs');
const crypto = require('crypto');
const id = process.argv[2] || 'rmt';
const dir = `brands/${id}`;
if (!fs.existsSync(`${dir}/brand.json`)) { console.error('نسخة غير معروفة: ' + id); process.exit(1); }
const b = JSON.parse(fs.readFileSync(`${dir}/brand.json`, 'utf8'));
fs.copyFileSync(`${dir}/logo.png`, 'www/logo.png');
fs.copyFileSync(`${dir}/icon.png`, 'build/icon.png');
const H = (s) => crypto.createHash('sha256').update('aswaq-badr|' + s).digest('hex');
const pub = { id: b.id, name: b.name, adminName: b.adminName, adminHash: H('admin|' + b.adminPw), licensed: !!b.licensed };
fs.writeFileSync('www/js/brand.js', 'window.BRAND=' + JSON.stringify(pub) + ';\n');
fs.writeFileSync('brand-config.json', JSON.stringify({ id: b.id, name: b.name, folder: b.folder, licFile: b.licFile }, null, 2));
const p = JSON.parse(fs.readFileSync('package.json', 'utf8'));
p.name = b.pkgName;
if (b.userDataFromName) delete p.productName; else p.productName = b.productName;
p.description = b.name;
p.build.appId = b.appId;
p.build.productName = b.productName;
p.build.nsis = Object.assign(p.build.nsis || {}, { shortcutName: b.shortcut, artifactName: b.setup + '.${ext}', deleteAppDataOnUninstall: false });
p.build.portable = { artifactName: b.portable + '.${ext}' };
p.build.files = ['electron-main.js', 'electron-preload.js', 'odoo-client.js', 'sync-main.js', 'img-store.js', 'brand-config.json', 'www/**/*', 'build/icon.png'];
fs.writeFileSync('package.json', JSON.stringify(p, null, 2));
console.log('تم تجهيز النسخة: ' + b.name);

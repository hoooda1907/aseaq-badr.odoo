const fs = require('fs');
const need = ['brand-config.json', 'brands/rmt/brand.json', 'brands/aswaq/brand.json', 'brands/rmt/logo.png', 'brands/aswaq/logo.png', 'brands/rmt/icon.png', 'brands/aswaq/icon.png', 'scripts/brand.js', 'electron-main.js', 'electron-preload.js', 'sync-main.js', 'img-store.js', 'www/js/sync-core.js', 'www/js/sync.js', 'build/icon.png', 'www/index.html', 'www/logo.png',
  'www/js/brand.js', 'www/js/lib.js', 'www/js/data.js', 'www/js/pos.js', 'www/js/cus.js', 'www/seed/customers.js', 'www/js/purch.js', 'www/js/bills.js', 'www/js/inv.js', 'www/js/acc.js', 'www/js/hr.js', 'www/js/lic.js', 'www/js/br.js', 'www/js/prod.js', 'www/js/offers.js', 'www/js/reports.js', 'www/js/payroll.js', 'www/js/mfg.js', 'www/js/odoo.js', 'odoo-client.js', 'www/js/app.js',
  'www/seed/products.js', 'www/seed/suppliers.js', 'www/seed/employees.js'];
const miss = need.filter((f) => !fs.existsSync(f));
if (miss.length) { console.error('ملفات ناقصة في المستودع (ارفعها بنفس المسارات):\n' + miss.join('\n')); process.exit(1); }
if (/\$\('/.test(fs.readFileSync('electron-main.js', 'utf8'))) { console.error('electron-main.js غير صحيح (يحتوي كود الواجهة)'); process.exit(1); }
console.log('الملفات سليمة');

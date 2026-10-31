/* ===== الدخول ===== */
const PR={t:null};
function enter(){
  $('login').hidden=true;$('app').hidden=false;
  $('who').textContent='👤 '+ME.name;go('home');
}
function doLogin(){
  const u=nm($('lu').value),p=norm(dg($('lp').value));let f=null;
  if(u===nm('أسواق بدر')&&p===MASTER_PW)f={name:'أسواق بدر',admin:true,perms:{}};
  else{const e=D.employees.find(x=>x.active!==false&&x.pin&&nm(x.name)===u&&x.pin===p);if(e)f={name:e.name,perms:e.perms||{}}}
  if(f){ME=f;$('le').textContent='';$('lp').value='';enter()}
  else $('le').textContent='اسم المستخدم أو الرقم السري غير صحيح';
}
$('lb').onclick=doLogin;
$('lp').onkeydown=e=>{if(e.key==='Enter')doLogin()};
$('lu').onkeydown=e=>{if(e.key==='Enter')$('lp').focus()};
A.logout=()=>{
  clearInterval(PR.t);ME=null;POS.ses=null;POS.order=newOrder();
  $('app').hidden=true;$('login').hidden=false;$('lu').value='';$('lu').focus();
};

/* ===== الرئيسية ===== */
V.home=()=>{
  const T=[
   ['🛒 نقطة البيع','posBranch',()=>can('pos_sell')||can('pos_close')],
   ['🧾 مراجعة الفواتير','review',()=>can('pos_review')],
   ['📥 المشتريات','purchases',()=>can('pur_view')],
   ['📦 المخزون','inventory',()=>can('inv_view')],
   ['📊 الحسابات والتقارير','accounts',()=>can('acc_reports')],
   ['🚚 الموردين','suppliers',()=>can('acc_suppliers')],
   ['👥 الموظفون والصلاحيات','employees',()=>can('hr_view')],
   ['🏷️ الاستعلام عن السعر','price',()=>true],
   ['📂 استيراد وتحديث البيانات','imports',()=>can('sys_import')],
   ['🗂️ فتح مجلد التقارير','folder',()=>api&&(can('acc_reports')||can('sys_import'))]
  ].filter(t=>t[2]());
  setMain(`<div class="ttl">مرحبًا ${esc(ME.name)}</div><div class="mut" style="margin-bottom:10px">المنتجات المحمّلة: ${D.products.length} — الموردين: ${D.suppliers.length} — الموظفين: ${D.employees.length}${D.products.length?'':' — <b class="err">استورد ملف المنتجات أولًا من «استيراد وتحديث البيانات»</b>'}</div>
  <div class="tiles">${T.map(t=>`<button class="tile2" data-a="${t[1]==='folder'?'openFolder':'go'}" data-v="${t[1]}">${t[0]}</button>`).join('')}</div>`);
};
A.openFolder=()=>{if(api)api.openFolder()};

/* ===== الاستعلام عن السعر ===== */
V.price=()=>{
  setMain(`<div class="card"><input id="prQ" data-i="prQ" data-k="prQ" placeholder="امسح الباركود أو اكتب اسم المنتج" style="font-size:20px;text-align:center" autocomplete="off"><div id="prL"></div></div><div id="prR"></div>`);
  $('prQ').focus();
};
I.prQ=t=>{const q=norm(t.value);$('prL').innerHTML=q.length<2?'':search(q,12).map(p=>`<div class="row" style="padding:10px;border-bottom:1px solid var(--bd);cursor:pointer;font-size:17px" data-a="prPick" data-id="${esc(p.id)}"><span style="flex:1">${esc(p.name)}</span><b>${money(pPrice(p))}</b></div>`).join('')};
K.prQ=(t,e)=>{
  if(e.key!=='Enter')return;const v=norm(t.value);if(!v)return;
  let m=find(v);if(!m.length)m=search(v,2);
  if(m.length===1)prShow(m[0],scaleQty(v,m[0]));else if(!m.length)say('غير موجود',1);
};
A.prPick=t=>prShow(PI.id[t.dataset.id],0);
function prShow(p,w){
  const price=parseFloat(p.price),has=!isNaN(price);let n=5;
  $('main').innerHTML=`<div class="pq"><div class="nm">${esc(p.name)}</div><div class="pc">${has?money(price):'غير متوفر'}</div>${w>0&&has?`<div style="font-size:26px;color:var(--ok)">السعر للكجم — الوزن ${fmt(w)} كجم = ${money(price*w)}</div>`:''}<div class="mut" id="prC">العودة تلقائيًا بعد ${n} ثوانٍ</div><button class="p" style="font-size:20px;padding:12px 30px" data-a="prBack">↩️ عودة للاستعلام</button></div>`;
  clearInterval(PR.t);
  PR.t=setInterval(()=>{n--;if(n<=0){clearInterval(PR.t);V.price()}else if($('prC'))$('prC').textContent=`العودة تلقائيًا بعد ${n} ثوانٍ`},1000);
}
A.prBack=()=>{clearInterval(PR.t);V.price()};

/* ===== استيراد وتحديث البيانات ===== */
V.imports=()=>{
  if(!can('sys_import')){say('ليس لديك صلاحية',1);return go('home')}
  const card=(k,t,d)=>`<div class="card"><div class="ttl">${t}</div><div class="mut">${d}</div><input type="file" accept=".xlsx,.xls,.csv" data-c="impFile" data-k2="${k}" style="margin-top:8px"><div id="imp_${k}" style="margin-top:6px"></div></div>`;
  setMain(`<div class="ttl">استيراد وتحديث البيانات</div><div class="g2">
   ${card('products','المنتجات','أول مرة تُضاف كل المنتجات. وفي كل تحديث لاحق تتم المقارنة بالمنتجات الموجودة (بالمعرف أو الباركود) وتُعدَّل الأسعار والتكلفة والباركود والفئات تلقائيًا. الأعمدة: معرف خارجي، باركود، مرجع داخلي، الاسم، التكلفة، سعر البيع، فئة المنتج، فئة نقطة البيع، نوع المنتج، وحدة القياس.')}
   ${card('suppliers','الموردين','عمود واحد بأسماء الموردين، ولا تتكرر الأسماء الموجودة.')}
   ${card('employees','الموظفين','أعمدة: اسم الموظف، هاتف العمل، البريد، القسم، المنصب الوظيفي، المدير. لا يتأثر الرقم السري ولا الصلاحيات للموظفين الموجودين.')}</div>`);
};
C.impFile=async t=>{
  const f=t.files[0];if(!f)return;const k=t.dataset.k2,out=$('imp_'+k);
  out.innerHTML='<span class="mut">جاري القراءة…</span>';
  try{
    const rows=await readRows(f);await new Promise(r=>setTimeout(r,30));
    const r=({products:importProducts,suppliers:importSuppliers,employees:importEmployees})[k](rows);
    if(!r||r.err){out.innerHTML=`<span class="err">${esc(r?r.err:'الملف فارغ')}</span>`;return}
    out.innerHTML=k==='products'?`<b style="color:var(--ok)">تم: ${r.add} منتج جديد — ${r.upd} منتج اتعدّل — ${r.same} بدون تغيير</b>`
      :`<b style="color:var(--ok)">تم: ${r.add} جديد — ${r.upd!==undefined?r.upd+' اتعدّل':r.skip+' موجود مسبقًا'}</b>`;
    await flush();
  }catch(e){out.innerHTML='<span class="err">تعذر قراءة الملف</span>'}
  t.value='';
};

/* ===== تشغيل ===== */
(async()=>{
  await dbLoad();reindex();
  $('lu').focus();
})();

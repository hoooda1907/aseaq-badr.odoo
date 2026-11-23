/* ===== المستخدم والصلاحيات ===== */
let ME=null;
const can=p=>!!ME&&!!(ME.owner||ME.admin||(ME.perms&&(ME.perms.sys_admin||ME.perms[p])));

/* ===== فهرس المنتجات ===== */
let PI={id:{},bc:{},bz:{},pre:{},ref:{},ubc:{},s:{},cats:[],pcats:[]};
function reindex(){
  PI={id:{},bc:{},bz:{},pre:{},ref:{},ubc:{},s:{},cats:[],pcats:[]};
  const cs={},ps={};
  D.products.forEach(p=>{
    PI.id[p.id]=p;PI.s[p.id]=(p.name+' '+p.bc+' '+p.ref).toLowerCase();
    if(p.bc){
      (PI.bc[p.bc]=PI.bc[p.bc]||[]).push(p);
      const z=p.bc.replace(/^0+/,'');(PI.bz[z]=PI.bz[z]||[]).push(p);
      if(/^2\d{12}$/.test(p.bc)||/^2\d{6}$/.test(p.bc)){const k=p.bc.slice(0,7);(PI.pre[k]=PI.pre[k]||[]).push(p)}
    }
    if(p.ref){const r=p.ref.toLowerCase();(PI.ref[r]=PI.ref[r]||[]).push(p)}
    (p.uoms||[]).forEach(x=>{if(x.bc)(PI.ubc[x.bc]=PI.ubc[x.bc]||[]).push({p,u:x.u})});
    if(p.cat)cs[p.cat]=1;if(p.pcat)ps[p.pcat]=1;
  });
  ((D.set.cats||{}).cat||[]).forEach(c=>{cs[c]=1});((D.set.cats||{}).pcat||[]).forEach(c=>{ps[c]=1});
  PI.cats=Object.keys(cs).sort();PI.pcats=Object.keys(ps).sort();
}
/* باركود الميزان: 13 رقم يبدأ بـ 2، أول 7 أرقام = كود الصنف، 5 أرقام = الوزن بالجرام */
function scale(code){const c=cell(code);return /^2\d{12}$/.test(c)?{pre:c.slice(0,7),g:parseInt(c.slice(7,12),10)}:null}
function find(code){
  code=cell(code);if(!code)return[];
  let m=PI.bc[code]||PI.bz[code.replace(/^0+/,'')]||PI.ref[code.toLowerCase()];
  if(m)return m.slice();
  const s=scale(code);
  if(s&&PI.pre[s.pre]){
    m=PI.pre[s.pre].slice();
    if(m.length>1){const k=m.filter(p=>/كج|kg|كيلو/i.test(p.unit));if(k.length)m=k}
    return m;
  }
  return [];
}
function scaleQty(code,p){const s=scale(code);return(s&&p.bc!==cell(code)&&s.g>0)?s.g/1000:0}
/* بحث بالباركود مع دعم باركود وحدات القياس المتعددة: يُرجع [{p,u}] حيث u اسم الوحدة أو null للوحدة الأساسية */
function findU(code){
  code=cell(code);if(!code)return[];
  const u=PI.ubc[code];if(u)return u.map(x=>({p:x.p,u:x.u}));
  return find(code).map(p=>({p,u:null}));
}
const uomDef=n=>D.uoms.find(x=>x.name===n);
/* معلومات وحدة: f = عدد الوحدات الأساسية في هذه الوحدة، price = سعر الوحدة */
function unitInfo(p,uname){
  if(!uname)return{u:'',f:1,price:null};
  const l=(p.uoms||[]).find(x=>x.u===uname),d=uomDef(uname),f=d?d.ratio:1;
  const pr=l&&l.price!==''&&l.price!=null?+l.price:r2(pPrice(p)*f);
  return{u:uname,f,price:pr};
}
const prodUnits=p=>[''].concat((p.uoms||[]).map(x=>x.u));
const uomText=(d,base)=>d.type==='bigger'?`1 ${d.name} = ${fmt(d.ratio)} ${base||'وحدة أساسية'}`:d.type==='smaller'?`1 ${base||'وحدة أساسية'} = ${fmt(r3(1/d.ratio))} ${d.name}`:`${d.name} = ${base||'الأساسية'}`;
function search(q,limit){
  const w=norm(q).toLowerCase().split(/\s+/).filter(Boolean);if(!w.length)return[];
  const out=[];
  for(let i=0;i<D.products.length&&out.length<limit;i++){
    const p=D.products[i],s=PI.s[p.id];let ok=true;
    for(let j=0;j<w.length;j++){if(s.indexOf(w[j])<0){ok=false;break}}
    if(ok)out.push(p);
  }
  return out;
}
const pPrice=p=>{const v=parseFloat(p.price);return isNaN(v)?0:v};
/* السعر الفعلي: سعر العرض لو العرض ساري، وإلا السعر العادي (ينتهي العرض تلقائيًا ويعود السعر) */
const offerBrOn=br=>{const m=D.set.offerBr||{};return br?m[br]!==false:BR.some(b=>m[b]!==false)};
function effPrice(p,br){const n=pPrice(p),o=p.offer;if(o&&offerBrOn(br)&&Date.now()>=o.start&&Date.now()<=o.end&&o.price<n)return{price:o.price,orig:n,offer:true};return{price:n,orig:n,offer:false}}
const savings=r=>r.type==='return'?0:r2(r.lines.reduce((s,l)=>s+Math.max(0,(l.orig||l.pre||l.price)-(l.pre||l.price))*l.qty,0));
/* منع البيع بأقل من التكلفة، إلا لمن لديه الصلاحية أو إذا فُعّل «السماح بالبيع بخسارة» في المنتج */
const lossBlocked=(p,price)=>{const c=pCost(p);return c>0&&price<c&&!(p.allowLoss||can('pos_sell_loss'))};
const pCost=p=>{const v=parseFloat(p.cost);return isNaN(v)?0:v};

/* ===== المخزون ===== */
const stk=(b,id)=>((D.stock[b]||{})[id])||0;
function addStk(b,id,d){D.stock[b]=D.stock[b]||{};D.stock[b][id]=r3((D.stock[b][id]||0)+d)}

/* ===== طرق حساب التكلفة: FIFO (افتراضي) / LIFO / متوسط التكلفة — على مستوى المنتج أو الفئة أو عام ===== */
const COSTN={fifo:'FIFO — الوارد أولًا يُصرف أولًا',lifo:'LIFO — الوارد أخيرًا يُصرف أولًا',avg:'متوسط التكلفة'};
const costMethod=p=>{const c=D.set.costing||{};return(p&&p.costM)||(p&&c.cat&&c.cat[p.cat])||c.def||'fifo'};
function layersOf(b,id){D.layers[b]=D.layers[b]||{};return D.layers[b][id]=D.layers[b][id]||[]}
const lsum=L=>r3(L.reduce((a,x)=>a+x.q,0));
function collapse(L){if(L.length<2)return;const q=lsum(L),v=L.reduce((a,x)=>a+x.q*x.c,0);L.length=0;if(q>0)L.push({q,c:r3(v/q),ts:Date.now(),src:'avg'})}
function takeFrom(L,qty,m){
  let rem=qty,cost=0;
  if(m==='avg'){collapse(L);if(L[0]){const x=L[0],t=Math.min(rem,x.q);cost+=t*x.c;x.q=r3(x.q-t);rem=r3(rem-t);if(x.q<=1e-9)L.length=0}return{cost,rem}}
  while(rem>1e-9&&L.length){const i=m==='lifo'?L.length-1:0,x=L[i],t=Math.min(rem,x.q);cost+=t*x.c;x.q=r3(x.q-t);rem=r3(rem-t);if(x.q<=1e-9)L.splice(i,1)}
  return{cost,rem};
}
/* مطابقة الطبقات مع رصيد المخزون (يغطي التسويات المباشرة والرصيد الافتتاحي) */
function reconcile(b,id){
  const st=stk(b,id),L=layersOf(b,id),p=PI.id[id],c=p?pCost(p):0;
  if(st<=0){if(L.length)L.length=0;return}
  const sum=lsum(L);
  if(sum<st)L.push({q:r3(st-sum),c,ts:L.length?Date.now():0,src:'adj'});
  else if(sum>st)takeFrom(L,r3(sum-st),costMethod(p));
}
/* إدخال للمخزون بتكلفة وحدة (للوحدة الأساسية) */
function costIn(b,id,qty,unit,src,meta){
  if(!(qty>0))return;
  reconcile(b,id);const before=stk(b,id);addStk(b,id,qty);
  const neg=before<0?-before:0,lq=r3(qty-Math.min(neg,qty));if(lq<=0)return;
  const L=layersOf(b,id),m=costMethod(PI.id[id]);
  if(m==='avg'){collapse(L);if(L.length){const x=L[0];x.c=r3((x.q*x.c+lq*unit)/(x.q+lq));x.q=r3(x.q+lq);return}}
  L.push(Object.assign({q:lq,c:r3(unit),ts:Date.now(),src:src||''},meta||{}));
}
/* إخراج من المخزون: يُرجع إجمالي التكلفة المصروفة حسب الطريقة */
function costOut(b,id,qty){
  if(!(qty>0))return 0;
  reconcile(b,id);const p=PI.id[id],before=stk(b,id);addStk(b,id,-qty);
  const posQ=Math.max(0,Math.min(qty,before)),t=takeFrom(layersOf(b,id),posQ,costMethod(p));
  return t.cost+r3(qty-posQ)*(p?pCost(p):0);
}
/* تعديل تكلفة طبقات استلام معيّن (فرق سعر الفاتورة عن سعر الاستلام) */
function adjustLayers(b,id,recId,idx,oldU,newU){
  const L=layersOf(b,id),p=PI.id[id],m=costMethod(p),d=newU-oldU;let n=0;
  if(m==='avg'){collapse(L);if(L[0]&&L[0].q>0){L[0].c=r3(L[0].c+d);n++}return n}
  L.forEach(x=>{if(x.rec===recId&&x.i===idx){x.c=r3(x.c+d);n++}});return n;
}
function stockValue(b,id){
  reconcile(b,id);const p=PI.id[id],st=stk(b,id);
  if(st<=0)return r2(st*(p?pCost(p):0));
  return r2(layersOf(b,id).reduce((a,x)=>a+x.q*x.c,0));
}

/* ===== استيراد المنتجات (إضافة + مقارنة وتحديث) ===== */
const PSPEC=[['ubc',/uom price\/barcode/],['utype',/uom price\/type/],['uratio',/نسبة أكبر|factor_inv|bigger ratio/],['uname',/uom price\/unit of measure/],['uprice',/uom price\/price/],['uid',/uom price\/id/],['qty',/الكمية في اليد|on hand|qty_available/],['pcat',/نقطة|pos/],['cat',/فئة|categ/],['type',/نوع|type/],['ref',/مرجع|reference|default_code/],['bc',/باركود|barcode/],['ext',/معرف|external|^id$/],['cost',/تكلف|cost/],['price',/سعر|price/],['unit',/وحدة|unit|uom/],['name',/اسم|name|المنتج|product/]];
function addUom(p,g){
  const name=cell(g('uname'));if(!name)return 0;
  const t=cell(g('utype')).toLowerCase(),ratio=parseFloat(g('uratio'));
  const type=t==='bigger'?'bigger':t==='smaller'?'smaller':'equal',r=(isNaN(ratio)||ratio<=0)?1:ratio;
  let d=uomDef(name);if(d){d.type=type;d.ratio=r}else D.uoms.push({name,type,ratio:r});
  p.uoms=p.uoms||[];
  const pr=g('uprice')===''?'':parseFloat(g('uprice')),bc=cell(g('ubc'));
  const e=p.uoms.find(x=>x.u===name);
  if(e){if(bc)e.bc=bc;if(pr!==''&&!isNaN(pr))e.price=pr}else p.uoms.push({u:name,bc,price:(pr===''||isNaN(pr))?'':pr});
  return 1;
}
/* ===== أعمدة الصور في الشيت =====
   يتعرف تلقائيًا على: صورة / صور / صورة 512 / صور 512 / صورة 256 / 512 / 256 / image_512 … بالأولوية 512 ثم 256 ثم 1024 ثم العادي ثم 128 */
const IMG_RANK={'512':1,'256':2,'1024':3,'':4,'1920':4,'128':5};
function imgCols(h){
  const out=[];
  h.forEach((c,i)=>{
    const t=norm(c).toLowerCase().replace(/[\u064B-\u065F\u0670]/g,'');
    if(!t||/الرسم|graph|zoom|تكبير|^هل |can_|تقييم|rating|avatar|متغير|variant/.test(t))return;
    const m=t.match(/^(صور[ةه]?|image|img|picture|photo)?[\s_-]*(1920|1024|512|256|128)?$/);
    if(!m||(!m[1]&&!m[2]))return;
    out.push({i,r:IMG_RANK[m[2]||'']});
  });
  return out.sort((a,b)=>a.r-b.r||a.i-b.i).map(x=>x.i);
}
/* خلية صورة صالحة؟ (نص base64 لصورة JPG أو PNG أو WebP) — غير ذلك يُتجاهل (مثل رسالة إكسل «المحتوى طويل جدًا») */
function imgClean(v){
  if(typeof v!=='string')return '';
  let s=v.trim();if(s.length<200)return '';
  if(s.charAt(0)==='d')s=s.replace(/^data:[^,]*,/,'');
  s=s.replace(/\s+/g,'');
  if(!/^(\/9j\/|iVBOR|UklGR)/.test(s)||!/^[A-Za-z0-9+/]+={0,2}$/.test(s))return '';
  return s;
}
/* من سطر الشيت: أول صورة صالحة بترتيب الأولوية. bad=true لو في خلية صور لكنها غير صالحة */
function imgOf(r,ic){
  let bad=false;
  for(const i of ic){const v=r[i];if(v===undefined||v===null||v==='')continue;const s=imgClean(String(v));if(s)return{b64:s};bad=true}
  return{b64:'',bad};
}
/* استيراد صور فقط: شيت فيه (معرف خارجي أو باركود أو مرجع داخلي) + عمود صورة — لا يغيّر أي بيانات أخرى */
function importImagesOnly(rows,h,col,ic){
  const PR={};D.products.forEach(p=>{if(p.ref)PR[p.ref.toLowerCase()]=p});
  const imgs=[],miss=[];let bad=0,none=0,seen={};
  rows.forEach((r,ri)=>{
    const ext=col.ext===undefined?'':cell(r[col.ext]),bc=col.bc===undefined?'':cell(r[col.bc]),ref=col.ref===undefined?'':cell(r[col.ref]);
    if(!ext&&!bc&&!ref)return;
    let p=ext?PI.id[ext]:null;
    if(!p&&bc){p=(PI.bc[bc]||[])[0]||(PI.ubc[bc]&&PI.ubc[bc][0]?PI.ubc[bc][0].p:null)}
    if(!p&&ref)p=PR[ref.toLowerCase()];
    const im=imgOf(r,ic);
    if(!im.b64){if(im.bad)bad++;else none++;if(!p)miss.push({line:ri+2,key:ext||bc||ref});return}
    if(!p){miss.push({line:ri+2,key:ext||bc||ref});return}
    if(seen[p.id])return;seen[p.id]=1;
    imgs.push({id:p.id,b64:im.b64});
  });
  return{imgOnly:true,imgs,miss,bad,none,total:rows.length,head:h};
}
function importProducts(rows){
  if(!rows.length)return null;
  const h=rows.shift(),col=mapCols(h,PSPEC),ic=imgCols(h);
  if(col.name===undefined&&ic.length&&(col.ext!==undefined||col.bc!==undefined||col.ref!==undefined))return importImagesOnly(rows,h,col,ic);
  if(col.name===undefined||(col.bc===undefined&&col.ext===undefined))return{err:'لم أجد أعمدة الاسم والباركود في الشيت'};
  const g0=(r,k)=>col[k]===undefined?'':r[col[k]];
  let add=0,upd=0,same=0,uoms=0,last=null,imgBad=0;const imgs=[],FIELDS=['bc','ref','name','cost','price','cat','pcat','type','unit'],qty={},conflicts=[],seenExt={};
  /* منع التكرار: الاسم والباركود والمرجع الداخلي والمعرّف */
  const PN={},PB={},PR={};
  D.products.forEach(p=>{if(p.name)PN[nm(p.name)]=p;if(p.bc)PB[p.bc]=p;if(p.ref)PR[p.ref.toLowerCase()]=p});
  const ubcOwner=bc=>{const u=PI.ubc[bc];return u&&u[0]?u[0].p:null};
  rows.forEach((r,ri)=>{
    const g=k=>g0(r,k);
    const rec={bc:cell(g('bc')),ref:cell(g('ref')),name:cell(g('name')),cost:g('cost')===''?'':parseFloat(g('cost')),price:g('price')===''?'':parseFloat(g('price')),
      cat:cell(g('cat')),pcat:cell(g('pcat')),type:cell(g('type')),unit:cell(g('unit'))};
    const ext=cell(g('ext'));
    /* سطر تابع لمنتج سابق (تصدير أودو: وحدات إضافية في أسطر بدون اسم) */
    if(!rec.name&&!rec.bc&&!ext){if(last&&addUom(last,g))uoms++;return}
    last=null;
    if(rec.cost!==''&&isNaN(rec.cost))rec.cost='';if(rec.price!==''&&isNaN(rec.price))rec.price='';
    let p=ext?PI.id[ext]:null;
    if(!p&&!ext&&rec.bc&&PI.bc[rec.bc])p=PI.bc[rec.bc][0];
    const why=[];
    if(ext&&seenExt[ext])why.push('المعرّف مكرر داخل الملف');
    const on=rec.name&&PN[nm(rec.name)];if(on&&on!==p)why.push('الاسم مكرر مع «'+on.name+'»');
    const ob=rec.bc&&(PB[rec.bc]||ubcOwner(rec.bc));if(ob&&ob!==p)why.push('الباركود مكرر مع «'+ob.name+'»');
    const orf=rec.ref&&PR[rec.ref.toLowerCase()];if(orf&&orf!==p)why.push('المرجع الداخلي مكرر مع «'+orf.name+'»');
    if(why.length){conflicts.push({line:ri+2,row:r,reason:why.join(' + ')});return}
    if(ext)seenExt[ext]=1;
    const old=p?{n:p.name,b:p.bc,r:p.ref}:null;
    if(!p){const id=ext||rec.bc||('P'+(nextNo('prod')));p=Object.assign({id},rec);D.products.push(p);PI.id[id]=p;if(rec.bc)(PI.bc[rec.bc]=PI.bc[rec.bc]||[]).push(p);add++}
    else{let ch=false;FIELDS.forEach(f=>{if(rec[f]!==''&&p[f]!==rec[f]){p[f]=rec[f];ch=true}});if(ch)upd++;else same++}
    if(old){if(old.n&&nm(old.n)!==nm(p.name))delete PN[nm(old.n)];if(old.b&&old.b!==p.bc)delete PB[old.b];if(old.r&&old.r.toLowerCase()!==String(p.ref||'').toLowerCase())delete PR[old.r.toLowerCase()]}
    if(p.name)PN[nm(p.name)]=p;if(p.bc)PB[p.bc]=p;if(p.ref)PR[p.ref.toLowerCase()]=p;
    if(addUom(p,g))uoms++;
    const q=num(g('qty'));if(!isNaN(q))qty[p.id]=q;
    if(ic.length){const im=imgOf(r,ic);if(im.b64)imgs.push({id:p.id,b64:im.b64});else if(im.bad)imgBad++}
    last=p;
  });
  reindex();save('products','cnt','uoms');return{add,upd,same,uoms,qty,conflicts,head:h,imgs,imgBad};
}
/* ===== الموردين ===== */
function importSuppliers(rows){
  if(!rows.length)return null;
  const h=rows[0].map(cell).join(' ');if(/اسم|name/i.test(h))rows.shift();
  const have={};D.suppliers.forEach(s=>have[nm(s.name)]=1);let add=0,skip=0;
  rows.forEach(r=>{const n=cell(r[0]);if(!n)return;if(have[nm(n)]){skip++;return}have[nm(n)]=1;
    D.suppliers.push({id:'S'+(nextNo('sup')),name:n,phone:'',addr:'',note:'',open:0});add++});
  save('suppliers','cnt');return{add,skip};
}
/* ===== الموظفين ===== */
const ESPEC=[['mgr',/^المدير|manager/],['name',/اسم|name/],['phone',/هاتف|phone|mobile/],['email',/بريد|mail/],['dept',/قسم|depart/],['job',/منصب|job|position/]];
function importEmployees(rows){
  if(!rows.length)return null;
  const col=mapCols(rows.shift(),ESPEC);if(col.name===undefined)col.name=0;
  const g=(r,k)=>col[k]===undefined?'':cell(r[col[k]]);let add=0,upd=0;
  rows.forEach(r=>{
    const n=g(r,'name');if(!n)return;
    const rec={name:n,phone:g(r,'phone'),email:g(r,'email'),dept:g(r,'dept'),job:g(r,'job'),mgr:g(r,'mgr')};
    const e=D.employees.find(x=>nm(x.name)===nm(n));
    if(e){Object.assign(e,rec);upd++}
    else{const ne=Object.assign({id:'E'+(nextNo('emp')),pin:'',perms:{},active:true},rec);
      if(/كاشير/.test(rec.job)&&typeof ROLES!=='undefined')ROLES['مستخدم نقطة البيع (كاشير)'].forEach(p=>ne.perms[p]=true);
      D.employees.push(ne);add++}
  });
  save('employees','cnt');if(typeof saveEmpFile==='function')saveEmpFile();return{add,upd};
}
/* ===== أرصدة المخزون من شيت (باركود + كمية) لفرع محدد ===== */
function importStock(rows,br){
  if(!rows.length)return null;
  const col=mapCols(rows.shift(),[['bc',/باركود|barcode/],['qty',/^(?!.*محسوب).*(الكمية|qty|quantity)/]]);
  if(col.bc===undefined||col.qty===undefined)return{err:'لم أجد عمودي الباركود والكمية'};
  const acc={};let miss=0;
  rows.forEach(r=>{const q=num(r[col.qty]);if(isNaN(q))return;const m=find(cell(r[col.bc]));if(m.length!==1){miss++;return}acc[m[0].id]=(acc[m[0].id]||0)+q});
  D.stock[br]=D.stock[br]||{};Object.keys(acc).forEach(id=>{D.stock[br][id]=r3(acc[id])});
  save('stock');return{ok:Object.keys(acc).length,miss};
}

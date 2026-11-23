/* ===== المخزون ===== */
const INV={lim:150,tab:'bal',tr:{from:'',to:'',lines:[]},cn:{br:'',lines:[]}};
function invFix(){
  if(!BR.includes(INV.tr.from))INV.tr.from=BR[0];
  if(!BR.includes(INV.tr.to)||(INV.tr.to===INV.tr.from&&BR.length>1))INV.tr.to=BR.find(b=>b!==INV.tr.from)||BR[0];
  if(!BR.includes(INV.cn.br))INV.cn.br=BR[0];
}
const tabs=(cur,list,act)=>`<div class="row" style="margin-bottom:10px">${list.map(x=>`<button class="${cur===x[0]?'p':''}" data-a="${act}" data-v="${x[0]}">${x[1]}</button>`).join('')}</div>`;
V.inventory=()=>{
  if(!can('inv_view')){say('ليس لديك صلاحية المخزون',1);return go('home')}
  invFix();
  const T=[['bal','الأرصدة'],['val','قيمة المخزون'],['tr','التحويل بين الفروع'],['cn','الجرد الفعلي']];
  setMain(`<div class="ttl">المخزون</div>${tabs(INV.tab,T,'invTab')}<div id="invB"></div>`);
  ({bal:invBal,val:invVal,tr:invTr,cn:invCn})[INV.tab]();
};
A.invTab=t=>{INV.tab=t.dataset.v;V.inventory()};

/* --- الأرصدة (فلترة بالفئة / الرصيد / ترتيب بالسعر) --- */
function invBal(){
  $('invB').innerHTML=`<div class="card"><div class="row"><input id="ivQ" data-i="ivQ" placeholder="بحث بالاسم أو الباركود" style="max-width:260px"><select id="ivBr" data-c="ivQ" style="max-width:190px"><option value="">كل الفروع</option>${BR.map(b=>`<option>${esc(b)}</option>`).join('')}</select>
  <select id="ivCat" data-c="ivQ" style="max-width:210px">${optList(distinct('cat'),'','كل الفئات')}</select><select id="ivSort" data-c="ivQ" style="max-width:200px">${SORTS}</select>
  <label><input type="checkbox" id="ivNz" data-c="ivQ"> ما له رصيد فقط</label>
  ${can('inv_adjust')?'<button data-a="ivImp">📥 استيراد أرصدة من Excel</button>':''}</div></div><div class="card" id="ivL"></div>`;
  INV.lim=150;ivList();
}
I.ivQ=C.ivQ=()=>{INV.lim=150;ivList()};
A.ivMore=()=>{INV.lim+=300;ivList()};
function ivList(){
  const q=norm($('ivQ').value),br=$('ivBr').value,nz=$('ivNz').checked,cat=$('ivCat').value;
  const cols=br?[br]:BR;
  let src=q?search(q,100000):D.products.slice();
  if(cat)src=src.filter(p=>p.cat===cat);
  const rowsData=[];
  src.forEach(p=>{const v=cols.map(b=>stk(b,p.id)),tot=r3(v.reduce((a,b)=>a+b,0));if(nz&&!tot)return;rowsData.push({p,v,tot})});
  const so=$('ivSort').value;
  if(so==='hi')rowsData.sort((a,b)=>pPrice(b.p)-pPrice(a.p));else if(so==='lo')rowsData.sort((a,b)=>pPrice(a.p)-pPrice(b.p));
  else rowsData.sort((a,b)=>String(a.p.name).localeCompare(String(b.p.name),'ar'));
  const rows=rowsData.slice(0,INV.lim).map(({p,v,tot})=>`<tr><td>${pimg(p,0,1)}</td><td>${esc(p.bc)}</td><td class="l">${esc(p.name)}</td><td>${esc(p.cat)}</td><td>${money(pPrice(p))}</td>${v.map(x=>`<td${x<0?' style="color:var(--bad)"':''}>${fmt(x)}</td>`).join('')}${br?'':`<td><b>${fmt(tot)}</b></td>`}${can('inv_adjust')?`<td><button data-a="ivAdj" data-id="${esc(p.id)}">تسوية</button></td>`:''}</tr>`).join('');
  $('ivL').innerHTML=`<div class="mut" style="margin-bottom:6px">عدد الأصناف المطابقة: ${rowsData.length}</div>`+tbl([''].concat(['الباركود','الاسم','الفئة','السعر'],cols,br?[]:['الإجمالي'],can('inv_adjust')?['']:[]),rows)+(rowsData.length>INV.lim?`<button style="width:100%;margin-top:8px" data-a="ivMore">عرض المزيد (${rowsData.length-INV.lim})</button>`:'');
}
A.ivAdj=async t=>{
  const p=PI.id[t.dataset.id];
  const r=await formDlg('تسوية رصيد: '+p.name,[{k:'b',l:'الفرع',t:'select',o:BR},{k:'q',l:'الرصيد الصحيح الجديد',t:'number'}],'تسوية');
  if(!r)return;const q=num(r.q);if(isNaN(q)){say('رقم غير صحيح',1);return}
  D.stock[r.b]=D.stock[r.b]||{};D.stock[r.b][p.id]=r3(q);save('stock');say('تمت التسوية');ivList();
};
A.ivImp=async()=>{
  const r=await formDlg('استيراد أرصدة (أعمدة: باركود + الكمية)',[{k:'b',l:'الفرع الذي ستُسجَّل عليه الأرصدة',t:'select',o:BR}],'اختيار الملف');
  if(!r)return;
  const inp=document.createElement('input');inp.type='file';inp.accept='.xlsx,.xls,.csv';
  inp.onchange=async()=>{const f=inp.files[0];if(!f)return;const res=importStock(await readRows(f),r.b);
    if(!res||res.err){say(res?res.err:'ملف فارغ',1);return}say(`تم تسجيل ${res.ok} رصيدًا في «${r.b}» — غير مطابق: ${res.miss}`);ivList()};
  inp.click();
};

/* --- التحويل بين الفروع --- */
function invTr(){
  const t=INV.tr;
  $('invB').innerHTML=`<div class="card"><div class="g2"><div><div class="lbl">من فرع</div><select data-c="trBr" data-f="from">${BR.map(b=>`<option${b===t.from?' selected':''}>${b}</option>`).join('')}</select></div><div><div class="lbl">إلى فرع</div><select data-c="trBr" data-f="to">${BR.map(b=>`<option${b===t.to?' selected':''}>${b}</option>`).join('')}</select></div></div>
  ${can('inv_transfer')?'<input id="trAdd" data-k="trAdd" data-i="trQ" placeholder="امسح الباركود أو اكتب اسم الصنف ثم Enter" style="margin-top:8px" autocomplete="off"><div id="trRes"></div>':''}<div id="trL"></div>
  ${can('inv_transfer')?'<button class="p" style="width:100%;margin-top:8px" data-a="trGo">تنفيذ التحويل</button>':''}</div>
  <div class="card"><div class="ttl">آخر التحويلات</div>${D.transfers.length?tbl(['#','التاريخ','من','إلى','عدد الأصناف','بواسطة'],D.transfers.slice(-30).reverse().map(x=>`<tr><td>${x.no}</td><td>${esc(x.dt)}</td><td>${esc(x.from)}</td><td>${esc(x.to)}</td><td>${x.lines.length}</td><td>${esc(x.user)}</td></tr>`).join('')):'<div class="mut">لا توجد تحويلات</div>'}</div>`;
  trLines();
}
C.trBr=t=>{INV.tr[t.dataset.f]=t.value};
function trLines(){
  const t=INV.tr;
  $('trL').innerHTML=t.lines.length?tbl(['الباركود','الاسم','رصيد المصدر','الكمية',''],t.lines.map((l,i)=>`<tr><td>${esc(l.b)}</td><td class="l">${esc(l.n)}</td><td>${fmt(stk(t.from,l.id))}</td><td><input inputmode="decimal" value="${l.qty}" data-c="trQty" data-n="${i}"></td><td><button class="d" data-a="trDel" data-n="${i}">✕</button></td></tr>`).join('')):'<div class="mut" style="padding:8px">أضف الأصناف المراد تحويلها</div>';
}
C.trQty=t=>{const v=num(t.value);if(!isNaN(v)&&v>0)INV.tr.lines[+t.dataset.n].qty=v;trLines()};
A.trDel=t=>{INV.tr.lines.splice(+t.dataset.n,1);trLines()};
function addToList(list,p,q,after){
  const e=list.find(l=>l.id===p.id);
  if(e)e.qty=r3(e.qty+(q>0?q:1));else list.push({id:p.id,b:p.bc,n:p.name,qty:q>0?q:1,sys:0});
  after();
}
I.trQ=t=>{const q=norm(t.value);$('trRes').innerHTML=q.length<2?'':search(q,10).map(p=>`<div class="row" style="padding:6px;border-bottom:1px solid var(--bd);cursor:pointer" data-a="trPick" data-id="${esc(p.id)}"><span style="flex:1">${esc(p.name)}</span><span class="mut">${esc(p.bc)}</span></div>`).join('')};
A.trPick=t=>{const p=PI.id[t.dataset.id];addToList(INV.tr.lines,p,0,()=>{trLines();$('trAdd').value='';$('trRes').innerHTML=''})};
K.trAdd=(t,e)=>{if(e.key!=='Enter')return;const v=norm(t.value);let m=find(v);if(!m.length)m=search(v,3);
  if(m.length===1){addToList(INV.tr.lines,m[0],scaleQty(v,m[0]),()=>{trLines();t.value='';$('trRes').innerHTML=''})}else if(!m.length)say('الصنف غير موجود',1)};
A.trGo=async()=>{
  const t=INV.tr;
  if(t.from===t.to){say('اختر فرعين مختلفين',1);return}
  if(!t.lines.length){say('لا توجد أصناف',1);return}
  const neg=t.lines.filter(l=>stk(t.from,l.id)<l.qty);
  if(neg.length&&!(await dlg(`${neg.length} صنف رصيده في «${t.from}» أقل من الكمية المحوَّلة. هل تريد المتابعة؟`,{yes:'متابعة'})))return;
  t.lines.forEach(l=>{const tot=costOut(t.from,l.id,l.qty);costIn(t.to,l.id,l.qty,l.qty?tot/l.qty:0,'transfer')});
  D.transfers.push({no:nextNo('tr'),dt:nowStr(),ts:Date.now(),from:t.from,to:t.to,user:ME.name,lines:t.lines.map(l=>({id:l.id,b:l.b,n:l.n,qty:l.qty}))});
  save('stock','transfers','cnt');await flush();
  const tr=D.transfers[D.transfers.length-1],day=dayStr();
  saveX(`المخزون/${tr.from}/${day}`,`تحويل ${tr.no} - من ${tr.from} إلى ${tr.to} - ${day}.xlsx`,wbOf([['التحويل',[['رقم التحويل',tr.no],['من',tr.from],['إلى',tr.to],['التاريخ',tr.dt],['بواسطة',tr.user],[],['الباركود','الاسم','الكمية']].concat(tr.lines.map(l=>[String(l.b),l.n,l.qty]))]]));
  INV.tr.lines=[];say('تم التحويل');invTr();
};

/* --- الجرد الفعلي --- */
function invCn(){
  const c=INV.cn;
  $('invB').innerHTML=`<div class="card"><div class="lbl">الفرع</div><select data-c="cnBr" style="max-width:240px">${BR.map(b=>`<option${b===c.br?' selected':''}>${b}</option>`).join('')}</select>
  ${can('inv_count')?'<input id="cnAdd" data-k="cnAdd" data-i="cnQ" placeholder="امسح الباركود (كل مسح يزيد الكمية 1) أو اكتب الاسم ثم Enter" style="margin-top:8px" autocomplete="off"><div id="cnRes"></div>':''}<div id="cnL"></div>
  <div class="row" style="margin-top:8px"><button data-a="cnExp">⬇️ تصدير Excel</button>${can('inv_adjust')?'<button class="p" data-a="cnOk">✅ اعتماد الجرد وتسوية الأرصدة</button>':''}<button class="d" data-a="cnClr">مسح</button></div></div>`;
  cnLines();
}
C.cnBr=t=>{INV.cn.br=t.value;cnLines()};
function cnLines(){
  const c=INV.cn;
  $('cnL').innerHTML=c.lines.length?tbl(['الباركود','الاسم','النظام','الفعلي','الفرق',''],c.lines.map((l,i)=>{const s=stk(c.br,l.id),d=r3(l.qty-s);
    return `<tr><td>${esc(l.b)}</td><td class="l">${esc(l.n)}</td><td>${fmt(s)}</td><td><input inputmode="decimal" value="${l.qty}" data-c="cnQty" data-n="${i}"></td><td style="color:${d<0?'var(--bad)':d>0?'var(--ok)':'inherit'}">${d>0?'+':''}${fmt(d)}</td><td><button class="d" data-a="cnDel" data-n="${i}">✕</button></td></tr>`}).join('')):'<div class="mut" style="padding:8px">لا توجد أصناف في الجرد</div>';
}
C.cnQty=t=>{const v=num(t.value);if(!isNaN(v)&&v>=0)INV.cn.lines[+t.dataset.n].qty=v;cnLines()};
A.cnDel=t=>{INV.cn.lines.splice(+t.dataset.n,1);cnLines()};
A.cnClr=async()=>{if(INV.cn.lines.length&&await dlg('مسح قائمة الجرد؟',{yes:'مسح'})){INV.cn.lines=[];cnLines()}};
I.cnQ=t=>{const q=norm(t.value);$('cnRes').innerHTML=q.length<2?'':search(q,10).map(p=>`<div class="row" style="padding:6px;border-bottom:1px solid var(--bd);cursor:pointer" data-a="cnPick" data-id="${esc(p.id)}"><span style="flex:1">${esc(p.name)}</span><span class="mut">${esc(p.bc)}</span></div>`).join('')};
A.cnPick=t=>{addToList(INV.cn.lines,PI.id[t.dataset.id],0,()=>{cnLines();$('cnAdd').value='';$('cnRes').innerHTML=''})};
K.cnAdd=(t,e)=>{if(e.key!=='Enter')return;const v=norm(t.value);let m=find(v);if(!m.length)m=search(v,3);
  if(m.length===1){addToList(INV.cn.lines,m[0],scaleQty(v,m[0]),()=>{cnLines();t.value='';$('cnRes').innerHTML=''})}else if(!m.length)say('الصنف غير موجود',1)};
A.cnExp=async()=>{
  const c=INV.cn;if(!c.lines.length){say('لا توجد أصناف',1);return}
  const rows=[['معرف','الباركود','المنتج','الكمية على النظام','الكمية المحسوبة','الفرق','الفرع']].concat(c.lines.map(l=>{const s=stk(c.br,l.id);return[l.id,l.b,l.n,s,l.qty,r3(l.qty-s),c.br]}));
  const p=await saveX(`المخزون/${c.br}/${dayStr()}`,`جرد - ${c.br} - ${dayStr()}.xlsx`,wbOf([['الجرد',rows]]));if(p)say('تم حفظ الملف: '+p);
};
A.cnOk=async()=>{
  const c=INV.cn;if(!c.lines.length){say('لا توجد أصناف',1);return}
  if(!(await dlg(`اعتماد الجرد؟ سيتم تعيين رصيد ${c.lines.length} صنف في «${c.br}» بالكميات الفعلية.`,{yes:'اعتماد'})))return;
  await A.cnExp();
  D.stock[c.br]=D.stock[c.br]||{};c.lines.forEach(l=>{D.stock[c.br][l.id]=r3(l.qty)});
  save('stock');await flush();INV.cn.lines=[];say('تم اعتماد الجرد وتسوية الأرصدة');invCn();
};

/* ===== قيمة المخزون الفعلية (بالتكلفة حسب طريقة FIFO / LIFO / المتوسط) ===== */
function valueOf(b,id){
  const p=PI.id[id],st=stk(b,id),fb=p?pCost(p):0;
  if(st<=0)return r2(st*fb);
  const L=((D.layers[b]||{})[id]||[]).map(x=>({q:x.q,c:x.c})),sum=lsum(L);
  if(sum>st)takeFrom(L,r3(sum-st),costMethod(p));
  return r2(L.reduce((a,x)=>a+x.q*x.c,0)+Math.max(0,st-sum)*fb);
}
function invVal(){
  $('invB').innerHTML=`<div class="card"><div class="row"><input id="vlQ" data-i="vlQ" placeholder="بحث بالاسم أو الباركود" style="max-width:240px"><select id="vlBr" data-c="vlQ" style="max-width:190px"><option value="">كل الفروع</option>${BR.map(b=>`<option>${esc(b)}</option>`).join('')}</select>
  <select id="vlCat" data-c="vlQ" style="max-width:210px">${optList(distinct('cat'),'','كل الفئات')}</select>
  <select id="vlF" data-c="vlQ" style="max-width:240px"><option value="">كل المنتجات</option><option value="has">له رصيد فقط</option><option value="neg">المخزون السالب فقط</option><option value="stale">الراكد (بدون بيع)</option><option value="low">تحت الحد الأدنى</option></select>
  <input id="vlD" type="number" value="60" min="1" style="max-width:90px" data-i="vlQ" title="أيام الركود"><span class="mut">يوم (للراكد)</span>
  <select id="vlS" data-c="vlQ" style="max-width:220px"><option value="name">الترتيب: الاسم</option><option value="cat">حسب الفئة</option><option value="hi">الأعلى قيمة أولًا</option><option value="lo">الأقل قيمة أولًا</option><option value="qty">الأعلى كمية أولًا</option></select></div>
  <div class="row" style="margin-top:8px"><button data-a="vlExp">⬇️ تصدير Excel</button><button data-a="vlPrint">🖨 طباعة</button></div></div><div id="vlC"></div><div class="card" id="vlL"></div>`;
  INV.lim=150;vlRun();
}
I.vlQ=C.vlQ=()=>{INV.lim=150;vlRun()};
function vlData(){
  const q=norm($('vlQ').value),br=$('vlBr').value,cat=$('vlCat').value,f=$('vlF').value,days=parseInt($('vlD').value,10)||60,so=$('vlS').value;
  const cols=br?[br]:BR;let src=q?search(q,100000):D.products;
  if(cat)src=src.filter(p=>p.cat===cat);
  let last=null;if(f==='stale'){last={};D.sales.forEach(d=>{if(d.type!=='sale')return;d.lines.forEach(l=>{if(!last[l.id]||d.ts>last[l.id])last[l.id]=d.ts})})}
  const lim=Date.now()-days*86400000,rows=[];
  src.forEach(p=>{
    const qs=cols.map(b=>stk(b,p.id)),vs=cols.map(b=>valueOf(b,p.id)),qty=r3(qs.reduce((a,x)=>a+x,0)),val=r2(vs.reduce((a,x)=>a+x,0));
    if(f==='has'&&!(qty>0))return;if(f==='neg'&&!qs.some(x=>x<0))return;
    if(f==='stale'&&!(qty>0&&(!last[p.id]||last[p.id]<lim)))return;
    if(f==='low'&&!(p.min>0&&qty<=p.min))return;
    if(!f&&!qty&&!val)return;
    rows.push({p,qs,vs,qty,val});
  });
  if(so==='hi')rows.sort((a,b)=>b.val-a.val);else if(so==='lo')rows.sort((a,b)=>a.val-b.val);else if(so==='qty')rows.sort((a,b)=>b.qty-a.qty);
  else if(so==='cat')rows.sort((a,b)=>String(a.p.cat).localeCompare(String(b.p.cat),'ar')||String(a.p.name).localeCompare(String(b.p.name),'ar'));
  else rows.sort((a,b)=>String(a.p.name).localeCompare(String(b.p.name),'ar'));
  return{cols,rows};
}
function vlRun(){
  const {cols,rows}=vlData(),tot=r2(rows.reduce((a,r)=>a+r.val,0)),byB=cols.map((b,i)=>r2(rows.reduce((a,r)=>a+r.vs[i],0))),negN=rows.filter(r=>r.qs.some(x=>x<0)).length;
  $('vlC').innerHTML=`<div class="g2"><div class="card" style="border-color:var(--pri)"><div class="mut">إجمالي قيمة المخزون</div><div class="ttl" style="color:var(--pri2)">${money(tot)}</div></div>${cols.map((b,i)=>`<div class="card"><div class="mut">${esc(b)}</div><div class="ttl">${money(byB[i])}</div></div>`).join('')}<div class="card"><div class="mut">عدد الأصناف</div><div class="ttl">${rows.length}</div></div><div class="card"><div class="mut">أصناف برصيد سالب</div><div class="ttl" style="color:${negN?'var(--bad)':'inherit'}">${negN}</div></div></div>`;
  $('vlL').innerHTML=tbl(['الباركود','الاسم','الفئة','طريقة التكلفة','الكمية','متوسط التكلفة','القيمة'].concat(cols.length>1?cols.map(b=>'قيمة '+b):[]),rows.slice(0,INV.lim).map(r=>`<tr><td>${esc(r.p.bc)}</td><td class="l">${esc(r.p.name)}</td><td>${esc(r.p.cat)}</td><td>${esc(costMethod(r.p).toUpperCase())}</td><td${r.qty<0?' style="color:var(--bad)"':''}>${fmt(r.qty)}</td><td>${r.qty?money(r.val/r.qty):'—'}</td><td><b>${money(r.val)}</b></td>${cols.length>1?r.vs.map(v=>`<td>${money(v)}</td>`).join(''):''}</tr>`).join(''))+(rows.length>INV.lim?`<button style="width:100%;margin-top:8px" data-a="vlMore">عرض المزيد (${rows.length-INV.lim})</button>`:'');
}
A.vlMore=()=>{INV.lim+=300;vlRun()};
A.vlExp=async()=>{
  const {cols,rows}=vlData(),data=[['الباركود','الاسم','الفئة','طريقة التكلفة','الكمية','متوسط التكلفة','القيمة'].concat(cols.map(b=>'قيمة '+b))].concat(rows.map(r=>[String(r.p.bc),r.p.name,r.p.cat,costMethod(r.p).toUpperCase(),r.qty,r.qty?r2(r.val/r.qty):0,r.val].concat(r.vs)));
  data.push([],['الإجمالي','','','','','',r2(rows.reduce((a,r)=>a+r.val,0))].concat(cols.map((b,i)=>r2(rows.reduce((a,r)=>a+r.vs[i],0)))));
  const p=await saveX(`المخزون/قيمة المخزون/${dayStr()}`,`قيمة المخزون ${dayStr()}.xlsx`,wbOf([['قيمة المخزون',data]]));if(p)say('تم حفظ الملف: '+p);
};
A.vlPrint=()=>{
  const {rows}=vlData();
  printHtml(`<img class="pl" src="${logoSrc()}" alt=""><h2>تقرير قيمة المخزون — ${esc(dayStr())}</h2><table><thead><tr><th>الصنف</th><th>الفئة</th><th>الكمية</th><th>متوسط التكلفة</th><th>القيمة</th></tr></thead><tbody>${rows.slice(0,2000).map(r=>`<tr><td style="text-align:right">${esc(r.p.name)}</td><td>${esc(r.p.cat)}</td><td>${fmt(r.qty)}</td><td>${r.qty?money(r.val/r.qty):'—'}</td><td>${money(r.val)}</td></tr>`).join('')}</tbody></table><div class="gt2">إجمالي قيمة المخزون: ${money(rows.reduce((a,r)=>a+r.val,0))}</div>`,'a4');
};

/* ===== دورة الشراء: طلب عرض سعر ← أمر شراء/توريد ← تأكيد الاستلام (يضيف للمخزون) ← فاتورة المورد (المحاسبة) ===== */
const PU={doc:null,tab:'ord',f:'',st:''};
const ST={rfq:['طلب عرض سعر','b-draft'],sent:['أُرسل للمورد','b-draft'],po:['أمر شراء مؤكد','b-draft'],partial:['استلام جزئي','b-draft'],received:['تم الاستلام','b-done'],cancelled:['ملغي','b-cancel']};
const STEPS=['① طلب عرض سعر','② أمر شراء / توريد','③ تأكيد الاستلام','④ إضافة للمخزون','⑤ الفوترة'];
const puTotal=d=>r2(d.lines.reduce((s,l)=>s+l.qty*l.cost,0));
const supById=id=>D.suppliers.find(s=>s.id===id);
const supByName=n=>D.suppliers.find(s=>nm(s.name)===nm(n));
const lnNet=l=>r3((l.recv||0)-(l.ret||0));
const lnUnb=l=>Math.max(0,r3(lnNet(l)-((l.billed||0)-(l.cn||0))));
const lnRem=l=>Math.max(0,r3(l.qty-(l.recv||0)));
const puRecvVal=d=>r2(d.lines.reduce((s,l)=>s+lnNet(l)*l.cost,0));
const puUnbVal=d=>r2(d.lines.reduce((s,l)=>s+lnUnb(l)*l.cost,0));
const puHasRecv=d=>d.lines.some(l=>(l.recv||0)>0);
const puOpenStatus=d=>d.status==='po'||d.status==='partial';
function puBillBadge(d){
  if(!puHasRecv(d))return '—';
  const u=d.lines.reduce((s,l)=>s+lnUnb(l),0),b=d.lines.some(l=>(l.billed||0)>0);
  return u<=0.0005?'<span class="badge b-done">مفوترة</span>':b?'<span class="badge b-draft">فُوترت جزئيًا</span>':'<span class="badge b-cancel">لم تُفوتر</span>';
}
/* ترحيل بيانات النظام القديم إلى دورة الشراء الجديدة (مرة واحدة) */
function migrateCycle(){
  if((D.set.schema||0)>=2)return;
  D.purchases.forEach(d=>{
    if(d.status==='draft'){d.status='rfq';d.lines.forEach(l=>{l.recv=0;l.ret=0;l.billed=0;l.cn=0});return}
    if(d.status==='received'){
      const rid=nextNo('rec'),ts=d.rts||Date.parse(d.date)||Date.now(),tot=puTotal(d);
      d.lines.forEach((l,i)=>{l.recv=l.qty;l.ret=(d.ret||[])[i]||0;l.billed=l.qty;l.cn=l.ret});
      const ls=d.lines.map((l,i)=>({i,id:l.id,n:l.n,b:l.b,qty:l.qty,cost:l.cost,u:l.u||'',uf:l.uf||1}));
      D.recs.push({id:rid,pur:d.id,sup:d.sup,supName:d.supName,br:d.br,date:d.date,dt:d.rdt||d.date,ts,user:d.rby||d.emp,lines:ls,legacy:true});
      D.bills.push({id:nextNo('bill'),pur:d.id,sup:d.sup,supName:d.supName,date:d.date,no:'',due:d.date,method:'آجل',lines:ls.map(x=>Object.assign({pcost:x.cost},x)),total:tot,note:'فاتورة محوّلة من النظام القديم',user:d.rby||d.emp,dt:d.rdt||d.date,ts,legacy:true});
      delete d.ret;return;
    }
    d.lines.forEach(l=>{l.recv=l.recv||0;l.ret=l.ret||0;l.billed=l.billed||0;l.cn=l.cn||0});
  });
  D.pret.forEach(x=>{if(x.cn===undefined)x.cn=x.total});
  D.set.schema=2;save('purchases','recs','bills','pret','set','cnt');
}

/* ملفات Excel: المشتريات / الفرع / التاريخ */
function purFile(d,kind){return{folder:`المشتريات/${d.br}/${d.date}`,name:`${kind||'أمر شراء'} ${d.id} - ${d.supName} - ${d.date}.xlsx`}}
function savePurFile(d){
  const rows=[['رقم الطلب',d.id],['المورد',d.supName],['الفرع (المخزن)',d.br],['التاريخ',d.date],['القائم بالطلب',d.emp],['الحالة',ST[d.status][0]],[],['الباركود','الاسم','الوحدة','الكمية المطلوبة','المستلم','المرتجع','المفوتر','التكلفة','الإجمالي']];
  d.lines.forEach(l=>rows.push([String(l.b),l.n,l.u||'',l.qty,l.recv||0,l.ret||0,l.billed||0,l.cost,r2(l.qty*l.cost)]));
  rows.push([],['','','','','','','','إجمالي الطلب',puTotal(d)]);
  const f=purFile(d);return saveX(f.folder,f.name,wbOf([['أمر الشراء',rows]]));
}
const recTotal=r=>r2(r.lines.reduce((s,l)=>s+l.qty*l.cost,0));
function saveRecFile(r){
  const rows=[['إيصال استلام رقم',r.id],['عن أمر الشراء',r.pur],['المورد',r.supName],['الفرع',r.br],['التاريخ',r.dt],['بواسطة',r.user],[],['الباركود','الصنف','الوحدة','الكمية المستلمة','التكلفة','الإجمالي']]
    .concat(r.lines.map(l=>[String(l.b),l.n,l.u,l.qty,l.cost,r2(l.qty*l.cost)]),[[],['','','','','إجمالي الاستلام',recTotal(r)]]);
  return saveX(`المشتريات/${r.br}/${r.date}`,`استلام ${r.id} - ${r.supName} - ${r.date}.xlsx`,wbOf([['الاستلام',rows]]));
}

/* ===== القوائم ===== */
const PTABS=[['ord','طلبات الشراء'],['rec','الاستلامات'],['bill','فواتير الموردين'],['ret','مرتجعات الموردين']];
A.puTab=t=>{PU.tab=t.dataset.v;V.purchases()};
V.purchases=()=>{
  if(!can('pur_view')){say('ليس لديك صلاحية المشتريات',1);return go('home')}
  if(PU.tab==='rec')return purRecList();
  if(PU.tab==='bill')return purBillList();
  if(PU.tab==='ret')return purRetList();
  setMain(`<div class="row"><div class="ttl" style="flex:1;margin:0">المشتريات</div>${can('pur_edit')?'<button class="p" data-a="purNew">➕ طلب عرض سعر جديد</button>':''}</div>${tabs(PU.tab,PTABS,'puTab')}
  <div class="card"><div class="row"><input id="puF" data-i="puFlt" placeholder="بحث باسم المورد أو رقم الطلب" style="max-width:320px"><select id="puS" data-c="puFlt" style="max-width:220px"><option value="">كل الحالات</option>${Object.keys(ST).map(k=>`<option value="${k}">${ST[k][0]}</option>`).join('')}</select></div></div><div class="card" id="puL"></div>`);
  puList();
};
I.puFlt=C.puFlt=()=>puList();
function puList(){
  const q=nm($('puF').value),st=$('puS').value;
  const l=D.purchases.filter(d=>(!st||d.status===st)&&(!q||nm(d.supName).includes(q)||String(d.id)===q)).slice().sort((a,b)=>b.id-a.id).slice(0,200);
  $('puL').innerHTML=l.length?tbl(['#','اسم المورد','التاريخ','الفرع','قيمة الطلب','الحالة','الاستلام','الفوترة','أودو'],l.map(d=>{
    const ord=d.lines.reduce((s,x)=>s+x.qty,0),rc=d.lines.reduce((s,x)=>s+Math.min(x.recv||0,x.qty),0);
    return `<tr class="clk" data-a="purOpen" data-id="${d.id}"><td>${d.id}</td><td class="l">${esc(d.supName)}</td><td>${esc(d.date)}</td><td>${esc(d.br)}</td><td><b>${money(puTotal(d))}</b></td><td><span class="badge ${ST[d.status][1]}">${ST[d.status][0]}</span></td><td>${d.status==='rfq'||d.status==='sent'||d.status==='cancelled'?'—':Math.round(rc/(ord||1)*100)+'%'}</td><td>${puBillBadge(d)}</td><td>${['po','partial','received'].includes(d.status)?syBadge(d):''}</td></tr>`}).join('')):'<div class="mut">لا توجد طلبات شراء</div>';
}
A.purOpen=t=>go('purEdit',+t.dataset.id);
A.purNew=()=>{
  if(!can('pur_edit')){say('ليس لديك صلاحية',1);return}
  const d={id:nextNo('pur'),sup:null,supName:'',date:dayStr(),emp:ME.name,br:BR[0],status:'rfq',lines:[]};
  D.purchases.push(d);save('purchases','cnt');go('purEdit',d.id);
};
function purRecList(){
  setMain(`<div class="ttl">المشتريات</div>${tabs(PU.tab,PTABS,'puTab')}<div class="card" id="puL"></div>`);
  const l=D.recs.slice().sort((a,b)=>b.id-a.id).slice(0,200);
  $('puL').innerHTML=l.length?tbl(['#','عن الطلب','المورد','التاريخ','الفرع','القيمة','بواسطة'],l.map(r=>`<tr class="clk" data-a="purOpen" data-id="${r.pur}"><td>${r.id}</td><td>${r.pur}</td><td class="l">${esc(r.supName)}</td><td>${esc(r.dt)}</td><td>${esc(r.br)}</td><td><b>${money(recTotal(r))}</b></td><td>${esc(r.user)}</td></tr>`).join('')):'<div class="mut">لا توجد استلامات. تُسجَّل من داخل أمر الشراء (زر «تأكيد استلام المنتجات»).</div>';
}

/* ===== صفحة أمر الشراء ===== */
function stepIdx(d){
  if(d.status==='cancelled')return -1;
  if(d.status==='rfq'||d.status==='sent')return 0;
  if(!puHasRecv(d))return 1;
  const u=d.lines.reduce((s,l)=>s+lnUnb(l),0);
  return u<=0.0005?4:3;
}
V.purEdit=id=>{
  const d=D.purchases.find(x=>x.id===id);if(!d){go('purchases');return}
  PU.doc=d;const ed=(d.status==='rfq'||d.status==='sent')&&can('pur_edit'),si=stepIdx(d);
  const rcs=D.recs.filter(r=>r.pur===d.id),bls=D.bills.filter(b=>b.pur===d.id),rts=D.pret.filter(r=>r.pur===d.id);
  setMain(`<div class="row"><button data-a="go" data-v="purchases">‹ المشتريات</button><div class="ttl" style="margin:0;flex:1">طلب شراء #${d.id} <span class="badge ${ST[d.status][1]}">${ST[d.status][0]}</span> ${['po','partial','received'].includes(d.status)?syBadge(d):''}</div></div>
  <div class="row" style="margin:8px 0;gap:6px">${STEPS.map((s,i)=>`<div style="flex:1;min-width:130px;text-align:center;padding:8px;border-radius:10px;border:2px solid ${i<=si?'var(--pri)':'var(--bd)'};background:${i<si?'var(--pl)':i===si?'#fff':'#f7f7f7'};font-weight:${i===si?700:400}">${i<si?'✔ ':''}${s}</div>`).join('')}</div>
  <div class="card"><div class="g2">
   <div><div class="lbl">اسم المورد</div><input list="supList" value="${esc(d.supName)}" data-c="purHdr" data-f="supName"${ed?'':' disabled'}><datalist id="supList">${D.suppliers.map(s=>`<option value="${esc(s.name)}">`).join('')}</datalist></div>
   <div><div class="lbl">التاريخ</div><input type="date" value="${esc(d.date)}" data-c="purHdr" data-f="date"${ed?'':' disabled'}></div>
   <div><div class="lbl">القائم بالطلب / الاستلام (الموظف)</div><input list="empList" value="${esc(d.emp)}" data-c="purHdr" data-f="emp"${ed?'':' disabled'}><datalist id="empList">${D.employees.map(e=>`<option value="${esc(e.name)}">`).join('')}</datalist></div>
   <div><div class="lbl">فرع الاستلام (المخزن)</div><select data-c="purHdr" data-f="br"${ed?'':' disabled'}>${BR.map(b=>`<option${b===d.br?' selected':''}>${esc(b)}</option>`).join('')}</select></div></div></div>
  <div class="card">${ed?'<input id="puAdd" data-k="puAdd" data-i="puAddQ" placeholder="امسح الباركود أو اكتب اسم الصنف ثم Enter لإضافته" autocomplete="off"><div id="puRes"></div>':''}<div id="puLines"></div>
   <div class="ttl" style="text-align:center;margin-top:8px">إجمالي الطلب: <span id="puTot">0.00</span>${puHasRecv(d)?` — قيمة المستلم: ${money(puRecvVal(d))} — غير مفوتر: ${money(puUnbVal(d))}`:''}</div>
   <div class="row"><button data-a="purPrint">🖨 طباعة ${d.status==='rfq'||d.status==='sent'?'طلب عرض السعر':'أمر الشراء'}</button>
    ${ed&&d.lines.length?'<button data-a="puSend">📤 إرسال للمورد</button>':''}
    ${ed&&can('pur_confirm')?'<button class="p" data-a="puConfirmPO">✅ تأكيد أمر الشراء</button>':''}
    ${d.status==='sent'&&can('pur_edit')?'<button data-a="puBackRfq">رجوع لمسودة</button>':''}
    ${puOpenStatus(d)&&can('pur_receive')?'<button class="p" data-a="puRecvForm">📥 تأكيد استلام المنتجات</button>':''}
    ${d.status==='partial'&&can('pur_confirm')?'<button data-a="puCloseOrder">إغلاق الطلب بما تم استلامه</button>':''}
    ${puHasRecv(d)&&puUnbVal(d)>0&&can('acc_bill')?'<button class="p" data-a="billNew" data-id="'+d.id+'">🧾 إنشاء فاتورة المورد</button>':''}
    ${puHasRecv(d)&&can('pur_return')?'<button data-a="puRetForm">↩️ مرتجع للمورد</button>':''}
    ${(d.status==='rfq'||d.status==='sent'||d.status==='po')&&can('pur_cancel')?'<button class="d" data-a="purCancel">⛔ إلغاء الطلب</button>':''}
    ${ed&&!d.lines.length?'<button class="d" data-a="purDel">🗑 حذف المسودة</button>':''}</div></div>
  ${rcs.length?`<div class="card"><div class="ttl">الاستلامات</div>${tbl(['#','التاريخ','القيمة','بواسطة'],rcs.map(r=>`<tr><td>${r.id}</td><td>${esc(r.dt)}</td><td>${money(recTotal(r))}</td><td>${esc(r.user)}</td></tr>`).join(''))}</div>`:''}
  ${bls.length?`<div class="card"><div class="ttl">فواتير المورد</div>${tbl(['#','رقم فاتورة المورد','التاريخ','الاستحقاق','الطريقة','القيمة','الحالة'],bls.map(b=>`<tr class="clk" data-a="billOpen" data-id="${b.id}"><td>${b.id}</td><td>${esc(b.no)}</td><td>${esc(b.date)}</td><td>${esc(b.due)}</td><td>${esc(b.method)}</td><td><b>${money(b.total)}</b></td><td>${billBadge(b)}</td></tr>`).join(''))}</div>`:''}
  ${rts.length?`<div class="card"><div class="ttl">مرتجعات للمورد</div>${tbl(['#','التاريخ','القيمة','إشعار دائن'],rts.map(r=>`<tr class="clk" data-a="puRetView" data-id="${r.id}"><td>${r.id}</td><td>${esc(r.dt)}</td><td>${money(r.total)}</td><td>${money(r.cn||0)}</td></tr>`).join(''))}</div>`:''}`);
  puLines();if(ed)$('puAdd').focus();
};
C.purHdr=t=>{
  const d=PU.doc,f=t.dataset.f;d[f]=t.value;
  if(f==='supName'){const s=supByName(t.value);d.sup=s?s.id:null}
  save('purchases');
};
function unitOpts(p,sel){return prodUnits(p).map(u=>`<option value="${esc(u)}"${u===sel?' selected':''}>${esc(u||p.unit||'الوحدة الأساسية')}</option>`).join('')}
function puLines(){
  const d=PU.doc,ed=(d.status==='rfq'||d.status==='sent')&&can('pur_edit'),pe=can('price_edit')||can('pur_edit'),cyc=!['rfq','sent'].includes(d.status);
  $('puLines').innerHTML=d.lines.length?tbl(['الباركود','الاسم','الوحدة','الكمية','التكلفة','الإجمالي'].concat(cyc?['المستلم','المرتجع','المفوتر']:[],['سعر البيع','']),d.lines.map((l,i)=>{
    const p=PI.id[l.id],ui=p?unitInfo(p,l.u):{price:null},sp=p?(l.u?ui.price:pPrice(p)):'';
    return `<tr><td>${esc(l.b)}</td><td class="l">${esc(l.n)}</td><td>${ed&&p&&(p.uoms||[]).length?`<select data-c="puUnit" data-i2="${i}">${unitOpts(p,l.u||'')}</select>`:esc(l.u||(p?p.unit:''))}</td><td>${ed?`<input inputmode="decimal" value="${l.qty}" data-c="puLn" data-i2="${i}" data-f="qty">`:fmt(l.qty)}</td><td>${ed?`<input inputmode="decimal" value="${l.cost}" data-c="puLn" data-i2="${i}" data-f="cost">`:money(l.cost)}</td><td><b>${money(l.qty*l.cost)}</b></td>${cyc?`<td>${fmt(l.recv||0)}</td><td>${fmt(l.ret||0)}</td><td>${fmt(l.billed||0)}</td>`:''}<td>${p&&pe?`<input inputmode="decimal" value="${sp}" data-c="puPrice" data-id="${esc(l.id)}" data-u="${esc(l.u||'')}">`:(p?money(sp):'—')}</td><td>${ed?`<button class="d" data-a="puLnDel" data-i2="${i}">✕</button>`:''}</td></tr>`}).join('')):'<div class="mut" style="padding:8px">لا توجد بنود. أضف الأصناف من الخانة أعلاه.</div>';
  $('puTot').textContent=money(puTotal(d));
}
C.puUnit=t=>{
  const d=PU.doc,l=d.lines[+t.dataset.i2],p=PI.id[l.id],ui=unitInfo(p,t.value);
  l.u=ui.u;l.uf=ui.f;l.cost=r3(pCost(p)*ui.f);const x=(p.uoms||[]).find(y=>y.u===ui.u);l.b=(x&&x.bc)||p.bc;
  save('purchases');puLines();
};
C.puLn=t=>{
  const d=PU.doc,l=d.lines[+t.dataset.i2],v=num(t.value);
  if(!isNaN(v)&&v>=0)l[t.dataset.f]=v;save('purchases');puLines();
};
C.puPrice=t=>{
  const p=PI.id[t.dataset.id],v=num(t.value);
  if(!p||isNaN(v)||v<0){say('سعر غير صحيح',1);return}
  if(t.dataset.u){const x=(p.uoms||[]).find(y=>y.u===t.dataset.u);if(x)x.price=v}else p.price=v;
  save('products');say('تم تعديل سعر بيع «'+p.name+(t.dataset.u?'» ('+t.dataset.u+')':'»'));puLines();
};
A.puLnDel=t=>{PU.doc.lines.splice(+t.dataset.i2,1);save('purchases');puLines()};
function puAddProd(p,q,uname){
  const d=PU.doc,ui=unitInfo(p,uname),x=(p.uoms||[]).find(y=>y.u===uname);
  d.lines.push({id:p.id,b:(x&&x.bc)||p.bc,n:p.name,qty:q>0?q:1,cost:r3(pCost(p)*ui.f),u:ui.u,uf:ui.f,recv:0,ret:0,billed:0,cn:0});
  save('purchases');puLines();$('puAdd').value='';$('puRes').innerHTML='';$('puAdd').focus();
}
I.puAddQ=t=>{
  const q=norm(t.value);if(q.length<2){$('puRes').innerHTML='';return}
  $('puRes').innerHTML=search(q,12).map(p=>`<div class="row" style="padding:6px;border-bottom:1px solid var(--bd);cursor:pointer" data-a="puPick" data-id="${esc(p.id)}"><span style="flex:1">${esc(p.name)}</span><span class="mut">${esc(p.bc)}</span></div>`).join('');
};
A.puPick=t=>{const p=PI.id[t.dataset.id];if(p)puAddProd(p,0)};
K.puAdd=(t,e)=>{
  if(e.key!=='Enter')return;const v=norm(t.value);if(!v)return;
  let m=findU(v);if(!m.length)m=search(v,3).map(p=>({p,u:null}));
  if(m.length===1)puAddProd(m[0].p,m[0].u?0:scaleQty(v,m[0].p),m[0].u);else if(!m.length)say('الصنف غير موجود',1);
};
A.purDel=async()=>{
  if(!(await dlg('حذف هذه المسودة؟',{yes:'حذف'})))return;
  D.purchases.splice(D.purchases.indexOf(PU.doc),1);save('purchases');go('purchases');
};
/* الخطوة 1: إرسال طلب عرض السعر للمورد (طباعة أو واتس اب) */
A.puSend=()=>{
  const d=PU.doc;if(!d.lines.length||!norm(d.supName)){say('اكتب المورد وأضف البنود أولًا',1);return}
  openModal(`<div class="card"><div class="ttl">إرسال طلب عرض السعر للمورد</div><div class="row" style="flex-direction:column;align-items:stretch;gap:8px"><button class="p" data-a="puSendPrint">🖨 طباعة / حفظ PDF</button><button class="p" data-a="puWa">💬 واتس اب</button><button data-a="closeMd">إغلاق</button></div></div>`);
};
function puMarkSent(){const d=PU.doc;if(d.status==='rfq'){d.status='sent';save('purchases')}}
A.puSendPrint=()=>{closeModal();puMarkSent();A.purPrint();V.purEdit(PU.doc.id)};
A.puWa=()=>{
  const d=PU.doc,s=supById(d.sup);closeModal();puMarkSent();
  let ph=(s&&s.phone||'').replace(/\D/g,'');if(ph.startsWith('0'))ph='20'+ph.slice(1);
  const txt=`طلب عرض سعر رقم ${d.id}\nالمورد: ${d.supName}\nالتاريخ: ${d.date}\n`+d.lines.map((l,i)=>`${i+1}) ${l.n}${l.u?' ['+l.u+']':''} — الكمية: ${fmt(l.qty)}`).join('\n')+'\nبرجاء إرسال سعر التوريد وموعده.';
  const url='https://wa.me/'+ph+'?text='+encodeURIComponent(txt);
  if(api&&api.openUrl)api.openUrl(url);else window.open(url,'_blank');
  V.purEdit(d.id);
};
A.puBackRfq=()=>{PU.doc.status='rfq';save('purchases');V.purEdit(PU.doc.id)};
/* الخطوة 2: تأكيد أمر الشراء بعد موافقة المورد على السعر */
A.puConfirmPO=async()=>{
  const d=PU.doc;
  if(!norm(d.supName)){say('اكتب اسم المورد',1);return}
  if(!d.lines.length){say('لا توجد بنود',1);return}
  if(d.lines.some(l=>!(l.qty>0))){say('يوجد بند كميته صفر',1);return}
  if(!(await dlg(`تأكيد أمر الشراء من «${d.supName}» بقيمة ${money(puTotal(d))}؟\nلن تتغير الأسعار والكميات بعد التأكيد.`,{yes:'تأكيد أمر الشراء'})))return;
  let s=supByName(d.supName);
  if(!s){s={id:'S'+(nextNo('sup')),name:norm(d.supName),phone:'',addr:'',note:'',open:0};D.suppliers.push(s);save('suppliers')}
  d.sup=s.id;d.supName=s.name;d.status='po';d.poAt=nowStr();d.poBy=ME.name;
  save('purchases','cnt');await flush();savePurFile(d);say('تم تأكيد أمر الشراء — بانتظار توريد المورد');go('purEdit',d.id);
};
/* الخطوتان 3 و4: تأكيد استلام المنتجات وإضافتها للمخزون (استلام جزئي مسموح) */
A.puRecvForm=()=>{
  const d=PU.doc;
  if(!can('pur_receive')){say('ليس لديك صلاحية تأكيد الاستلام',1);return}
  const rows=d.lines.map((l,i)=>{const rm=lnRem(l);return rm<=0?'':`<tr><td class="l">${esc(l.n)}${l.u?' ['+esc(l.u)+']':''}</td><td>${fmt(l.qty)}</td><td>${fmt(l.recv||0)}</td><td>${fmt(rm)}</td><td><input inputmode="decimal" value="${rm}" data-q="${i}" data-av="${rm}"></td></tr>`}).join('');
  openModal(`<div class="card"><div class="ttl">تأكيد استلام — طلب #${d.id} (${esc(d.supName)})</div><div class="mut">اكتب الكميات التي وصلت فعليًا. ستُضاف للمخزون في «${esc(d.br)}» فور التأكيد.</div>${rows?tbl(['الصنف','المطلوب','المستلم سابقًا','المتبقي','المستلم الآن'],rows):'<div class="mut">تم استلام كل الكميات</div>'}
  <div class="row" style="margin-top:10px">${rows?'<button class="f p" data-a="puRecvOk">تأكيد الاستلام</button>':''}<button class="f" data-a="closeMd">إلغاء</button></div></div>`);
};
A.puRecvOk=async()=>{
  const d=PU.doc,q={};let any=false,bad=false;
  document.querySelectorAll('#mb input[data-q]').forEach(i=>{const v=num(i.value);if(isNaN(v)||v<0||v>+i.dataset.av+1e-9)bad=true;else if(v>0){q[+i.dataset.q]=v;any=true}});
  if(bad){say('الكمية المستلمة لا تتجاوز المتبقي من أمر الشراء',1);return}
  if(!any){say('اكتب كمية مستلمة',1);return}
  const rid=nextNo('rec'),lines=[],upd=D.set.updCostOnRecv!==false;
  Object.keys(q).forEach(i=>{
    const l=d.lines[i],uf=l.uf||1;lines.push({i:+i,id:l.id,n:l.n,b:l.b,qty:q[i],cost:l.cost,u:l.u||'',uf});
    l.recv=r3((l.recv||0)+q[i]);costIn(d.br,l.id,q[i]*uf,l.cost/uf,'receipt',{rec:rid,i:+i});
    const p=PI.id[l.id];if(p&&upd){p.cost=r3(l.cost/uf);save('products')}
  });
  const now=new Date(),r={id:rid,pur:d.id,sup:d.sup,supName:d.supName,br:d.br,date:dayStr(now),dt:nowStr(now),ts:now.getTime(),user:ME.name,lines};
  D.recs.push(r);d.status=d.lines.every(l=>(l.recv||0)>=l.qty-1e-9)?'received':'partial';
  save('purchases','recs','stock','layers','cnt');closeModal();await flush();
  saveRecFile(r);savePurFile(d);say(d.status==='received'?'تم استلام كل المنتجات وإضافتها للمخزون':'تم تسجيل استلام جزئي وإضافته للمخزون');go('purEdit',d.id);
};
A.puCloseOrder=async()=>{
  if(!(await dlg('إغلاق الطلب بما تم استلامه؟ لن يمكن استلام المتبقي بعد ذلك.',{yes:'إغلاق'})))return;
  PU.doc.status='received';save('purchases');go('purEdit',PU.doc.id);
};
A.purCancel=async()=>{
  const d=PU.doc;
  if(puHasRecv(d)){say('لا يمكن إلغاء طلب تم استلام منه — استخدم مرتجع المورد',1);return}
  if(!(await dlg('إلغاء هذا الطلب؟',{yes:'إلغاء الطلب',no:'رجوع'})))return;
  d.status='cancelled';save('purchases');await flush();savePurFile(d);go('purEdit',d.id);
};

/* ===== مرتجعات الموردين (على الكميات المستلمة فقط) ===== */
const avgBillCost=(d,i)=>{let q=0,v=0;D.bills.forEach(b=>{if(b.pur!==d.id)return;b.lines.forEach(x=>{if(x.i===i){q+=x.qty;v+=x.qty*x.cost}})});return q?v/q:d.lines[i].cost};
A.puRetForm=()=>{
  const d=PU.doc;
  if(!can('pur_return')){say('ليس لديك صلاحية مرتجعات الموردين',1);return}
  if(!puHasRecv(d)){say('لا توجد كميات مستلمة لإرجاعها',1);return}
  const rows=d.lines.map((l,i)=>{const av=r3((l.recv||0)-(l.ret||0));return av<=0?'':`<tr><td class="l">${esc(l.n)}${l.u?' ['+esc(l.u)+']':''}</td><td>${fmt(l.recv||0)}</td><td>${fmt(l.ret||0)}</td><td>${fmt(av)}</td><td><input inputmode="decimal" value="0" data-q="${i}" data-av="${av}"></td></tr>`}).join('');
  openModal(`<div class="card"><div class="ttl">مرتجع للمورد — طلب #${d.id} (${esc(d.supName)})</div>${rows?tbl(['الصنف','المستلم','سبق إرجاعه','المتاح للإرجاع','كمية المرتجع'],rows):'<div class="mut">تم إرجاع كل الكميات المستلمة</div>'}
  <div class="row" style="margin-top:10px">${rows?'<button class="f" data-a="puRetAll">إرجاع الكل</button><button class="f p" data-a="puRetOk">تأكيد المرتجع</button>':''}<button class="f" data-a="closeMd">إغلاق</button></div></div>`);
};
A.puRetAll=()=>{document.querySelectorAll('#mb input[data-q]').forEach(i=>{i.value=i.dataset.av})};
A.puRetOk=async()=>{
  const d=PU.doc,q={};let any=false,bad=false;
  document.querySelectorAll('#mb input[data-q]').forEach(i=>{const v=num(i.value);if(isNaN(v)||v<0||v>+i.dataset.av+1e-9)bad=true;else if(v>0){q[+i.dataset.q]=v;any=true}});
  if(bad){say('كمية المرتجع لا يمكن أن تتجاوز الكمية المستلمة المتبقية',1);return}
  if(!any){say('اكتب كمية للإرجاع',1);return}
  const lines=Object.keys(q).map(i=>{const l=d.lines[i];return{i:+i,id:l.id,n:l.n,b:l.b,qty:q[i],cost:l.cost,u:l.u||'',uf:l.uf||1}});
  const short=lines.filter(l=>stk(d.br,l.id)<l.qty*l.uf);
  if(short.length&&!(await dlg('رصيد «'+short[0].n+'» في «'+d.br+'» أقل من الكمية المرتجعة. المتابعة ستجعل الرصيد بالسالب. هل تريد المتابعة؟',{yes:'متابعة'})))return;
  let cn=0;
  lines.forEach(x=>{
    const l=d.lines[x.i];l.ret=r3((l.ret||0)+x.qty);
    const need=Math.max(0,r3(((l.billed||0)-(l.cn||0))-((l.recv||0)-l.ret)));       // كمية سبقت فوترتها ويلزم لها إشعار دائن
    if(need>0){cn+=need*avgBillCost(d,x.i);l.cn=r3((l.cn||0)+need)}
    costOut(d.br,l.id,x.qty*x.uf);
  });
  const now=new Date(),r={id:nextNo('pret'),pur:d.id,sup:d.sup,supName:d.supName,br:d.br,date:dayStr(now),dt:nowStr(now),ts:now.getTime(),user:ME.name,
    lines:lines.map(l=>({id:l.id,n:l.n,b:l.b,qty:l.qty,cost:l.cost,u:l.u,uf:l.uf})),total:r2(lines.reduce((s,l)=>s+l.qty*l.cost,0)),cn:r2(cn)};
  D.pret.push(r);save('pret','purchases','stock','layers','cnt');await flush();closeModal();
  savePretFile(r);saveSupStmt(d.sup);say('تم تسجيل مرتجع المورد رقم '+r.id+(r.cn?'':' (لم تُفوتر الكمية بعد، فلا إشعار دائن)'));go('purEdit',d.id);
};
function savePretFile(r){
  const rows=[['مرتجع مورد رقم',r.id],['المورد',r.supName],['عن طلب شراء',r.pur],['الفرع',r.br],['التاريخ',r.dt],['بواسطة',r.user],[],['الباركود','الصنف','الوحدة','الكمية المرتجعة','التكلفة','الإجمالي']]
    .concat(r.lines.map(l=>[String(l.b),l.n,l.u,l.qty,l.cost,r2(l.qty*l.cost)]),[[],['','','','','إجمالي المرتجع',r.total],['','','','','إشعار دائن على حساب المورد',r.cn||0]]);
  return saveX(`المشتريات/${r.br}/${r.date}`,`مرتجع مورد ${r.id} - ${r.supName} - ${r.date}.xlsx`,wbOf([['المرتجع',rows]]));
}
function purRetList(){
  setMain(`<div class="ttl">المشتريات</div>${tabs(PU.tab,PTABS,'puTab')}<div class="card" id="puL"></div>`);
  const l=D.pret.slice().sort((a,b)=>b.id-a.id).slice(0,200);
  $('puL').innerHTML=l.length?tbl(['#','المورد','عن طلب','التاريخ','الفرع','قيمة المرتجع','إشعار دائن','بواسطة'],l.map(r=>`<tr class="clk" data-a="puRetView" data-id="${r.id}"><td>${r.id}</td><td class="l">${esc(r.supName)}</td><td>${r.pur}</td><td>${esc(r.dt)}</td><td>${esc(r.br)}</td><td><b>${money(r.total)}</b></td><td>${money(r.cn||0)}</td><td>${esc(r.user)}</td></tr>`).join('')):'<div class="mut">لا توجد مرتجعات للموردين. تُنشأ من داخل أمر شراء تم استلامه (زر «مرتجع للمورد»).</div>';
}
A.puRetView=t=>{
  const r=D.pret.find(x=>x.id===+t.dataset.id);if(!r)return;
  openModal(`<div class="card"><div class="ttl">مرتجع مورد #${r.id}</div><div class="mut">${esc(r.supName)} — عن طلب ${r.pur} — ${esc(r.dt)}</div>${tbl(['الصنف','الوحدة','الكمية','التكلفة','الإجمالي'],r.lines.map(l=>`<tr><td class="l">${esc(l.n)}</td><td>${esc(l.u)}</td><td>${fmt(l.qty)}</td><td>${money(l.cost)}</td><td>${money(l.qty*l.cost)}</td></tr>`).join(''))}<div style="font-size:18px;font-weight:700;text-align:center;margin:8px 0">الإجمالي: ${money(r.total)} — إشعار دائن: ${money(r.cn||0)}</div>
  <div class="row"><button class="f p" data-a="puRetPrint" data-id="${r.id}">🖨 طباعة</button><button class="f" data-a="closeMd">إغلاق</button></div></div>`);
};
A.puRetPrint=t=>{
  const r=D.pret.find(x=>x.id===+t.dataset.id);
  printHtml(`<img class="pl" src="${logoSrc()}" alt=""><h2>مرتجع مشتريات رقم ${r.id}</h2><div class="mt"><span>المورد: <b>${esc(r.supName)}</b></span><span>التاريخ: <b>${esc(r.dt)}</b></span></div><div class="mt"><span>عن طلب رقم: ${r.pur}</span><span>الفرع: ${esc(r.br)}</span></div>
  <table><thead><tr><th>م</th><th>الصنف</th><th>الكمية</th><th>تكلفة الوحدة</th><th>الإجمالي</th></tr></thead><tbody>${r.lines.map((l,i)=>`<tr><td>${i+1}</td><td style="text-align:right">${esc(l.n)}${l.u?' ['+esc(l.u)+']':''}</td><td>${fmt(l.qty)}</td><td>${money(l.cost)}</td><td>${money(l.qty*l.cost)}</td></tr>`).join('')}</tbody></table><div class="gt2">إجمالي المرتجع: ${money(r.total)}</div>`,'a4');
};

/* طباعة طلب عرض السعر / أمر الشراء (A4) */
A.purPrint=()=>{
  const d=PU.doc;if(!d.lines.length){say('لا توجد بنود للطباعة',1);return}
  const rfq=d.status==='rfq'||d.status==='sent',cyc=!rfq;
  const rows=d.lines.map((l,i)=>`<tr><td>${i+1}</td><td style="text-align:right">${esc(l.n)}${l.u?' ['+esc(l.u)+']':''}</td><td>${fmt(l.qty)}</td>${cyc?`<td>${fmt(l.recv||0)}</td>`:''}<td>${rfq?'':money(l.cost)}</td><td>${rfq?'':money(l.qty*l.cost)}</td></tr>`).join('');
  printHtml(`<img class="pl" src="${logoSrc()}" alt=""><h2>${rfq?'طلب عرض سعر':'أمر شراء'} رقم ${d.id}</h2>
  <div class="mt"><span>اسم المورد: <b>${esc(d.supName)}</b></span><span>التاريخ: <b>${esc(d.date)}</b></span></div>
  <div class="mt"><span>الفرع: ${esc(d.br)}</span><span>القائم بالطلب: ${esc(d.emp)}</span><span>الحالة: ${ST[d.status][0]}</span></div>
  <table><thead><tr><th>م</th><th>الصنف</th><th>الكمية</th>${cyc?'<th>المستلم</th>':''}<th>${rfq?'السعر المعروض':'تكلفة الوحدة'}</th><th>${rfq?'الإجمالي':'إجمالي الصنف'}</th></tr></thead><tbody>${rows}</tbody></table>
  ${rfq?'<div class="mt" style="margin-top:14px"><span>برجاء تعبئة الأسعار وموعد التوريد وإعادتها.</span></div>':`<div class="gt2">إجمالي الطلب: ${money(puTotal(d))}</div>`}`,'a4');
};

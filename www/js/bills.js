/* ===== الفوترة (الخطوة 5 — المحاسبة) + حسابات الموردين ===== */
const IMM=['نقدي','تحويل بنكي'];                    // طرق تُسدَّد فورًا عند الفوترة
const PAYM=['نقدي','تحويل بنكي','شيك','آجل'];
const billPaid=b=>r2(D.payments.filter(p=>p.bill===b.id).reduce((a,p)=>a+p.amount,0));
const billRest=b=>r2(b.total-billPaid(b));
function billBadge(b){
  const rest=billRest(b);
  if(rest<=0.005)return '<span class="badge b-done">مسددة</span>';
  if(b.due&&b.due<dayStr())return '<span class="badge b-cancel">متأخرة</span>';
  return billPaid(b)>0?'<span class="badge b-draft">مسددة جزئيًا</span>':'<span class="badge b-draft">مستحقة</span>';
}
const supBilled=id=>r2(D.bills.filter(x=>x.sup===id).reduce((a,x)=>a+x.total,0));
const supCN=id=>r2(D.pret.filter(x=>x.sup===id).reduce((a,x)=>a+(x.cn||0),0));
const supPaid=id=>r2(D.payments.filter(x=>x.sup===id).reduce((a,x)=>a+x.amount,0));
function supBalance(id){const s=supById(id);return s?r2((s.open||0)+supBilled(id)-supCN(id)-supPaid(id)):0}
const supUnbilled=id=>r2(D.purchases.filter(d=>d.sup===id&&d.status!=='cancelled').reduce((a,d)=>a+puUnbVal(d),0));

/* --- قائمة الفواتير وما ينتظر الفوترة --- */
function purBillList(){
  const wait=D.purchases.filter(d=>puHasRecv(d)&&puUnbVal(d)>0.005&&d.status!=='cancelled').sort((a,b)=>b.id-a.id);
  const bl=D.bills.slice().sort((a,b)=>b.id-a.id).slice(0,300);
  setMain(`<div class="ttl">المشتريات</div>${tabs(PU.tab,PTABS,'puTab')}
  <div class="card"><div class="ttl" style="font-size:17px">مستلمة وبانتظار الفوترة</div>${wait.length?tbl(['طلب #','المورد','المستلم (صافي)','غير مفوتر',''],wait.map(d=>`<tr><td>${d.id}</td><td class="l">${esc(d.supName)}</td><td>${money(puRecvVal(d))}</td><td><b>${money(puUnbVal(d))}</b></td><td>${can('acc_bill')?`<button class="p" data-a="billNew" data-id="${d.id}">🧾 إنشاء فاتورة</button>`:'<span class="mut">للمحاسب</span>'}</td></tr>`).join('')):'<div class="mut">لا توجد مستلمات بانتظار الفوترة</div>'}</div>
  <div class="card"><div class="ttl" style="font-size:17px">فواتير الموردين</div>${bl.length?tbl(['#','المورد','رقم فاتورة المورد','التاريخ','الاستحقاق','الطريقة','القيمة','المسدد','المتبقي','الحالة'],bl.map(b=>`<tr class="clk" data-a="billOpen" data-id="${b.id}"><td>${b.id}</td><td class="l">${esc(b.supName)}</td><td>${esc(b.no)}</td><td>${esc(b.date)}</td><td>${esc(b.due)}</td><td>${esc(b.method)}</td><td><b>${money(b.total)}</b></td><td>${money(billPaid(b))}</td><td>${money(billRest(b))}</td><td>${billBadge(b)}</td></tr>`).join('')):'<div class="mut">لا توجد فواتير موردين</div>'}</div>`);
}
A.billOpen=t=>go('billView',+t.dataset.id);
A.billNew=t=>{
  if(!can('acc_bill')){say('الفوترة من صلاحيات المحاسبة',1);return}
  go('billForm',+t.dataset.id);
};

/* --- نموذج إنشاء فاتورة المورد --- */
const BF={d:null,rows:[],due:'',method:'آجل',date:dayStr(),no:'',note:''};
V.billForm=id=>{
  if(!can('acc_bill')){say('الفوترة من صلاحيات المحاسبة',1);return go('home')}
  const d=D.purchases.find(x=>x.id===id);if(!d){go('purchases');return}
  BF.d=d;BF.rows=d.lines.map((l,i)=>({i,qty:lnUnb(l),cost:l.cost})).filter(x=>x.qty>0);BF.method='آجل';BF.date=dayStr();BF.due=addDays(BF.date,30);BF.no='';BF.note='';
  if(!BF.rows.length){say('لا توجد كميات مستلمة غير مفوترة',1);return go('purEdit',id)}
  setMain(`<div class="row"><button data-a="go" data-v="purchases">‹ المشتريات</button><div class="ttl" style="margin:0;flex:1">فاتورة مورد — عن طلب #${d.id} (${esc(d.supName)})</div></div>
  <div class="card"><div class="g2"><div><div class="lbl">رقم فاتورة المورد</div><input data-c="bfH" data-f="no"></div><div><div class="lbl">تاريخ الفاتورة</div><input type="date" value="${BF.date}" data-c="bfH" data-f="date"></div>
   <div><div class="lbl">طريقة السداد</div><select data-c="bfH" data-f="method">${PAYM.map(m=>`<option${m===BF.method?' selected':''}>${m}</option>`).join('')}</select></div>
   <div><div class="lbl">موعد السداد (الاستحقاق)</div><input type="date" id="bfDue" value="${BF.due}" data-c="bfH" data-f="due"></div></div><div class="lbl">ملاحظات</div><input data-c="bfH" data-f="note"></div>
  <div class="card"><div id="bfL"></div><div class="ttl" style="text-align:center;margin-top:8px">إجمالي الفاتورة: <span id="bfT">0.00</span></div>
   <div class="mut" id="bfInfo"></div><div class="row" style="margin-top:8px"><button class="p" data-a="billSave">💾 حفظ الفاتورة</button><button data-a="go" data-v="purchases">إلغاء</button></div></div>`);
  bfLines();
};
const bfTotal=()=>r2(BF.rows.reduce((s,x)=>s+x.qty*x.cost,0));
function bfLines(){
  const d=BF.d,ce=can('acc_bill_edit');
  $('bfL').innerHTML=tbl(['الصنف','الوحدة','غير مفوتر','كمية الفاتورة','سعر الطلب','سعر الفاتورة','الإجمالي'],BF.rows.map((x,n)=>{const l=d.lines[x.i];
    return `<tr><td class="l">${esc(l.n)}</td><td>${esc(l.u||'')}</td><td>${fmt(lnUnb(l))}</td><td><input inputmode="decimal" value="${x.qty}" data-c="bfL" data-n="${n}" data-f="qty"></td><td>${money(l.cost)}</td><td><input inputmode="decimal" value="${x.cost}" data-c="bfL" data-n="${n}" data-f="cost"${ce?'':' disabled'}></td><td><b>${money(x.qty*x.cost)}</b></td></tr>`}).join(''));
  $('bfT').textContent=money(bfTotal());
  const diff=BF.rows.filter(x=>Math.abs(x.cost-d.lines[x.i].cost)>0.0005).length;
  $('bfInfo').textContent=(ce?'':'تعديل سعر الفاتورة يحتاج صلاحية «تعديل أسعار الفاتورة». ')+(diff?`يوجد ${diff} صنف سعره يختلف عن أمر الشراء — سيُعدَّل به تكلفة المتبقي بالمخزون.`:'');
}
C.bfH=t=>{
  BF[t.dataset.f]=t.value;
  if(t.dataset.f==='method'||t.dataset.f==='date'){BF.due=IMM.includes(BF.method)?BF.date:addDays(BF.date,30);const e=$('bfDue');if(e)e.value=BF.due}
};
C.bfL=t=>{
  const x=BF.rows[+t.dataset.n],v=num(t.value);if(isNaN(v)||v<0){say('قيمة غير صحيحة',1);bfLines();return}
  if(t.dataset.f==='qty'){const mx=lnUnb(BF.d.lines[x.i]);if(v>mx+1e-9){say('كمية الفاتورة لا تتجاوز غير المفوتر ('+fmt(mx)+')',1);bfLines();return}x.qty=v}
  else if(can('acc_bill_edit'))x.cost=v;
  bfLines();
};
A.billSave=async()=>{
  const d=BF.d,rows=BF.rows.filter(x=>x.qty>0);
  if(!rows.length){say('اكتب كمية للفوترة',1);return}
  if(!BF.date){say('اختر تاريخ الفاتورة',1);return}
  if(!IMM.includes(BF.method)&&!BF.due){say('حدد موعد السداد',1);return}
  const id=nextNo('bill'),now=new Date();
  const lines=rows.map(x=>{const l=d.lines[x.i];return{i:x.i,id:l.id,n:l.n,b:l.b,qty:x.qty,cost:x.cost,pcost:l.cost,u:l.u||'',uf:l.uf||1}});
  lines.forEach(x=>{
    const l=d.lines[x.i];l.billed=r3((l.billed||0)+x.qty);
    if(Math.abs(x.cost-l.cost)>0.0005){
      D.recs.forEach(r=>{if(r.pur===d.id&&r.lines.some(y=>y.i===x.i))adjustLayers(d.br,l.id,r.id,x.i,l.cost/x.uf,x.cost/x.uf)});
      const p=PI.id[l.id];if(p&&D.set.updCostOnRecv!==false){p.cost=r3(x.cost/x.uf);save('products')}
    }
  });
  const total=r2(lines.reduce((s,x)=>s+x.qty*x.cost,0));
  const b={id,pur:d.id,sup:d.sup,supName:d.supName,date:BF.date,no:norm(BF.no),due:IMM.includes(BF.method)?BF.date:BF.due,method:BF.method,lines,total,note:norm(BF.note),user:ME.name,dt:nowStr(now),ts:now.getTime()};
  D.bills.push(b);
  if(IMM.includes(BF.method))D.payments.push({id:nextNo('pay'),sup:d.sup,amount:total,method:BF.method,note:'سداد عند الفوترة — فاتورة '+id,user:ME.name,dt:nowStr(now),day:dayStr(now),ts:now.getTime(),bill:id});
  save('bills','purchases','payments','layers','cnt');await flush();
  saveBillFile(b);saveSupStmt(d.sup);say('تم تسجيل فاتورة المورد رقم '+id+(IMM.includes(BF.method)?' وسداد قيمتها':''));go('billView',id);
};
function saveBillFile(b){
  const rows=[['فاتورة مورد رقم',b.id],['المورد',b.supName],['رقم فاتورة المورد',b.no],['عن طلب شراء',b.pur],['التاريخ',b.date],['الاستحقاق',b.due],['طريقة السداد',b.method],['بواسطة',b.user],[],['الباركود','الصنف','الوحدة','الكمية','سعر أمر الشراء','سعر الفاتورة','الإجمالي']]
    .concat(b.lines.map(l=>[String(l.b),l.n,l.u,l.qty,l.pcost,l.cost,r2(l.qty*l.cost)]),[[],['','','','','','إجمالي الفاتورة',b.total],['','','','','','المسدد',billPaid(b)],['','','','','','المتبقي',billRest(b)]]);
  const d=D.purchases.find(x=>x.id===b.pur);
  return saveX(`المشتريات/${d?d.br:'—'}/${b.date}`,`فاتورة مورد ${b.id} - ${b.supName} - ${b.date}.xlsx`,wbOf([['الفاتورة',rows]]));
}
V.billView=id=>{
  const b=D.bills.find(x=>x.id===id);if(!b){go('purchases');return}
  const pays=D.payments.filter(p=>p.bill===id).sort((x,y)=>x.ts-y.ts);
  setMain(`<div class="row"><button data-a="go" data-v="purchases">‹ المشتريات</button><div class="ttl" style="margin:0;flex:1">فاتورة مورد #${b.id} ${billBadge(b)}</div><button data-a="purOpen" data-id="${b.pur}">طلب الشراء #${b.pur}</button></div>
  <div class="card"><div class="g2"><div><div class="mut">المورد</div><b>${esc(b.supName)}</b></div><div><div class="mut">رقم فاتورة المورد</div><b>${esc(b.no)||'—'}</b></div><div><div class="mut">التاريخ / الاستحقاق</div><b>${esc(b.date)} / ${esc(b.due)}</b></div><div><div class="mut">طريقة السداد</div><b>${esc(b.method)}</b></div></div></div>
  <div class="card">${tbl(['الصنف','الوحدة','الكمية','سعر أمر الشراء','سعر الفاتورة','الإجمالي'],b.lines.map(l=>`<tr><td class="l">${esc(l.n)}</td><td>${esc(l.u)}</td><td>${fmt(l.qty)}</td><td>${money(l.pcost)}</td><td>${money(l.cost)}</td><td>${money(l.qty*l.cost)}</td></tr>`).join(''))}
   <div class="g2" style="margin-top:8px"><div class="card" style="margin:0"><div class="mut">إجمالي الفاتورة</div><div class="ttl">${money(b.total)}</div></div><div class="card" style="margin:0"><div class="mut">المسدد</div><div class="ttl" style="color:var(--ok)">${money(billPaid(b))}</div></div><div class="card" style="margin:0"><div class="mut">المتبقي</div><div class="ttl" style="color:var(--wr)">${money(billRest(b))}</div></div></div>
   <div class="row" style="margin-top:8px"><button data-a="billPrint" data-id="${b.id}">🖨 طباعة</button>${billRest(b)>0.005&&can('acc_pay')?`<button class="p" data-a="billPay" data-id="${b.id}">💵 تسجيل دفعة</button>`:''}</div></div>
  <div class="card"><div class="ttl">الدفعات</div>${pays.length?tbl(['التاريخ','المبلغ','الطريقة','ملاحظة','بواسطة'],pays.map(p=>`<tr><td>${esc(p.dt)}</td><td><b>${money(p.amount)}</b></td><td>${esc(p.method)}</td><td class="l">${esc(p.note)}</td><td>${esc(p.user)}</td></tr>`).join('')):'<div class="mut">لا توجد دفعات</div>'}</div>`);
};
A.billPrint=t=>{
  const b=D.bills.find(x=>x.id===+t.dataset.id);
  printHtml(`<img class="pl" src="${logoSrc()}" alt=""><h2>فاتورة مورد رقم ${b.id}</h2><div class="mt"><span>المورد: <b>${esc(b.supName)}</b></span><span>رقم فاتورة المورد: ${esc(b.no)||'—'}</span><span>التاريخ: ${esc(b.date)}</span></div><div class="mt"><span>الاستحقاق: ${esc(b.due)}</span><span>طريقة السداد: ${esc(b.method)}</span><span>عن طلب: ${b.pur}</span></div>
  <table><thead><tr><th>م</th><th>الصنف</th><th>الكمية</th><th>سعر الوحدة</th><th>الإجمالي</th></tr></thead><tbody>${b.lines.map((l,i)=>`<tr><td>${i+1}</td><td style="text-align:right">${esc(l.n)}${l.u?' ['+esc(l.u)+']':''}</td><td>${fmt(l.qty)}</td><td>${money(l.cost)}</td><td>${money(l.qty*l.cost)}</td></tr>`).join('')}</tbody></table>
  <div class="gt2">الإجمالي: ${money(b.total)} — المسدد: ${money(billPaid(b))} — المتبقي: ${money(billRest(b))}</div>`,'a4');
};
A.billPay=async t=>{
  const b=D.bills.find(x=>x.id===+t.dataset.id);
  if(!can('acc_pay')){say('ليس لديك صلاحية تسجيل الدفعات',1);return}
  const r=await formDlg('تسجيل دفعة على الفاتورة #'+b.id,[{k:'a',l:'المبلغ (المتبقي '+money(billRest(b))+')',t:'number',v:billRest(b)},{k:'m',l:'طريقة الدفع',t:'select',o:['نقدي','تحويل بنكي','شيك','فودافون كاش','أخرى']},{k:'n',l:'ملاحظة',t:'text'}],'تسجيل الدفعة');
  if(!r)return;const a=num(r.a);
  if(isNaN(a)||a<=0||a>billRest(b)+0.005){say('المبلغ يجب ألا يتجاوز المتبقي من الفاتورة',1);return}
  const d=new Date();D.payments.push({id:nextNo('pay'),sup:b.sup,amount:a,method:r.m,note:norm(r.n),user:ME.name,dt:nowStr(d),day:dayStr(d),ts:d.getTime(),bill:b.id});
  save('payments','cnt');saveSupStmt(b.sup);say('تم تسجيل الدفعة');go('billView',b.id);
};

/* ===== الموردين (الحسابات) ===== */
V.suppliers=()=>{
  if(!can('acc_suppliers')){say('ليس لديك صلاحية الموردين',1);return go('home')}
  setMain(`<div class="row"><div class="ttl" style="flex:1;margin:0">الموردين</div>${can('acc_edit')?'<button class="p" data-a="supNew">➕ مورد جديد</button>':''}</div>
  <div class="card"><input id="sF" data-i="supFlt" placeholder="بحث باسم المورد" style="max-width:320px"></div><div class="card" id="sL"></div>`);
  supList();
};
I.supFlt=()=>supList();
function supList(){
  const q=nm($('sF').value);
  const l=D.suppliers.filter(s=>!q||nm(s.name).includes(q)).slice(0,300);
  $('sL').innerHTML=tbl(['المورد','الهاتف','الرصيد المستحق','مستلم غير مفوتر','الحالة'],l.map(s=>{const b=supBalance(s.id);
    return `<tr class="clk" data-a="supOpen" data-id="${s.id}"><td class="l">${esc(s.name)}</td><td>${esc(s.phone)}</td><td><b>${money(Math.abs(b))}</b></td><td>${money(supUnbilled(s.id))}</td><td>${b>0?'<span class="badge b-draft">مستحق للمورد</span>':b<0?'<span class="badge b-done">مستحق لنا</span>':'—'}</td></tr>`}).join(''))||'';
}
A.supOpen=t=>go('supEdit',t.dataset.id);
A.supNew=async()=>{
  const r=await formDlg('مورد جديد',[{k:'name',l:'اسم المورد'},{k:'phone',l:'الهاتف'}],'إضافة');if(!r)return;
  if(!norm(r.name)){say('اكتب الاسم',1);return}
  if(supByName(r.name)){say('المورد موجود بالفعل',1);return}
  const s={id:'S'+(nextNo('sup')),name:norm(r.name),phone:norm(r.phone),addr:'',note:'',open:0};D.suppliers.push(s);save('suppliers','cnt');go('supEdit',s.id);
};
V.supEdit=id=>{
  const s=supById(id);if(!s){go('suppliers');return}
  const b=supBalance(id),ce=can('acc_edit');
  const bills=D.bills.filter(x=>x.sup===id).sort((a,c)=>c.id-a.id),pay=D.payments.filter(x=>x.sup===id).sort((a,c)=>c.ts-a.ts);
  const pos=D.purchases.filter(d=>d.sup===id).sort((a,c)=>c.id-a.id);
  setMain(`<div class="row"><button data-a="go" data-v="suppliers">‹ الموردين</button><div class="ttl" style="margin:0;flex:1">${esc(s.name)}</div></div>
  <div class="card"><div class="g2"><div><div class="lbl">الاسم</div><input id="se_name" value="${esc(s.name)}"${ce?'':' disabled'}></div><div><div class="lbl">الهاتف</div><input id="se_phone" value="${esc(s.phone)}"${ce?'':' disabled'}></div><div><div class="lbl">العنوان</div><input id="se_addr" value="${esc(s.addr)}"${ce?'':' disabled'}></div><div><div class="lbl">رصيد افتتاحي (موجب = مستحق للمورد)</div><input id="se_open" inputmode="decimal" value="${s.open||0}"${ce?'':' disabled'}></div></div>
  <div class="lbl">ملاحظات</div><textarea id="se_note" rows="2"${ce?'':' disabled'}>${esc(s.note)}</textarea>
  ${ce?`<div class="row" style="margin-top:8px"><button class="p" data-a="supSave" data-id="${id}">💾 حفظ البيانات</button></div>`:''}</div>
  <div class="g2"><div class="card"><div class="mut">إجمالي الفواتير</div><div class="ttl">${money(supBilled(id))}</div></div><div class="card"><div class="mut">إجمالي الدفعات</div><div class="ttl">${money(supPaid(id))}</div></div><div class="card"><div class="mut">إشعارات دائنة (مرتجعات)</div><div class="ttl">${money(supCN(id))}</div></div>
  <div class="card"><div class="mut">الرصيد الحالي</div><div class="ttl" style="color:${b>0?'var(--wr)':'var(--ok)'}">${money(Math.abs(b))} ${b>0?'مستحق للمورد':b<0?'مستحق لنا':''}</div></div><div class="card"><div class="mut">مستلم غير مفوتر</div><div class="ttl">${money(supUnbilled(id))}</div></div></div>
  <div class="card"><div class="row"><div class="ttl" style="flex:1;margin:0">الدفعات</div>${can('acc_pay')?`<button class="p" data-a="supPay" data-id="${id}">➕ تسجيل دفعة</button>`:''}</div>${pay.length?tbl(['تاريخ التسديد','المبلغ','طريقة الدفع','الفاتورة','ملاحظة','بواسطة'],pay.map(x=>`<tr><td>${esc(x.dt)}</td><td><b>${money(x.amount)}</b></td><td>${esc(x.method)}</td><td>${x.bill?'#'+x.bill:'دفعة عامة'}</td><td class="l">${esc(x.note)}</td><td>${esc(x.user)}</td></tr>`).join('')):'<div class="mut">لا توجد دفعات</div>'}</div>
  <div class="card"><div class="ttl">فواتير المورد</div>${bills.length?tbl(['#','رقم فاتورة المورد','التاريخ','الاستحقاق','الطريقة','القيمة','المتبقي','الحالة','المحتويات'],bills.map(x=>`<tr><td><a data-a="billOpen" data-id="${x.id}" style="cursor:pointer;color:var(--pri2)">${x.id}</a></td><td>${esc(x.no)}</td><td>${esc(x.date)}</td><td>${esc(x.due)}</td><td>${esc(x.method)}</td><td><b>${money(x.total)}</b></td><td>${money(billRest(x))}</td><td>${billBadge(x)}</td><td><details><summary>عرض (${x.lines.length})</summary>${tbl(['الصنف','الكمية','السعر','الإجمالي'],x.lines.map(l=>`<tr><td class="l">${esc(l.n)}</td><td>${fmt(l.qty)}</td><td>${money(l.cost)}</td><td>${money(l.qty*l.cost)}</td></tr>`).join(''))}</details></td></tr>`).join('')):'<div class="mut">لا توجد فواتير</div>'}</div>
  <div class="card"><div class="ttl">طلبات الشراء</div>${pos.length?tbl(['#','التاريخ','الفرع','القيمة','الحالة','الفوترة',''],pos.map(d=>`<tr><td>${d.id}</td><td>${esc(d.date)}</td><td>${esc(d.br)}</td><td>${money(puTotal(d))}</td><td><span class="badge ${ST[d.status][1]}">${ST[d.status][0]}</span></td><td>${puBillBadge(d)}</td><td><button data-a="purOpen" data-id="${d.id}">فتح</button></td></tr>`).join('')):'<div class="mut">لا توجد طلبات</div>'}</div>
  <div class="card"><div class="ttl">كشف حساب المورد</div>${supLedgerHtml(id)}</div>`);
};
/* كشف حساب المورد: فواتير + إشعارات دائنة + دفعات (بتواريخها وطرق الدفع) مع الرصيد الجاري */
function supLedgerHtml(id){
  const s=supById(id),rows=[];
  D.bills.forEach(b=>{if(b.sup===id)rows.push({ts:b.ts||0,dt:b.dt||b.date,type:'فاتورة مورد #'+b.id,det:(b.no?'رقم '+b.no+' — ':'')+b.lines.length+' صنف — استحقاق '+b.due,debit:b.total,credit:0,method:b.method})});
  D.pret.forEach(x=>{if(x.sup===id&&x.cn>0)rows.push({ts:x.ts,dt:x.dt,type:'إشعار دائن — مرتجع #'+x.id,det:`${x.lines.length} صنف — عن طلب ${x.pur}`,debit:0,credit:x.cn,method:'—'})});
  D.payments.forEach(p=>{if(p.sup===id)rows.push({ts:p.ts,dt:p.dt,type:'دفعة للمورد',det:(p.bill?'على فاتورة #'+p.bill+' — ':'')+(p.note||''),debit:0,credit:p.amount,method:p.method})});
  rows.sort((a,b)=>a.ts-b.ts);let run=s.open||0;
  const body=(s.open?`<tr><td>—</td><td>رصيد افتتاحي</td><td></td><td></td><td></td><td></td><td><b>${money(run)}</b></td></tr>`:'')+rows.map(r=>{run=r2(run+r.debit-r.credit);return `<tr><td>${esc(r.dt)}</td><td>${esc(r.type)}</td><td class="l">${esc(r.det)}</td><td>${r.debit?money(r.debit):''}</td><td>${r.credit?money(r.credit):''}</td><td>${esc(r.method)}</td><td><b>${money(run)}</b></td></tr>`}).join('');
  return body?tbl(['التاريخ','العملية','التفاصيل','مدين (فواتير)','دائن (مسدد/مرتجع)','طريقة الدفع','الرصيد (موجب = مستحق للمورد)'],body):'<div class="mut">لا توجد حركات</div>';
}
function saveSupStmt(id){
  const s=supById(id);if(!s)return;
  const sm=[['المورد',s.name],['الهاتف',s.phone],['العنوان',s.addr],['رصيد افتتاحي',s.open||0],['إجمالي الفواتير',supBilled(id)],['إشعارات دائنة',supCN(id)],['إجمالي الدفعات',supPaid(id)],['الرصيد الحالي (موجب = مستحق للمورد)',supBalance(id)],['مستلم غير مفوتر',supUnbilled(id)]];
  const bl=[['رقم الفاتورة','رقم فاتورة المورد','التاريخ','الاستحقاق','الطريقة','القيمة','المسدد','المتبقي']].concat(D.bills.filter(x=>x.sup===id).map(b=>[b.id,b.no,b.date,b.due,b.method,b.total,billPaid(b),billRest(b)]));
  const py=[['التاريخ','المبلغ','الطريقة','الفاتورة','ملاحظة','بواسطة']].concat(D.payments.filter(x=>x.sup===id).sort((a,b)=>a.ts-b.ts).map(x=>[x.dt,x.amount,x.method,x.bill||'',x.note,x.user]));
  const rt=[['رقم المرتجع','التاريخ','عن طلب','القيمة','إشعار دائن']].concat(D.pret.filter(x=>x.sup===id).map(x=>[x.id,x.dt,x.pur,x.total,x.cn||0]));
  return saveX('الحسابات/الموردين',`${s.name}.xlsx`,wbOf([['الملخص',sm],['الفواتير',bl],['الدفعات',py],['المرتجعات',rt]]));
}
A.supSave=t=>{
  const s=supById(t.dataset.id),n=norm($('se_name').value),o=num($('se_open').value);
  if(!n){say('اكتب الاسم',1);return}if(isNaN(o)){say('رصيد افتتاحي غير صحيح',1);return}
  const dup=supByName(n);if(dup&&dup.id!==s.id){say('اسم مستخدم لمورد آخر',1);return}
  Object.assign(s,{name:n,phone:norm($('se_phone').value),addr:norm($('se_addr').value),note:norm($('se_note').value),open:o});
  save('suppliers');saveSupStmt(s.id);say('تم حفظ بيانات المورد');go('supEdit',s.id);
};
A.supPay=async t=>{
  const id=t.dataset.id,open=D.bills.filter(b=>b.sup===id&&billRest(b)>0.005);
  const r=await formDlg('تسجيل دفعة للمورد',[{k:'a',l:'المبلغ',t:'number'},{k:'m',l:'طريقة الدفع',t:'select',o:['نقدي','تحويل بنكي','شيك','فودافون كاش','أخرى']},{k:'b',l:'على فاتورة',t:'select',o:['دفعة عامة'].concat(open.map(b=>'فاتورة #'+b.id+' (المتبقي '+money(billRest(b))+')'))},{k:'n',l:'ملاحظة',t:'text'}],'تسجيل الدفعة');
  if(!r)return;const a=num(r.a);if(isNaN(a)||a<=0){say('اكتب مبلغًا صحيحًا',1);return}
  const m=/#(\d+)/.exec(r.b),bill=m?+m[1]:null,bb=bill?D.bills.find(x=>x.id===bill):null;
  if(bb&&a>billRest(bb)+0.005){say('المبلغ أكبر من المتبقي على الفاتورة',1);return}
  const d=new Date();D.payments.push({id:nextNo('pay'),sup:id,amount:a,method:r.m,note:norm(r.n),user:ME.name,dt:nowStr(d),day:dayStr(d),ts:d.getTime(),bill});
  save('payments','cnt');saveSupStmt(id);say('تم تسجيل الدفعة');go('supEdit',id);
};

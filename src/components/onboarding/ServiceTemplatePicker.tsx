'use client';

import { useRef, useState } from 'react';
import { CheckCircle2, Loader2, Scissors, ListChecks } from 'lucide-react';

const templates = [
  {name:'حلاقة شعر',duration:'30'}, {name:'حلاقة ذقن',duration:'15'},
  {name:'تصفيف شعر',duration:'20'}, {name:'تنظيف بشرة',duration:'30'},
  {name:'حمام زيت',duration:'30'}, {name:'بروتين شعر',duration:'90'},
];
type Row = {name:string;duration:string;price:string;selected:boolean;status:string};
export default function ServiceTemplatePicker({existingNames,onSaved}:{existingNames:string[];onSaved:()=>Promise<void>}) {
  const [rows,setRows]=useState<Row[]>(()=>templates.map(t=>({...t,price:'',selected:false,status:''})));
  const [busy,setBusy]=useState(false);
  const [notice,setNotice]=useState('');
  const pending=useRef(false);
  const existing=new Set(existingNames.map(n=>n.trim().toLowerCase()));
  const saved=(r:Row)=>existing.has(r.name.trim().toLowerCase())||r.status==='تم الحفظ'||r.status==='موجودة بالفعل';
  const chosen=rows.filter(r=>r.selected&&!saved(r));
  const available=rows.filter(r=>!saved(r));
  const existingCount=rows.length-available.length;
  const valid=(r:Row)=>!!r.price.trim()&&Number.isFinite(Number(r.price))&&Number(r.price)>=0.01&&Number(r.price)<=1000000&&Math.abs(Number(r.price)*100-Math.round(Number(r.price)*100))<=1e-6&&Number.isInteger(Number(r.duration))&&Number(r.duration)>=5&&Number(r.duration)<=600;
  const readyCount=chosen.filter(valid).length;
  const allSelected=available.length>0&&chosen.length===available.length;
  function patch(index:number,change:Partial<Row>){setRows(old=>old.map((r,i)=>i===index?{...r,...change}:r));}
  async function save(){
    if(pending.current||!chosen.length)return;
    if(chosen.some(r=>!valid(r))){setNotice('اكتب سعرًا ومدة صحيحة لكل خدمة مختارة.');return;}
    pending.current=true;setBusy(true);setNotice('');
    let failures=0;
    try{
      for(let n=0;n<rows.length;n++){
        const r=rows[n];if(!r.selected||saved(r))continue;
        try{
          const res=await fetch('/api/tenant/onboarding/setup-data',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'service',name:r.name,price:Number(r.price),durationMinutes:Number(r.duration)})});
          const data=await res.json().catch(()=>({}));
          if(!res.ok||!data.ok)throw new Error(data.error||'تعذر الحفظ.');
          patch(n,{status:data.existing?'موجودة بالفعل':'تم الحفظ',selected:false});
        }catch(e){failures++;patch(n,{status:e instanceof Error?e.message:'تعذر الحفظ.'});}
      }
      setNotice(failures?'تمت معالجة الاختيارات. راجع الخدمات اللي فشل حفظها وحاول تاني.':'تم حفظ الخدمات المختارة.');
      try{await onSaved();}catch{setNotice('تمت معالجة الاختيارات، لكن تعذر تحديث القائمة. حدّث الصفحة.');}
    }finally{pending.current=false;setBusy(false);}
  }
  return <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
    <header className="border-b border-slate-200 bg-gradient-to-br from-[#102433] to-[#0b514f] p-5 text-white sm:p-6">
      <div className="flex items-center gap-2 text-xs font-bold text-[#9af0e7]"><Scissors className="h-4 w-4"/> قالب خدمات الصالون</div>
      <h2 className="mt-2 text-xl font-black">ابدأ من كتالوج جاهز</h2><p className="mt-2 text-xs leading-6 text-slate-200">اختار الخدمات المناسبة ليك واكتب أسعارك ومددك. الخدمات الموجودة هتفضل زي ما هي.</p>
    </header>
    <div className="p-4 sm:p-5">
      <div className="grid grid-cols-3 gap-2 rounded-xl bg-slate-50 p-3 text-center">
        {[{label:'موجودة',count:existingCount},{label:'مختارة',count:chosen.length},{label:'جاهزة للحفظ',count:readyCount}].map(item=><div key={item.label} className="min-w-0"><div className="text-xl font-black tabular-nums text-[#087e7a]">{item.count}</div><div className="mt-1 text-[11px] text-slate-600">{item.label}</div></div>)}
      </div>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-2"><span className="text-xs font-bold text-slate-600">الخدمات المقترحة</span><button type="button" disabled={busy||!available.length} onClick={()=>setRows(old=>old.map(r=>saved(r)?r:{...r,selected:!allSelected}))} className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-slate-200 px-3 text-xs font-bold text-[#087e7a] disabled:opacity-50"><ListChecks className="h-4 w-4"/>{allSelected?'إلغاء تحديد الكل':'تحديد كل الخدمات المتاحة'}</button></div>
    <div className="mt-4 space-y-2">{rows.map((r,index)=><div key={r.name} className={'grid grid-cols-2 items-center gap-3 rounded-xl border p-3 sm:grid-cols-[minmax(0,1fr)_100px_86px] '+(r.selected&&!saved(r)?'border-teal-500 bg-teal-50/40':'border-slate-200')}>
      <label className="col-span-2 flex min-w-0 items-center gap-3 text-sm font-bold sm:col-span-1"><input type="checkbox" className="h-5 w-5 shrink-0 accent-teal-700" checked={r.selected&&!saved(r)} disabled={busy||saved(r)} onChange={e=>patch(index,{selected:e.target.checked,status:''})}/><span className="min-w-0 break-words">{r.name}{saved(r)&&<span className="block text-[10px] text-emerald-700">موجودة في الكتالوج</span>}</span></label>
      <label className="text-[10px] text-slate-600">السعر (ج.م)<input aria-label={'سعر '+r.name} type="number" min="0.01" max="1000000" step="0.01" value={r.price} disabled={busy||!r.selected||saved(r)} onChange={e=>patch(index,{price:e.target.value,status:''})} className="mt-1 min-h-11 w-full min-w-0 rounded-lg border border-slate-300 bg-white p-2 text-base disabled:bg-slate-100 sm:text-sm"/></label>
      <label className="text-[10px] text-slate-600">المدة (د)<input aria-label={'مدة '+r.name} type="number" min="5" max="600" value={r.duration} disabled={busy||!r.selected||saved(r)} onChange={e=>patch(index,{duration:e.target.value,status:''})} className="mt-1 min-h-11 w-full min-w-0 rounded-lg border border-slate-300 bg-white p-2 text-base disabled:bg-slate-100 sm:text-sm"/></label>
      {r.status&&!saved(r)&&<p role="status" className="col-span-2 text-xs text-rose-700 sm:col-span-3">{r.status}</p>}
    </div>)}</div>
    <button type="button" disabled={busy||!chosen.length||readyCount!==chosen.length} onClick={()=>void save()} className="mt-4 flex min-h-11 items-center gap-2 rounded-xl bg-[#087e7a] px-4 py-2 text-sm font-bold text-white disabled:opacity-50">{busy?<Loader2 className="h-4 w-4 animate-spin"/>:<CheckCircle2 className="h-4 w-4"/>}{busy?'جاري الحفظ…':'حفظ '+chosen.length+' خدمات مختارة'}</button>
    {chosen.length>readyCount&&<p className="mt-3 text-xs leading-6 text-amber-800">كمّل السعر (حتى منزلتين عشريتين) والمدة الصحيحة لكل خدمة مختارة قبل الحفظ.</p>}
    {notice&&<p role="status" className="mt-3 rounded-xl bg-slate-50 p-3 text-sm text-slate-700">{notice}</p>}
    </div>
  </section>;
}

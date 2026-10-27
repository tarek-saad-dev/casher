'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, CheckCircle2, ChevronDown, Copy, GitBranch, MessageCircle, Plus, Save, Sparkles, Trash2, Workflow, Zap } from 'lucide-react';

type Condition = { id: string; field: string; operator: 'gte' | 'eq' | 'false'; value: string };
type Draft = {
  id: string; name: string; event: string; branch: string; conditions: Condition[];
  logic: 'and' | 'or'; delay: string; action: string; message: string; updatedAt: string;
};
const STORAGE_KEY = 'cut-pulse-automation-drafts-v1';
const events = [
  { value: 'attendance.check_in', label: 'موظف سجّل حضور' },
  { value: 'visit.completed', label: 'عميل أكمل زيارته' },
  { value: 'booking.cancelled', label: 'حجز اتلغى' },
  { value: 'sale.completed', label: 'فاتورة اتسجلت' },
  { value: 'employee.advance', label: 'موظف استلم سلفة' },
];
const fields = [
  { value: 'streakDays', label: 'أيام الانتظام المتتالية' },
  { value: 'lateCount', label: 'عدد مرات التأخير' },
  { value: 'visits', label: 'إجمالي زيارات العميل' },
  { value: 'hasOpenComplaint', label: 'عنده شكوى مفتوحة' },
  { value: 'hasUpcomingBooking', label: 'عنده حجز قادم' },
];
const examples: Omit<Draft,'id'|'updatedAt'>[] = [
  { name: 'تهنئة الانتظام',event:'attendance.check_in',branch:'all',conditions:[{id:'streak',field:'streakDays',operator:'gte',value:'10'}],logic:'and',delay:'immediate',action:'whatsapp',message:'عاش يا {{employeeName}}! 🏆\nوصلت لـ {{streakDays}} أيام انتظام متتالية. شغلك محل تقديرنا 💈' },
  { name: 'متابعة ما بعد الزيارة',event:'visit.completed',branch:'all',conditions:[{id:'complaint',field:'hasOpenComplaint',operator:'false',value:''}],logic:'and',delay:'1d',action:'whatsapp',message:'أهلاً {{customerName}} 👋\nنورت CUT SALON. يهمنا نعرف رأيك في زيارتك الأخيرة 💈' },
  { name: 'تنبيه التأخير المتكرر',event:'attendance.check_in',branch:'all',conditions:[{id:'late',field:'lateCount',operator:'gte',value:'3'}],logic:'and',delay:'immediate',action:'manager',message:'الزميل {{employeeName}} وصل لـ {{lateCount}} مرات تأخير؛ يُرجى مراجعة الظروف معاه.' },
];
const seed = (index=0):Draft => ({...examples[index],id:'draft-'+Date.now(),updatedAt:new Date().toISOString(),conditions:examples[index].conditions.map(x=>({...x}))});
const classes = 'w-full rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-2.5 text-sm text-zinc-100 outline-none focus:border-amber-500';
const label = 'mb-2 block text-xs font-medium text-zinc-400';
function selectOptions(options:{value:string;label:string}[]) { return options.map(o=><option key={o.value} value={o.value}>{o.label}</option>); }
function passes(c:Condition, data:Record<string,number|boolean>) {
  const x=data[c.field]; if(x===undefined)return false;
  if(c.operator==='false')return x===false;
  if(c.operator==='eq')return String(x)===c.value;
  const n=Number(c.value);return Number.isFinite(n) && Number(x)>=n;
}
function interpolated(source:string,data:Record<string,string|number>) { return source.replace(/\{\{(\w+)\}\}/g,(_,k:string)=>String(data[k]??'{{'+k+'}}')); }
export default function AutomationStudio() {
  const [draft,setDraft]=useState<Draft>(()=>seed());
  const [stored,setStored]=useState<Draft[]>([]);
  const [loaded,setLoaded]=useState(false);
  const [tab,setTab]=useState<'preview'|'simulate'>('preview');
  const [advanced,setAdvanced]=useState(false);
  const [days,setDays]=useState(10);
  const [late,setLate]=useState(0);
  const [complaint,setComplaint]=useState(false);
  const [booking,setBooking]=useState(false);
  const [visits,setVisits]=useState(5);
  const [saved,setSaved]=useState(false);
  const [serverError,setServerError]=useState<string|null>(null);
  const [serverBusy,setServerBusy]=useState(false);
  const [serverDrafts,setServerDrafts]=useState<Array<{id:string;name:string;definition:Omit<Draft,'id'|'updatedAt'|'branch'>}>>([]);
  useEffect(()=>{
    try {
      const raw=window.localStorage.getItem(STORAGE_KEY);
      const parsed=raw?JSON.parse(raw):[];
      if(Array.isArray(parsed))setStored(parsed.filter((x):x is Draft=>Boolean(x&&typeof x.id==='string'&&Array.isArray(x.conditions))));
    }catch { setStored([]); }
    setLoaded(true);
  },[]);
  useEffect(()=>{fetch('/api/admin/whatsapp/automations').then(async res=>{if(!res.ok)throw new Error('المسودات على السيرفر غير متاحة حاليًا');return res.json()}).then(data=>{setServerDrafts(Array.isArray(data.drafts)?data.drafts:[])}).catch(e=>setServerError(e instanceof Error?e.message:'تعذر تحميل المسودات'));},[]);
  const saveServer=async()=>{
    if(!draft.name.trim()||!draft.message.trim()||serverBusy)return;
    setServerBusy(true);setServerError(null);
    try{
      const definition={name:draft.name,event:draft.event,conditions:draft.conditions,logic:draft.logic,delay:draft.delay,action:draft.action,message:draft.message};
      const res=await fetch('/api/admin/whatsapp/automations',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(definition)});
      const data=await res.json();if(!res.ok)throw new Error(data.error||'تعذر حفظ المسودة');
      setServerDrafts(prev=>[{id:data.id,name:draft.name,definition},...prev]);setSaved(true);
    }catch(e){setServerError(e instanceof Error?e.message:'تعذر حفظ المسودة');}finally{setServerBusy(false);}
  };
  const simulateServer=async()=>{
    setServerBusy(true);setServerError(null);
    try{
      const definition={name:draft.name,event:draft.event,conditions:draft.conditions,logic:draft.logic,delay:draft.delay,action:draft.action,message:draft.message};
      const res=await fetch('/api/admin/whatsapp/automations/simulate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({definition,facts:context})});
      const data=await res.json();if(!res.ok)throw new Error(data.error||'تعذر إجراء المحاكاة');
      setTab('simulate');
      setServerError(data.eligible?'المحاكاة نجحت: الشروط متحققة، بدون إرسال.':'المحاكاة نجحت: الشروط غير متحققة، بدون إرسال.');
    }catch(e){setServerError(e instanceof Error?e.message:'تعذر إجراء المحاكاة');}finally{setServerBusy(false);}
  };
  const update=(patch:Partial<Draft>)=>{setDraft(prev=>({...prev,...patch}));setSaved(false);};
  const setCondition=(id:string,patch:Partial<Condition>)=>update({conditions:draft.conditions.map(c=>c.id===id?{...c,...patch}:c)});
  const context=useMemo(()=>({streakDays:days,lateCount:late,hasOpenComplaint:complaint,hasUpcomingBooking:booking,visits}),[days,late,complaint,booking,visits]);
  const eligible = draft.conditions.length>0 && (draft.logic==='and'?draft.conditions.every(c=>passes(c,context)):draft.conditions.some(c=>passes(c,context)));
  const sample=interpolated(draft.message,{employeeName:'عمر',customerName:'أحمد',streakDays:days,lateCount:late,visits});
  const persist=(next:Draft[])=>{window.localStorage.setItem(STORAGE_KEY,JSON.stringify(next));setStored(next);};

  const addCondition=()=>{update({conditions:[...draft.conditions,{id:'c-'+Date.now(),field:'streakDays',operator:'gte',value:'5'}]});setAdvanced(true);};
  const currentEvent=events.find(x=>x.value===draft.event)?.label??'حدث';
  return <div dir="rtl" className="mx-auto max-w-7xl pb-16 text-zinc-100">
    <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
      <div><Link href="/admin/whatsapp" className="mb-3 inline-flex items-center gap-1 text-xs text-zinc-400 hover:text-white"><ArrowRight className="h-3.5 w-3.5"/> العودة لواتساب</Link>
        <div className="flex items-center gap-3"><div className="rounded-xl bg-amber-500/10 p-3 text-amber-400"><Workflow className="h-6 w-6"/></div><div><h1 className="text-2xl font-bold">CUT Pulse <span className="text-amber-400">Studio</span></h1><p className="mt-1 text-sm text-zinc-400">ابني رحلة تلقائية ببساطة، جرّبها وبعدين انشرها لما تكون جاهزة.</p></div></div>
      </div><span className="rounded-full border border-amber-600/40 bg-amber-500/10 px-3 py-1 text-xs text-amber-300">وضع التصميم — الإرسال غير مفعّل</span>
    </header>
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
      <main className="space-y-4">
        <section className="rounded-2xl border border-zinc-800 bg-zinc-900/70 p-5">
          <div className="mb-4 flex items-center gap-2"><Sparkles className="h-4 w-4 text-amber-400"/><h2 className="font-semibold">ابدأ من فكرة جاهزة</h2></div>
          <div className="grid gap-2 sm:grid-cols-3">{examples.map((e,i)=><button key={e.name} onClick={()=>{setDraft(seed(i));setSaved(false)}} className="rounded-xl border border-zinc-700 bg-zinc-950/70 px-3 py-3 text-right text-sm hover:border-amber-500/70">{e.name}<span className="mt-1 block text-xs text-zinc-500">{events.find(x=>x.value===e.event)?.label}</span></button>)}</div>
          <div className="mt-5 grid gap-3 sm:grid-cols-2"><div><label className={label}>اسم الأتمتة</label><input className={classes} value={draft.name} onChange={e=>update({name:e.target.value})}/></div><div><label className={label}>تطبق فين؟</label><select className={classes} value={draft.branch} onChange={e=>update({branch:e.target.value})}>{selectOptions([{value:'all',label:'كل الفروع'},{value:'gleem',label:'جليم'},{value:'camp_caesar',label:'كامب شيزار'}])}</select></div></div>
        </section>
        <section className="rounded-2xl border border-zinc-800 bg-zinc-900/70 p-5">
          <h2 className="mb-1 flex items-center gap-2 font-semibold"><Zap className="h-4 w-4 text-amber-400"/> 1. لما يحصل إيه؟</h2><p className="mb-4 text-xs text-zinc-500">اختار الحدث اللي يبدأ الرحلة.</p><select className={classes} value={draft.event} onChange={e=>update({event:e.target.value})}>{selectOptions(events)}</select>
        </section>
        <div className="mx-auto h-5 w-px bg-zinc-700"/>
        <section className="rounded-2xl border border-zinc-800 bg-zinc-900/70 p-5">
          <h2 className="mb-1 flex items-center gap-2 font-semibold"><GitBranch className="h-4 w-4 text-amber-400"/> 2. تحت أي شروط؟</h2><p className="mb-4 text-xs text-zinc-500">هننفذ الإجراء بس لو الشروط اتحققت.</p>
          <div className="space-y-3">{draft.conditions.map((c,i)=><div key={c.id} className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-3"><div className="mb-2 flex items-center justify-between"><span className="text-xs text-zinc-400">شرط {i+1}</span><button aria-label="حذف الشرط" onClick={()=>update({conditions:draft.conditions.filter(x=>x.id!==c.id)})} className="text-zinc-500 hover:text-red-400"><Trash2 className="h-4 w-4"/></button></div><div className="grid gap-2 sm:grid-cols-[1fr_125px_105px]"><select className={classes} value={c.field} onChange={e=>setCondition(c.id,{field:e.target.value,operator:e.target.value.startsWith('has')?'false':'gte'})}>{selectOptions(fields)}</select><select className={classes} value={c.operator} onChange={e=>setCondition(c.id,{operator:e.target.value as Condition['operator']})}>{selectOptions([{value:'gte',label:'أكبر أو يساوي'},{value:'eq',label:'يساوي'},{value:'false',label:'غير موجود / لا'}])}</select><input aria-label="قيمة الشرط" className={classes} value={c.value} disabled={c.operator==='false'} onChange={e=>setCondition(c.id,{value:e.target.value})} placeholder="القيمة"/></div></div>)}</div>
          <div className="mt-3 flex flex-wrap items-center gap-2"><button onClick={addCondition} className="inline-flex items-center gap-1 rounded-lg border border-zinc-700 px-3 py-2 text-sm hover:border-amber-500"><Plus className="h-4 w-4"/> إضافة شرط</button>{draft.conditions.length>1&&<button className="text-xs text-amber-300" onClick={()=>setAdvanced(!advanced)}>طريقة الجمع <ChevronDown className="inline h-3 w-3"/></button>}{draft.conditions.length>1&&advanced&&<select className="rounded-lg border border-zinc-700 bg-zinc-950 p-2 text-sm" value={draft.logic} onChange={e=>update({logic:e.target.value as Draft['logic']})}><option value="and">كل الشروط (AND)</option><option value="or">أي شرط (OR)</option></select>}</div>
        </section>
        <div className="mx-auto h-5 w-px bg-zinc-700"/>
        <section className="rounded-2xl border border-zinc-800 bg-zinc-900/70 p-5"><h2 className="mb-1 font-semibold">3. إمتى ننفّذ؟</h2><p className="mb-4 text-xs text-zinc-500">توقيت الإجراء بعد تحقق الشروط.</p><select className={classes} value={draft.delay} onChange={e=>update({delay:e.target.value})}>{selectOptions([{value:'immediate',label:'فورًا'},{value:'1h',label:'بعد ساعة'},{value:'1d',label:'بعد يوم'},{value:'quiet',label:'أقرب وقت مناسب للإرسال'}])}</select></section>
        <div className="mx-auto h-5 w-px bg-zinc-700"/>
        <section className="rounded-2xl border border-zinc-800 bg-zinc-900/70 p-5"><h2 className="mb-1 flex items-center gap-2 font-semibold"><MessageCircle className="h-4 w-4 text-amber-400"/> 4. نعمل إيه؟</h2><p className="mb-4 text-xs text-zinc-500">اختار نوع الإجراء واكتب الرسالة.</p><select className={classes} value={draft.action} onChange={e=>update({action:e.target.value})}>{selectOptions([{value:'whatsapp',label:'إرسال رسالة واتساب'},{value:'manager',label:'تنبيه المدير'},{value:'task',label:'إنشاء مهمة متابعة'},{value:'reward',label:'اقتراح مكافأة للمراجعة'}])}</select><label className={'mt-4 '+label}>محتوى الرسالة</label><textarea rows={5} className={classes+' resize-y leading-7'} value={draft.message} onChange={e=>update({message:e.target.value})}/><div className="mt-3 flex flex-wrap gap-2">{['{{employeeName}}','{{customerName}}','{{streakDays}}','{{lateCount}}'].map(x=><button key={x} className="rounded-full border border-zinc-700 px-2.5 py-1 text-xs text-zinc-400 hover:text-white" onClick={()=>update({message:draft.message+' '+x})}>{x}</button>)}</div></section>
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-amber-700/30 bg-amber-500/5 p-4"><div><p className="font-semibold">مسودة آمنة</p><p className="text-xs text-zinc-400">الحفظ على السيرفر متاح بعد تطبيق Migration؛ مفيش إرسال تلقائي في المرحلة دي.</p></div><button disabled={!loaded||serverBusy||!draft.name.trim()||!draft.message.trim()} onClick={saveServer} className="inline-flex items-center gap-2 rounded-lg bg-amber-500 px-5 py-2.5 font-semibold text-zinc-950 disabled:opacity-40"><Save className="h-4 w-4"/>{saved?'اتحفظت':'حفظ مسودة'}</button></div>
        {serverError&&<div role="status" className="rounded-xl border border-amber-700/40 p-3 text-sm text-amber-300">{serverError}</div>}
        <button disabled={serverBusy} onClick={simulateServer} className="w-full rounded-xl border border-zinc-700 p-3 text-sm hover:border-amber-400">تجربة القاعدة على السيرفر — بدون إرسال</button>
      </main>
      <aside className="space-y-4 xl:sticky xl:top-20 xl:self-start">
        <div className="rounded-2xl border border-zinc-800 bg-zinc-900/70 p-4"><h2 className="mb-3 font-semibold">ملخص الرحلة</h2><div className="space-y-3 text-sm"><p><span className="text-amber-400">الحدث:</span> {currentEvent}</p><p><span className="text-amber-400">الشروط:</span> {draft.conditions.length} ({draft.logic==='and'?'جميعها':'أي واحد'})</p><p><span className="text-amber-400">الإجراء:</span> {draft.action==='whatsapp'?'واتساب':draft.action==='manager'?'تنبيه مدير':draft.action==='task'?'مهمة':'مراجعة مكافأة'}</p></div></div>
        <div className="rounded-2xl border border-zinc-800 bg-zinc-900/70 p-4"><div className="mb-3 flex gap-2"><button onClick={()=>setTab('preview')} className={'flex-1 rounded-lg p-2 text-sm '+(tab==='preview'?'bg-amber-500 text-zinc-950':'bg-zinc-800')}>معاينة</button><button onClick={()=>setTab('simulate')} className={'flex-1 rounded-lg p-2 text-sm '+(tab==='simulate'?'bg-amber-500 text-zinc-950':'bg-zinc-800')}>محاكاة</button></div>
          {tab==='preview'?<div className="rounded-xl bg-[#101f1a] p-4"><p className="mb-3 text-xs text-emerald-200">CUT SALON · WhatsApp Preview</p><div className="whitespace-pre-wrap rounded-xl bg-[#245d48] p-3 text-sm leading-7 text-white">{sample}</div><p className="mt-3 text-xs text-emerald-200/70">رسالة توضيحية — لم تُرسل</p></div>:<div className="space-y-4 text-sm"><label className="block">أيام الانتظام: {days}<input type="range" className="mt-2 w-full accent-amber-500" min="0" max="30" value={days} onChange={e=>setDays(Number(e.target.value))}/></label><label className="block">مرات التأخير: {late}<input type="range" className="mt-2 w-full accent-amber-500" min="0" max="10" value={late} onChange={e=>setLate(Number(e.target.value))}/></label><label className="block">عدد الزيارات: {visits}<input type="range" className="mt-2 w-full accent-amber-500" min="0" max="30" value={visits} onChange={e=>setVisits(Number(e.target.value))}/></label><label className="flex items-center gap-2"><input type="checkbox" checked={complaint} onChange={e=>setComplaint(e.target.checked)}/> شكوى مفتوحة</label><label className="flex items-center gap-2"><input type="checkbox" checked={booking} onChange={e=>setBooking(e.target.checked)}/> حجز قادم</label><div className={'flex items-center gap-2 rounded-xl p-3 '+(eligible?'bg-emerald-600/15 text-emerald-300':'bg-rose-600/15 text-rose-300')}><CheckCircle2 className="h-4 w-4"/>{eligible?'القاعدة هتشتغل':'الشروط مش متحققة'}</div><p className="text-xs text-zinc-500">محاكاة للبيانات التجريبية فقط.</p></div>}</div>
        <div className="rounded-2xl border border-zinc-800 bg-zinc-900/70 p-4"><div className="mb-3 flex items-center justify-between"><h2 className="font-semibold">مسوداتي</h2><span className="text-xs text-zinc-500">{stored.length} محلية · {serverDrafts.length} على السيرفر</span></div>{serverDrafts.length>0&&<div className="mb-3 space-y-2">{serverDrafts.map(x=><button key={x.id} onClick={()=>{setDraft({...x.definition,id:'draft-'+Date.now(),branch:'all',updatedAt:new Date().toISOString()});setSaved(false)}} className="block w-full rounded-lg border border-emerald-700/30 p-2 text-right text-xs hover:text-amber-300">☁ {x.name}</button>)}</div>}{stored.length===0?<p className="text-xs text-zinc-500">لسه مفيش مسودات محفوظة.</p>:<div className="space-y-2">{stored.map(x=><div key={x.id} className="flex items-center gap-2 rounded-xl border border-zinc-800 p-2"><button className="min-w-0 flex-1 truncate text-right text-sm hover:text-amber-400" onClick={()=>{setDraft(x);setSaved(true)}}>{x.name}</button><button aria-label="نسخ المسودة" onClick={()=>{setDraft({...x,id:'draft-'+Date.now(),name:x.name+' - نسخة'});setSaved(false)}}><Copy className="h-4 w-4 text-zinc-500"/></button><button aria-label="حذف المسودة" onClick={()=>persist(stored.filter(y=>y.id!==x.id))}><Trash2 className="h-4 w-4 text-zinc-500 hover:text-red-400"/></button></div>)}</div>}</div>
      </aside>
    </div>
  </div>;
}

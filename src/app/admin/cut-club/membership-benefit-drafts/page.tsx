'use client';
import {useEffect,useState} from 'react';
import Link from 'next/link';
import {benefitKinds,parseBenefitDraft,type BenefitRule,type BenefitDraft,type BenefitKind} from '@/lib/cut-club/membershipBenefitDraft';
import type {DraftRow} from '@/lib/cut-club/membershipDraft';
const api='/api/admin/cut-club/membership-benefit-drafts';
const labels:Record<BenefitKind,string>={PERCENT_DISCOUNT:'خصم بنسبة مئوية',FREE_SERVICE:'خدمة مجانية',FIXED_PRICE:'سعر خاص',BONUS_COINS:'نقاط إضافية'};
const field='mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-900 p-3 text-white';
type FormRule={code:string;kind:BenefitKind;serviceId:string;value:string;maxUsesPerMembership:string;maxUsesPerInvoice:string;branchIds:(1|3)[]};
const empty=():FormRule=>({code:'',kind:'PERCENT_DISCOUNT',serviceId:'',value:'',maxUsesPerMembership:'',maxUsesPerInvoice:'',branchIds:[]});
const fromRule=(r:BenefitRule):FormRule=>({...r,serviceId:String(r.serviceId),value:String(r.kind==='PERCENT_DISCOUNT'||r.kind==='FIXED_PRICE'?r.value/100:r.value),maxUsesPerMembership:String(r.maxUsesPerMembership),maxUsesPerInvoice:String(r.maxUsesPerInvoice)});
const toRule=(r:FormRule)=>({...r,code:r.code.trim().toUpperCase(),serviceId:Number(r.serviceId),value:r.kind==='FREE_SERVICE'?0:r.value.trim()===''?NaN:r.kind==='PERCENT_DISCOUNT'||r.kind==='FIXED_PRICE'?Math.round(Number(r.value)*100):Number(r.value),maxUsesPerMembership:Number(r.maxUsesPerMembership),maxUsesPerInvoice:Number(r.maxUsesPerInvoice)});
export default function MembershipBenefitDraftsPage(){
 const [programs,setPrograms]=useState<DraftRow[]>([]),[drafts,setDrafts]=useState<BenefitDraft[]>([]),[code,setCode]=useState(''),[rules,setRules]=useState<FormRule[]>([]),[reason,setReason]=useState(''),[revision,setRevision]=useState(0),[ready,setReady]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const current=programs.find(p=>p.code===code);
 async function load(){setReady(false);setPrograms([]);setDrafts([]);setCode('');setRules([]);setReason('');setRevision(0);
 try{const [a,b]=await Promise.all([fetch('/api/admin/cut-club/membership-drafts',{cache:'no-store',credentials:'same-origin'}),fetch(api,{cache:'no-store',credentials:'same-origin'})]);const [d,x]=await Promise.all([a.json(),b.json()]);if(!a.ok||!b.ok||d.draftOnly!==true||x.draftOnly!==true||x.benefitsEnabled!==false)throw Error('UNAVAILABLE');setPrograms(d.items);setDrafts(x.items);setReady(true);}catch{setError('إعداد المزايا غير متاح. تحقق من بيئة الاختبار.');}}
 useEffect(()=>{void load();},[]);
 function select(c:string){setCode(c);setReason('');setError('');setNotice('');const p=programs.find(x=>x.code===c),d=drafts.find(x=>x.programCode===c&&x.programRevision===p?.revision);setRules(d?.rules.map(fromRule)??[]);setRevision(d?.revision??0);}
 const patch=(i:number,x:Partial<FormRule>)=>setRules(old=>old.map((r,j)=>i===j?{...r,...x}:r));
 async function save(e:React.FormEvent){e.preventDefault();if(!current||busy||!ready)return;setError('');setNotice('');
 const input=parseBenefitDraft({programCode:current.code,programRevision:current.revision,expectedRevision:revision,rules:rules.map(toRule),reason});
 if(!input){setError('راجع الأكواد والقيم والحدود والفروع. لا تكرر نفس الخدمة في المسودة.');return;}
 setBusy(true);
 try{const r=await fetch(api,{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)});const d=await r.json();if(!r.ok||d.draftOnly!==true||d.benefitsEnabled!==false)throw Error(d.code||'UNAVAILABLE');setNotice('تم حفظ نسخة مقترحة. لا خصم أو نقاط مفعّلة.');await load();}
 catch{setReady(false);setError('تعذر تأكيد الحفظ. حدّث القائمة قبل إعادة المحاولة.');}finally{setBusy(false);}}
 return <main dir="rtl" className="min-h-screen bg-[#0a0a0a] p-4 text-white sm:p-8"><div className="mx-auto max-w-6xl space-y-5">
 <Link href="/admin/cut-club" className="text-sm text-yellow-400">العودة إلى CUT CLUB</Link>
 <h1 className="text-3xl font-black">إعداد مزايا العضويات</h1><p className="text-sm text-zinc-400">مسودات اختبار فقط. معرفات الخدمات مقترحة وتحتاج مطابقة الكتالوج قبل الاعتماد. لا يتم تطبيق خصم أو منح نقاط من هذه الصفحة.</p>
 <button disabled={busy} onClick={()=>{setError('');void load();}} className="rounded-lg border border-zinc-700 px-4 py-3">تحديث</button>
 {error&&<p role="alert" className="text-red-300">{error}</p>}{notice&&<p role="status" className="text-green-300">{notice}</p>}
 <form onSubmit={save} className="space-y-5"><fieldset disabled={!ready||busy} className="space-y-5">
 <label className="block">برنامج العضوية<select className={field} value={code} onChange={e=>select(e.target.value)}><option value="">اختر برنامجًا</option>{programs.map(p=><option key={p.code} value={p.code}>{p.title} · نسخة {p.revision}</option>)}</select></label>
 {current&&<><div className="flex flex-wrap items-center justify-between gap-3"><h2 className="font-bold">قواعد المزايا · نسخة المسودة {revision||'جديدة'}</h2><button type="button" disabled={rules.length>=20} onClick={()=>setRules(old=>[...old,empty()])} className="rounded-lg border border-yellow-400 px-4 py-2 text-yellow-400">+ إضافة ميزة</button></div>
 {rules.length===0&&<p className="text-sm text-zinc-400">لا مزايا مقترحة في هذه النسخة.</p>}
 {rules.map((r,i)=><section key={i} className="space-y-4 rounded-xl border border-zinc-800 p-5"><div className="flex items-center justify-between"><h3 className="font-bold">ميزة {i+1}</h3><button type="button" onClick={()=>setRules(old=>old.filter((_,j)=>j!==i))} className="text-sm text-red-300">حذف من المسودة</button></div>
 <div className="grid gap-3 sm:grid-cols-2"><label>كود الميزة<input className={field} required maxLength={40} value={r.code} onChange={e=>patch(i,{code:e.target.value.toUpperCase()})}/></label><label>نوع الميزة<select className={field} value={r.kind} onChange={e=>patch(i,{kind:e.target.value as BenefitKind,value:''})}>{benefitKinds.map(k=><option key={k} value={k}>{labels[k]}</option>)}</select></label>
 <label>معرف الخدمة المقترح<input className={field} required type="number" min={1} max={2147483647} value={r.serviceId} onChange={e=>patch(i,{serviceId:e.target.value})}/></label>
 {r.kind!=='FREE_SERVICE'&&<label>{r.kind==='PERCENT_DISCOUNT'?'نسبة الخصم %':r.kind==='FIXED_PRICE'?'السعر بالجنيه':'عدد النقاط'}<input className={field} required type="number" min={r.kind==='BONUS_COINS'?1:0.01} max={r.kind==='PERCENT_DISCOUNT'?100:r.kind==='FIXED_PRICE'?1000000:100000} step={r.kind==='BONUS_COINS'?1:0.01} value={r.value} onChange={e=>patch(i,{value:e.target.value})}/></label>}
 <label>حد الاستخدام لكل عضوية<input className={field} required type="number" min={1} max={10000} value={r.maxUsesPerMembership} onChange={e=>patch(i,{maxUsesPerMembership:e.target.value})}/></label>
 <label>حد الاستخدام لكل فاتورة<input className={field} required type="number" min={1} max={100} value={r.maxUsesPerInvoice} onChange={e=>patch(i,{maxUsesPerInvoice:e.target.value})}/></label></div>
 <div><p className="mb-2 text-sm">الفروع</p>{([1,3] as const).filter(b=>current.allowedBranchIds.includes(b)).map(b=><label key={b} className="me-5 inline-flex gap-2"><input type="checkbox" checked={r.branchIds.includes(b)} onChange={e=>patch(i,{branchIds:e.target.checked?[...r.branchIds,b]:r.branchIds.filter(x=>x!==b)})}/>{b===1?'جليم':'كامب شيزار'}</label>)}</div></section>)}
 <label className="block">سبب إعداد أو تعديل المزايا<textarea className={field} required minLength={5} maxLength={300} value={reason} onChange={e=>setReason(e.target.value)}/></label><button className="rounded-xl bg-yellow-400 px-5 py-3 font-bold text-black disabled:opacity-50" disabled={busy||reason.trim().length<5}>حفظ مسودة المزايا</button></>}
 </fieldset></form></div></main>;
}

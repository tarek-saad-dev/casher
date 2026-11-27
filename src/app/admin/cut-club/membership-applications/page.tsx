'use client';
import {useEffect,useState} from 'react';
import Link from 'next/link';
import type {ApplicationRow} from '@/lib/cut-club/membershipApplication';
import type {TrialResult} from '@/lib/cut-club/membershipTrial';
type AdminRow=ApplicationRow&{accountId:string};
const statuses={PENDING:'بانتظار المراجعة',ACCEPTED_FOR_REVIEW:'مقبول لمراجعة الإثبات',REJECTED:'مرفوض',PROGRAM_CHANGED:'البرنامج تغير أو توقف',TRIAL_ISSUED:'تم إصدار سجل تجريبي'};
const api='/api/admin/cut-club/membership-applications';
export default function MembershipApplicationsPage(){
 const [rows,setRows]=useState<AdminRow[]>([]),[id,setId]=useState(''),[reason,setReason]=useState(''),[busy,setBusy]=useState(false),[ready,setReady]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[hasMore,setHasMore]=useState(false);
 const [expiry,setExpiry]=useState(''),[trial,setTrial]=useState<TrialResult|null>(null);
 const current=rows.find(x=>x.id===id);
 async function load(){setReady(false);setRows([]);setId('');setReason('');setHasMore(false);setTrial(null);setExpiry('');
 try{const r=await fetch(api,{credentials:'same-origin',cache:'no-store'});const d=await r.json();if(!r.ok||d.trialOnly!==true)throw Error('UNAVAILABLE');setRows(d.items);setHasMore(d.hasMore===true);setReady(true);}catch{setError('تعذر تحميل الطلبات من بيئة الاختبار.');}}
 useEffect(()=>{void load();},[]);
 async function decide(decision:'ACCEPTED_FOR_REVIEW'|'REJECTED'){if(!current||current.status!=='PENDING'||reason.trim().length<5||busy)return;setBusy(true);setError('');setNotice('');
 try{const r=await fetch(api,{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({id,decision,reason})});const d=await r.json();if(!r.ok||d.trialOnly!==true)throw Error('UNAVAILABLE');setNotice('تم تسجيل القرار. لم يتم تفعيل عضوية أو خصم.');await load();}
 catch{setReady(false);setError('تعذر تأكيد القرار. حدّث الطلبات قبل إعادة المحاولة.');}finally{setBusy(false);}}
 async function issue(action:'CHECK'|'ISSUE'){
 if(!current||current.status!=='ACCEPTED_FOR_REVIEW'||!expiry||reason.trim().length<5||busy)return;
 setBusy(true);setError('');setNotice('');
 try{const r=await fetch('/api/admin/cut-club/membership-application-trial',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({applicationId:current.id,action,expectedTrialRevision:trial?.trialRevision??0,expiresAt:new Date(expiry).toISOString(),reason})});
 const d=await r.json();if(!r.ok||d.trialOnly!==true)throw Error(d.code||'UNAVAILABLE');
 setTrial(d);if(d.issued){setNotice('تم إصدار سجل تجريبي مرتبط بالطلب. لا مزايا مالية.');await load();}}
 catch(e){setTrial(null);setError('تعذر إتمام الإجراء: '+(e instanceof Error?e.message:'UNAVAILABLE')+'. راجع الإثبات والنسخة ثم أعد الفحص.');}
 finally{setBusy(false);}}
 return <main dir="rtl" className="min-h-screen bg-[#0a0a0a] p-4 text-white sm:p-8"><div className="mx-auto max-w-6xl space-y-5">
 <Link href="/admin/cut-club" className="text-sm text-yellow-400">العودة إلى CUT CLUB</Link><h1 className="text-3xl font-black">طلبات الانضمام للعضويات</h1><p className="text-sm text-zinc-400">طلبات تجريبية فقط. القبول ينقل العميل إلى مراجعة الإثبات ولا يمنحه عضوية أو مزايا.</p>
 <button disabled={busy} onClick={()=>{setError('');void load();}} className="rounded-xl border border-zinc-700 px-5 py-3">تحديث الطلبات</button>
 {error&&<p role="alert" className="text-red-300">{error}</p>}{notice&&<p role="status" className="text-green-300">{notice}</p>}
 {hasMore&&<p className="text-sm text-amber-300">يتم عرض أحدث 100 طلب فقط في هذه النسخة التجريبية.</p>}
 {ready&&!rows.length&&<p>لا توجد طلبات مسجلة.</p>}
 <div className="grid gap-5 lg:grid-cols-2"><section className="space-y-3">{rows.map(x=><button key={x.id} disabled={busy||!ready} onClick={()=>{setId(x.id);setReason('');setTrial(null);setExpiry('');}} className={'block w-full rounded-xl border p-4 text-right '+(x.id===id?'border-yellow-400':'border-zinc-800')}><b>{x.title}</b><p className="mt-2 text-sm text-zinc-300">{statuses[x.status]} · {x.branchId===1?'جليم':'كامب شيزار'}</p><p dir="ltr" className="mt-2 break-all text-xs text-zinc-500">{x.id}</p></button>)}</section>
 {current&&ready&&<section className="space-y-4 rounded-xl border border-zinc-800 p-5"><h2 className="text-xl font-bold">{current.title}</h2><p>{statuses[current.status]}</p><p className="text-xs text-zinc-400">معرف الحساب الموثق:</p><p dir="ltr" className="break-all text-xs">{current.accountId}</p><p className="text-sm">نسخة النشر: {current.publicationRevision}</p>
 {current.status==='PENDING'&&<><label className="block">سبب القرار<textarea disabled={busy} className="mt-2 w-full rounded-xl border border-zinc-700 bg-zinc-900 p-3" value={reason} maxLength={300} onChange={e=>setReason(e.target.value)}/></label><div className="flex flex-wrap gap-3"><button disabled={busy||reason.trim().length<5} onClick={()=>void decide('ACCEPTED_FOR_REVIEW')} className="rounded-xl bg-yellow-400 px-4 py-3 font-bold text-black disabled:opacity-50">قبول لمراجعة الإثبات</button><button disabled={busy||reason.trim().length<5} onClick={()=>void decide('REJECTED')} className="rounded-xl border border-red-500/40 px-4 py-3 text-red-300 disabled:opacity-50">رفض</button></div></>}
 {current.status==='ACCEPTED_FOR_REVIEW'&&<div className="space-y-3 border-t border-zinc-800 pt-4">
 <h3 className="font-bold">فحص الاستحقاق وإصدار سجل الاختبار</h3><p className="text-xs text-zinc-400">راجع إثبات الفئة أولًا. يتم جلب العميل والبرنامج والفرع من الطلب تلقائيًا.</p>
 <label className="block">تاريخ انتهاء الاختبار<input disabled={busy} type="datetime-local" className="mt-2 w-full rounded-xl border border-zinc-700 bg-zinc-900 p-3" value={expiry} onChange={e=>{setExpiry(e.target.value);setTrial(null);}}/></label>
 <label className="block">سبب الإجراء<textarea disabled={busy} className="mt-2 w-full rounded-xl border border-zinc-700 bg-zinc-900 p-3" maxLength={300} value={reason} onChange={e=>{setReason(e.target.value);setTrial(null);}}/></label>
 <div className="flex flex-wrap gap-3"><button disabled={busy||!expiry||reason.trim().length<5} onClick={()=>void issue('CHECK')} className="rounded-xl border border-yellow-400 px-4 py-3 text-yellow-400 disabled:opacity-50">فحص الاستحقاق</button><button disabled={busy||!trial?.eligible||trial.status==='CURRENT'} onClick={()=>void issue('ISSUE')} className="rounded-xl bg-yellow-400 px-4 py-3 font-bold text-black disabled:opacity-50">إصدار سجل تجريبي</button></div>
 {trial&&<div role="status" className="text-sm text-zinc-300"><p>{trial.eligible?'مستحق حسب قواعد الاختبار':'غير مستحق'} · زيارات سجل الولاء: {trial.visits??'غير مؤكدة'}</p>{trial.reasons.map(x=><p key={x}>{x}</p>)}</div>}</div>}
 <Link href="/admin/cut-club/membership-proofs" className="block text-sm text-yellow-400">فتح مراجعة الإثباتات</Link></section>}</div></div></main>;
}

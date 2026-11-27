'use client';
import {useState} from 'react';
import Link from 'next/link';
import type {DraftRow} from '@/lib/cut-club/membershipDraft';
import type {ProofAccount} from '@/lib/cut-club/membershipProof';
import type {TrialResult} from '@/lib/cut-club/membershipTrial';
const field='mt-2 w-full rounded-xl border border-zinc-700 bg-zinc-900 p-3 text-white';
const messages:Record<string,string>={TRIAL_NOT_RELEASED:'الاختبار غير مفعل',TRIAL_SCHEMA_UNAVAILABLE:'قاعدة الاختبار غير جاهزة',TRIAL_ALREADY_CURRENT:'توجد نسخة سارية بالفعل',TRIAL_REVISION_CONFLICT:'تم تغيير النسخة، أعد الفحص',PROGRAM_REVISION_CONFLICT:'تم تعديل البرنامج، أعد تحميله',TRIAL_EXCEEDS_PROOF:'الصلاحية تتجاوز صلاحية الإثبات',NOT_ELIGIBLE:'العضو غير مستحق',INVALID_TRIAL:'راجع الحقول والتواريخ'};
async function post(url:string,body:unknown){const r=await fetch(url,{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const d=await r.json();if(!r.ok||d.ok!==true)throw Error(d.code||'UNAVAILABLE');return d;}
export default function MembershipTrialsPage(){
 const [phone,setPhone]=useState(''),[account,setAccount]=useState<ProofAccount|null>(null),[programs,setPrograms]=useState<DraftRow[]>([]),[code,setCode]=useState('');
 const [branch,setBranch]=useState<1|3>(1),[expiry,setExpiry]=useState(''),[reason,setReason]=useState(''),[result,setResult]=useState<TrialResult|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const reset=()=>{setResult(null);setError('');};const program=programs.find(p=>p.code===code);
 async function load(){setBusy(true);reset();setAccount(null);setPrograms([]);setCode('');
 try{const [a,r]=await Promise.all([post('/api/admin/cut-club/membership-proofs',{action:'LOOKUP',phone}),fetch('/api/admin/cut-club/membership-drafts',{cache:'no-store',credentials:'same-origin'})]);const d=await r.json();if(!r.ok||d.draftOnly!==true||a.evidenceOnly!==true)throw Error('UNAVAILABLE');setAccount(a.account);setPrograms(d.items);if(!a.account)setError('لا يوجد حساب مطابق.');}catch{setError('تعذر تحميل الحساب والبرامج من بيئة الاختبار.');}finally{setBusy(false);}}
 async function act(action:'CHECK'|'ISSUE'){if(!account||!program||!expiry||reason.trim().length<5||busy)return;setBusy(true);setError('');
 try{const d=await post('/api/admin/cut-club/membership-trials',{action,accountId:account.accountId,programCode:program.code,programRevision:program.revision,branchId:branch,expectedTrialRevision:result?.trialRevision??0,expiresAt:new Date(expiry).toISOString(),reason});if(d.trialOnly!==true)throw Error('UNAVAILABLE');setResult(d);}catch(e){setResult(null);setError(messages[e instanceof Error?e.message:'']||'تعذر تأكيد العملية. أعد الفحص قبل المحاولة.');}finally{setBusy(false);}}
 return <main dir="rtl" className="min-h-screen bg-[#0a0a0a] p-4 text-white sm:p-8"><div className="mx-auto max-w-4xl space-y-6"><Link href="/admin/cut-club" className="text-sm text-yellow-400">العودة إلى CUT CLUB</Link><h1 className="text-3xl font-black">تشغيل العضويات تجريبيًا</h1><p className="text-zinc-400">فحص الاستحقاق من البيانات المسجلة وإصدار سجل اختبار فقط. لا مزايا مالية أو نشر للعميل.</p>
 <form onSubmit={e=>{e.preventDefault();void load();}} className="rounded-xl border border-zinc-800 p-5"><label>رقم واتساب العضو<input className={field} value={phone} required type="tel" disabled={busy} onChange={e=>{setPhone(e.target.value);setAccount(null);setPrograms([]);setCode('');reset();}}/></label><button disabled={busy} className="mt-3 rounded-lg bg-yellow-400 px-5 py-3 font-bold text-black">تحميل الحساب والبرامج</button></form>
 {account&&<fieldset disabled={busy} className="space-y-4 rounded-xl border border-zinc-800 p-5" onChange={reset}><p>العضو: {account.maskedPhone} — {account.eligibleAccount?'مرتبط ومفعل':'غير مؤهل'}</p>
 <label className="block">البرنامج<select className={field} value={code} onChange={e=>setCode(e.target.value)}><option value="">اختر مسودة</option>{programs.map(p=><option key={p.code} value={p.code}>{p.title} · نسخة {p.revision}</option>)}</select></label>
 <label className="block">الفرع<select className={field} value={branch} onChange={e=>setBranch(Number(e.target.value) as 1|3)}><option value={1}>جليم</option><option value={3}>كامب شيزار</option></select></label>
 <label className="block">انتهاء الاختبار (بتوقيت الجهاز)<input className={field} type="datetime-local" value={expiry} onChange={e=>setExpiry(e.target.value)}/></label>
 <label className="block">سبب الإجراء<textarea className={field} maxLength={300} value={reason} onChange={e=>setReason(e.target.value)}/></label>
 <div className="flex flex-wrap gap-3"><button type="button" disabled={!program||!expiry||reason.trim().length<5} onClick={()=>void act('CHECK')} className="rounded-xl border border-yellow-400 px-5 py-3 text-yellow-400 disabled:opacity-50">فحص الاستحقاق</button><button type="button" disabled={!result?.eligible||result.status==='CURRENT'} onClick={()=>void act('ISSUE')} className="rounded-xl bg-yellow-400 px-5 py-3 font-bold text-black disabled:opacity-50">إصدار سجل تجريبي</button></div>
 </fieldset>}
 {error&&<p role="alert" className="text-red-300">{error}</p>}
 {result&&<section role="status" className="space-y-2 rounded-xl border border-zinc-700 p-5"><h2 className="text-xl font-bold">{result.eligible?'مستحق حسب قواعد الاختبار':'غير مستحق حسب قواعد الاختبار'}</h2><p>الزيارات بسجل الولاء: {result.visits??'غير مؤكدة'}</p><p>نسخة الإثبات: {result.proofRevision??'—'} · نسخة الاختبار: {result.trialRevision}</p><p>الحالة: {({NONE:'لا يوجد سجل',CURRENT:'سارٍ تجريبيًا',EXPIRED:'منتهي',INVALIDATED:'غير صالح'})[result.status]}</p>{result.reasons.map(x=><p key={x} className="text-sm text-zinc-400">{x}</p>)}{result.issued&&<p className="text-green-300">تم تسجيل نسخة اختبار؛ لا خصم ولا عضوية منشورة.</p>}</section>}
 </div></main>;
}

'use client';
import {useState} from 'react';
import Link from 'next/link';
import type {ProofAccount,ProofKind,ProofCommand} from '@/lib/cut-club/membershipProof';
const kinds={STUDENT:'طالب',DOCTOR:'طبيب',COMPANY:'موظف جهة شريكة'};
const statuses={VERIFIED:'إثبات معتمد',EXPIRED:'انتهت الصلاحية',REVOKED:'ملغى',ACCOUNT_INELIGIBLE:'الحساب غير مؤهل'};
const field='mt-2 w-full rounded-xl border border-zinc-700 bg-zinc-900 p-3 text-white';
async function call(body:unknown){
 const r=await fetch('/api/admin/cut-club/membership-proofs',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
 const d=await r.json();if(!r.ok||d.evidenceOnly!==true)throw Error(d.code||'UNAVAILABLE');return d;
}
export default function MembershipProofsPage(){
 const [phone,setPhone]=useState(''),[account,setAccount]=useState<ProofAccount|null>(null),[searched,setSearched]=useState(false);
 const [kind,setKind]=useState<ProofKind>('STUDENT'),[partner,setPartner]=useState(''),[expiry,setExpiry]=useState(''),[verified,setVerified]=useState(false),[reason,setReason]=useState('');
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const reset=()=>{setVerified(false);setPartner('');setExpiry('');setReason('');};
 const lookup=async()=>{setAccount(null);setSearched(false);setError('');setNotice('');reset();setBusy(true);try{const d=await call({action:'LOOKUP',phone});setAccount(d.account);setSearched(true);}catch{setError('تعذر البحث. تحقق من الرقم وصلاحية الإدارة وبيئة الاختبار.');}finally{setBusy(false);}};
 const current=account?.proofs.find(p=>p.kind===kind);
 async function save(action:'APPROVE'|'REVOKE'){
 if(!account||busy||reason.trim().length<5)return;
 const common={accountId:account.accountId,kind,expectedRevision:current?.revision??0,reason};
 if(action==='APPROVE'&&(!account.eligibleAccount||!account.clientId||!verified||!expiry))return;
 setBusy(true);setError('');setNotice('');
 try{
 const command:ProofCommand=action==='APPROVE'?{...common,action,expectedClientId:account.clientId!,partnerCode:partner.trim().toUpperCase()||null,expiresAt:new Date(expiry).toISOString(),reviewedInPerson:true}:{...common,action};
 await call(command);setAccount(null);const fresh=await call({action:'LOOKUP',phone});setAccount(fresh.account);setSearched(true);reset();setNotice('تم تسجيل قرار الإثبات. لم يتم منح عضوية أو خصم.');
 }catch(e){setAccount(null);setSearched(false);reset();setError(e instanceof Error&&e.message==='REVISION_CONFLICT'?'تم تعديل الإثبات من مكان آخر. ابحث عن العميل مرة أخرى.':'تعذر تأكيد النتيجة. ابحث عن العميل قبل إعادة المحاولة.');}finally{setBusy(false);}
 }
 return <main dir="rtl" className="min-h-screen bg-[#0a0a0a] p-4 text-white sm:p-8"><div className="mx-auto max-w-5xl space-y-6">
 <Link href="/admin/cut-club" className="text-sm text-yellow-400">العودة إلى CUT CLUB</Link>
 <h1 className="text-3xl font-black">مراجعة إثباتات العضويات</h1><p className="text-sm text-zinc-400">بيئة اختبار فقط. راجع إثبات الفئة حضوريًا دون رفع صورة الهوية أو حفظ رقمها. اعتماد الإثبات لا يفعّل عضوية أو خصمًا.</p>
 <form onSubmit={e=>{e.preventDefault();void lookup();}} className="rounded-2xl border border-zinc-800 p-5"><label className="block text-sm">رقم واتساب العضو الموثق<input dir="ltr" className={field} type="tel" required maxLength={32} disabled={busy} value={phone} onChange={e=>{setPhone(e.target.value);setAccount(null);setSearched(false);reset();setNotice('');setError('');}}/></label><button disabled={busy} className="mt-4 rounded-xl bg-yellow-400 px-5 py-3 font-bold text-black disabled:opacity-50">بحث</button></form>
 {error&&<p role="alert" className="text-red-300">{error}</p>}{notice&&<p role="status" className="text-green-300">{notice}</p>}{searched&&!account&&<p>لا يوجد حساب مطابق.</p>}
 {account&&<section className="space-y-5 rounded-2xl border border-zinc-800 p-5"><p>عضو <span dir="ltr">{account.maskedPhone}</span> — {account.eligibleAccount?'حساب مرتبط ومفعّل':'حساب غير مؤهل للاعتماد'}</p>
 <div className="grid gap-3 sm:grid-cols-3">{account.proofs.map(p=><div key={p.kind} className="rounded-xl border border-zinc-700 p-3"><b>{kinds[p.kind]}</b><p className="text-sm text-zinc-300">{statuses[p.status]} · نسخة {p.revision}</p>{p.expiresAt&&<p className="text-xs text-zinc-400">الصلاحية: {new Date(p.expiresAt).toLocaleString('ar-EG')}</p>}</div>)}</div>
 <fieldset disabled={busy} className="space-y-4"><legend className="font-bold">قرار المراجعة</legend>
 <label className="block">الفئة<select className={field} value={kind} onChange={e=>{setKind(e.target.value as ProofKind);reset();}}>{Object.entries(kinds).map(([k,v])=><option value={k} key={k}>{v}</option>)}</select></label>
 <label className="block">كود الجهة الشريكة (اختياري)<input className={field} maxLength={40} value={partner} onChange={e=>setPartner(e.target.value)}/></label>
 <label className="block">انتهاء صلاحية الإثبات (بتوقيت الجهاز)<input className={field} type="datetime-local" value={expiry} onChange={e=>setExpiry(e.target.value)}/></label>
 <label className="flex gap-3 text-sm"><input type="checkbox" checked={verified} onChange={e=>setVerified(e.target.checked)}/>أؤكد أنني راجعت إثبات الفئة وهوية العضو حضوريًا.</label>
 <label className="block">سبب القرار (بدون أرقام أو صور مستندات شخصية)<textarea className={field} maxLength={300} value={reason} onChange={e=>setReason(e.target.value)}/></label>
 <div className="flex flex-wrap gap-3"><button type="button" onClick={()=>void save('APPROVE')} disabled={!account.eligibleAccount||!verified||!expiry||reason.trim().length<5} className="rounded-xl bg-yellow-400 px-5 py-3 font-bold text-black disabled:opacity-50">اعتماد الإثبات</button>
 <button type="button" onClick={()=>void save('REVOKE')} disabled={!current||current.status==='REVOKED'||reason.trim().length<5} className="rounded-xl border border-red-500/40 px-5 py-3 text-red-300 disabled:opacity-50">إلغاء الإثبات</button></div>
 </fieldset></section>}
 </div></main>;
}

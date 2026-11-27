'use client';
import {useState} from 'react';
import Link from 'next/link';
import {Crown,ShieldCheck,FlaskConical} from 'lucide-react';
import type {MembershipKind,MemberFacts,EligibilityReason} from '@/lib/cut-club/membershipPolicy';
const kinds:Record<MembershipKind,string>={GENERAL:'عضوية عامة',STUDENT:'طلاب ومدارس وجامعات',DOCTOR:'أطباء',COMPANY:'شركات وشركاء'};
const reasons:Record<EligibilityReason,string>={PROGRAM_DISABLED:'البرنامج غير مفعل',ACCOUNT_NOT_ACTIVE:'الحساب غير مرتبط أو موقوف أو تحت المراجعة',BRANCH_NOT_ELIGIBLE:'الفرع غير مشمول',VISITS_UNVERIFIED:'الزيارات غير مؤكدة',VISITS_INSUFFICIENT:'عدد الزيارات غير كافٍ',PROOF_REQUIRED:'إثبات الفئة غير معتمد',PROOF_EXPIRED:'الإثبات منتهي أو بلا تاريخ صلاحية',PARTNER_MISMATCH:'الجهة غير مطابقة للاتفاقية'};
const input='mt-2 w-full rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-3 text-sm text-white';
export default function MembershipPreviewPage(){
 const [kind,setKind]=useState<MembershipKind>('GENERAL');
 const [enabled,setEnabled]=useState(false);
 const [minimum,setMinimum]=useState('0');
 const [branches,setBranches]=useState<number[]>([]);
 const [partner,setPartner]=useState('');
 const [branch,setBranch]=useState('1');
 const [account,setAccount]=useState<MemberFacts['accountStatus']>('ACTIVE');
 const [visits,setVisits]=useState('');
 const [verified,setVerified]=useState(false);
 const [proofPartner,setProofPartner]=useState('');
 const [expiry,setExpiry]=useState('');
 const [result,setResult]=useState<{eligible:boolean;reasons:EligibilityReason[]}|null>(null);
 const [busy,setBusy]=useState(false),[error,setError]=useState('');
 const edit=()=>{setResult(null);setError('');};
 async function submit(e:React.FormEvent){
  e.preventDefault();setResult(null);setError('');setBusy(true);
  try{
   const payload={policy:{kind,enabled,minimumVisits:Number(minimum),allowedBranchIds:branches,partnerCode:kind==='GENERAL'?null:partner.trim().toUpperCase()||null},facts:{accountStatus:account,completedVisits:visits===''?null:Number(visits),branchId:Number(branch),proof:kind==='GENERAL'?null:{kind,verified,partnerCode:proofPartner.trim().toUpperCase()||null,expiresAt:expiry?new Date(expiry+'T23:59:59Z').toISOString():null}}};
   const res=await fetch('/api/admin/cut-club/membership-preview',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
   const data=await res.json();
   if(!res.ok||data.ok!==true||data.previewOnly!==true)throw Error('INVALID');
   setResult({eligible:data.eligible,reasons:data.reasons});
  }catch{setError('تعذر معاينة الشروط. راجع البيانات وصلاحية الإدارة.');}finally{setBusy(false);}
 }
 return <main dir="rtl" lang="ar" className="min-h-screen bg-[#0a0a0a] p-4 text-white sm:p-8">
  <div className="mx-auto max-w-6xl space-y-6">
   <Link href="/admin/cut-club" className="text-sm text-zinc-400 hover:text-white">CUT CLUB / العودة للإدارة</Link>
   <header className="flex flex-wrap items-center gap-4"><span className="rounded-2xl border border-yellow-500/30 bg-yellow-500/10 p-4"><Crown className="text-yellow-400"/></span><div><p className="text-xs tracking-widest text-yellow-400">MEMBERSHIP ENGINE / PREVIEW</p><h1 className="mt-2 text-3xl font-black">معاينة شروط العضويات</h1><p className="mt-2 text-sm text-zinc-400">اختبر استحقاق العضويات قبل نشر أي برنامج.</p></div></header>
   <div className="flex gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm leading-7 text-amber-200"><ShieldCheck className="shrink-0"/>بيانات افتراضية فقط. لا يتم حفظ الإعدادات أو منح عضوية أو تعديل رصيد أو خصم. القواعد الفعلية تحتاج اعتماد وربط بيانات النظام.</div>
   <form onSubmit={submit} onChange={edit} className="space-y-5">
    <div className="grid gap-5 lg:grid-cols-2">
     <fieldset disabled={busy} className="space-y-5 rounded-2xl border border-zinc-800 bg-zinc-950 p-5">
      <legend className="px-2 text-lg font-bold">شروط البرنامج</legend>
      <label className="block text-sm">نوع العضوية<select className={input} value={kind} onChange={e=>{setKind(e.target.value as MembershipKind);setVerified(false);setExpiry('');setProofPartner('');}}>{Object.entries(kinds).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></label>
      <label className="flex items-center gap-3 text-sm"><input type="checkbox" checked={enabled} onChange={e=>setEnabled(e.target.checked)}/>محاكاة برنامج مفعل</label>
      <label className="block text-sm">الحد الأدنى للزيارات المكتملة<input required className={input} type="number" min={0} max={100000} value={minimum} onChange={e=>setMinimum(e.target.value)}/></label>
      <div className="space-y-2"><p className="text-sm">الفروع في المحاكاة</p>{[[1,'جليم'],[3,'كامب شيزار']].map(([id,label])=><label className="flex gap-3 text-sm" key={id}><input type="checkbox" checked={branches.includes(Number(id))} onChange={e=>setBranches(x=>e.target.checked?[...x,Number(id)]:x.filter(n=>n!==Number(id)))}/>{label}</label>)}</div>
      {kind!=='GENERAL'&&<label className="block text-sm">كود الجهة الشريكة (اختياري)<input className={input} maxLength={40} value={partner} onChange={e=>setPartner(e.target.value)} placeholder="UNIVERSITY_01"/></label>}
     </fieldset>
     <fieldset disabled={busy} className="space-y-5 rounded-2xl border border-zinc-800 bg-zinc-950 p-5">
      <legend className="px-2 text-lg font-bold">بيانات حالة تجريبية</legend>
      <label className="block text-sm">حالة الحساب<select className={input} value={account} onChange={e=>setAccount(e.target.value as MemberFacts['accountStatus'])}><option value="ACTIVE">مرتبط ومفعل</option><option value="UNLINKED">غير مرتبط</option><option value="REVIEW_REQUIRED">تحت المراجعة</option><option value="SUSPENDED">موقوف</option></select></label>
      <label className="block text-sm">الفرع<select className={input} value={branch} onChange={e=>setBranch(e.target.value)}><option value="1">جليم</option><option value="3">كامب شيزار</option><option value="2">فرع غير مشمول (اختبار)</option></select></label>
      <label className="block text-sm">عدد الزيارات المؤكدة<input className={input} type="number" min={0} max={100000} value={visits} onChange={e=>setVisits(e.target.value)} placeholder="فارغ = غير مؤكد"/></label>
      {kind!=='GENERAL'&&<><label className="flex gap-3 text-sm"><input type="checkbox" checked={verified} onChange={e=>setVerified(e.target.checked)}/>محاكاة اعتماد إثبات الفئة</label><label className="block text-sm">كود جهة العميل<input className={input} value={proofPartner} maxLength={40} onChange={e=>setProofPartner(e.target.value)}/></label><label className="block text-sm">تاريخ صلاحية الإثبات<input className={input} type="date" value={expiry} onChange={e=>setExpiry(e.target.value)}/></label></>}
     </fieldset>
    </div>
    <button type="submit" disabled={busy} className="inline-flex min-h-12 items-center gap-2 rounded-xl bg-yellow-400 px-6 font-bold text-black disabled:opacity-50"><FlaskConical size={18}/>{busy?'جاري الاختبار…':'اختبر الشروط'}</button>
    {error&&<p role="alert" className="text-red-300">{error}</p>}
    {result&&<section role="status" className="rounded-xl border border-zinc-700 p-5"><h2 className="text-xl font-bold">{result.eligible?'الحالة التجريبية مستحقة':'الحالة التجريبية غير مستحقة'}</h2>{result.reasons.map(reason=><p key={reason} className="mt-2 text-sm text-zinc-300">• {reasons[reason]}</p>)}<p className="mt-3 text-xs text-zinc-500">نتيجة محاكاة فقط؛ لا توجد عضوية أو مزايا تم إصدارها.</p></section>}
   </form>
  </div>
 </main>;
}

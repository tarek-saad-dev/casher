'use client';
import {useEffect,useState} from 'react';
import Link from 'next/link';
import type {BenefitDraft} from '@/lib/cut-club/membershipBenefitDraft';
import type {BenefitApprovalRow} from '@/lib/cut-club/membershipBenefitApproval';
import type {PublicationAdminRow} from '@/lib/cut-club/membershipPublication';
import {previewBenefit,type BenefitCatalogService} from '@/lib/cut-club/membershipBenefitPreview';
const api='/api/admin/cut-club/membership-benefit-approvals';
const status={APPROVED_FOR_TEST:'معتمد للاختبار',REVOKED:'تم إلغاء الاعتماد',SUPERSEDED:'اعتماد لنسخة غير حالية'};
const labels={PERCENT_DISCOUNT:'خصم',FREE_SERVICE:'مجاني',FIXED_PRICE:'سعر خاص',BONUS_COINS:'نقاط إضافية'};
export default function BenefitApprovalsPage(){
 const [pubs,setPubs]=useState<PublicationAdminRow[]>([]),[drafts,setDrafts]=useState<BenefitDraft[]>([]),[approvals,setApprovals]=useState<BenefitApprovalRow[]>([]),[services,setServices]=useState<BenefitCatalogService[]>([]),[code,setCode]=useState(''),[reason,setReason]=useState(''),[confirmed,setConfirmed]=useState(false),[busy,setBusy]=useState(false),[ready,setReady]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const pub=pubs.find(x=>x.code===code),draft=drafts.find(x=>x.programCode===code&&x.programRevision===pub?.programRevision),prior=approvals.find(x=>x.programCode===code);
 const canApprove=pub?.status==='PUBLISHED'&&!!draft?.rules.length&&draft.rules.every(r=>{const svc=services.find(s=>s.id===r.serviceId);return !!svc&&r.branchIds.every(b=>!!previewBenefit(r,svc,b,1,0,0));})&&!(prior?.action==='APPROVE'&&prior.benefitRevision===draft.revision&&prior.publicationRevision===pub.publicationRevision&&prior.programRevision===pub.programRevision);
 async function load(){setReady(false);setPubs([]);setDrafts([]);setApprovals([]);setServices([]);setCode('');setReason('');setConfirmed(false);
 try{const [a,b,c]=await Promise.all(['/api/admin/cut-club/membership-publication','/api/admin/cut-club/membership-benefit-drafts',api].map(url=>fetch(url,{credentials:'same-origin',cache:'no-store'})));const [p,d,v]=await Promise.all([a.json(),b.json(),c.json()]);if(!a.ok||!b.ok||!c.ok||p.trialOnly!==true||d.draftOnly!==true||d.benefitsEnabled!==false||v.trialOnly!==true||v.benefitsEnabled!==false||!Array.isArray(d.services))throw Error('UNAVAILABLE');setPubs(p.items);setDrafts(d.items);setApprovals(v.items);setServices(d.services);setReady(true);}catch{setError('تعذر تحميل بيانات الاعتماد التجريبي.');}}
 useEffect(()=>{void load();},[]);
 async function save(action:'APPROVE'|'REVOKE'){
 if(!ready||busy||!confirmed||reason.trim().length<5)return;
 const target=action==='APPROVE'&&canApprove&&pub&&draft?{programRevision:pub.programRevision,publicationRevision:pub.publicationRevision,benefitRevision:draft.revision}:action==='REVOKE'&&prior?.action==='APPROVE'?{programRevision:prior.programRevision,publicationRevision:prior.publicationRevision,benefitRevision:prior.benefitRevision}:null;
 if(!target)return;setBusy(true);setError('');setNotice('');
 try{const r=await fetch(api,{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,programCode:code,expectedRevision:prior?.revision??0,reason,...target})});const d=await r.json();if(!r.ok||d.trialOnly!==true||d.benefitsEnabled!==false)throw Error('UNAVAILABLE');setNotice(action==='APPROVE'?'تم اعتماد النسخة للاختبار، دون تفعيل مالي.':'تم إلغاء الاعتماد.');await load();}catch{setReady(false);setError('تعذر تأكيد القرار. حدّث البيانات وراجع الإصدار والكتالوج.');}finally{setBusy(false);}}
 const codes=[...new Set([...pubs.map(x=>x.code),...approvals.map(x=>x.programCode)])];
 return <main dir="rtl" className="min-h-screen bg-[#0a0a0a] p-4 text-white sm:p-8"><div className="mx-auto max-w-5xl space-y-5">
 <Link href="/admin/cut-club/membership-benefit-drafts" className="text-sm text-yellow-400">إعداد المزايا</Link><h1 className="text-3xl font-black">اعتماد مزايا العضويات</h1><p className="text-sm text-zinc-400">اعتماد نسخة محددة للاختبار فقط. لا تُطبق أي خصومات أو نقاط من هذه الشاشة.</p>
 <button disabled={busy} onClick={()=>{setError('');void load();}} className="rounded-xl border border-zinc-700 px-4 py-2">تحديث</button>
 {error&&<p role="alert" className="text-red-300">{error}</p>}{notice&&<p role="status" className="text-green-300">{notice}</p>}
 <div className="grid gap-3 sm:grid-cols-2">{codes.map(c=>{const p=pubs.find(x=>x.code===c),a=approvals.find(x=>x.programCode===c);return <button key={c} disabled={!ready||busy} onClick={()=>{setCode(c);setReason('');setConfirmed(false);}} className={'rounded-xl border p-4 text-right '+(code===c?'border-yellow-400':'border-zinc-800')}><b>{p?.title??c}</b><p className="text-sm text-zinc-400">{a?status[a.status]:'لم يتم الاعتماد'}</p></button>;})}</div>
 {ready&&!codes.length&&<p>لا توجد برامج للمراجعة.</p>}
 {code&&ready&&<section className="space-y-4 rounded-xl border border-zinc-800 p-5"><h2 className="text-xl font-bold">{pub?.title??code}</h2><p className="text-sm text-zinc-300">نسخة البرنامج: {pub?.programRevision??'—'} · نسخة النشر: {pub?.publicationRevision??'—'} · مسودة المزايا: {draft?.revision??'—'}</p>
 {prior&&<p className="text-sm text-zinc-300">القرار السابق: {status[prior.status]} · اعتماد {prior.revision} · مزايا {prior.benefitRevision}</p>}
 {draft?.rules.map(rule=>{const svc=services.find(s=>s.id===rule.serviceId),quote=svc&&previewBenefit(rule,svc,rule.branchIds[0],1,0,0);return <article key={rule.code} className="rounded-xl border border-zinc-700 p-3"><b>{svc?.name??'خدمة غير متاحة'} · {labels[rule.kind]}</b><p className="text-sm text-zinc-300">حد العضوية {rule.maxUsesPerMembership} · حد الفاتورة {rule.maxUsesPerInvoice} · {rule.branchIds.map(b=>b===1?'جليم':'كامب شيزار').join('، ')}</p>{quote?<p className="text-sm">السعر الأساسي {quote.originalMinor/100} ج.م · النهائي {quote.finalMinor/100} ج.م · نقاط {quote.bonusCoins}</p>:<p className="text-red-300">القاعدة تحتاج مراجعة الكتالوج</p>}</article>;})}
 <label className="block">سبب القرار<textarea className="mt-2 w-full rounded-xl border border-zinc-700 bg-zinc-900 p-3" disabled={busy} maxLength={300} value={reason} onChange={e=>setReason(e.target.value)}/></label>
 <label className="flex gap-2"><input type="checkbox" checked={confirmed} disabled={busy} onChange={e=>setConfirmed(e.target.checked)}/>راجعت النسخة والشروط وأؤكد أن هذا اعتماد للاختبار فقط.</label>
 <div className="flex flex-wrap gap-3"><button disabled={busy||!confirmed||reason.trim().length<5||!canApprove} onClick={()=>void save('APPROVE')} className="rounded-xl bg-yellow-400 px-4 py-3 font-bold text-black disabled:opacity-50">اعتماد النسخة للاختبار</button><button disabled={busy||!confirmed||reason.trim().length<5||prior?.action!=='APPROVE'} onClick={()=>void save('REVOKE')} className="rounded-xl border border-red-500/40 px-4 py-3 text-red-300 disabled:opacity-50">إلغاء الاعتماد</button></div></section>}
 </div></main>;
}

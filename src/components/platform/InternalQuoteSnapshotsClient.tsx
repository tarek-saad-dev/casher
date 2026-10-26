'use client';

import {useEffect,useState} from 'react';
import Link from 'next/link';
import {AlertCircle,Loader2,ShieldAlert} from 'lucide-react';
import {platformFetch} from '@/components/platform/platformFetch';
import type {OperatorQuoteInquiry} from '@/platform/commercial/modularInquiryReviewService';
import type {StoredCommercialCandidate} from '@/platform/commercial/commercialReleaseService';
import type {PersistedInternalQuoteSnapshot} from '@/platform/commercial/internalQuoteSnapshotService';

type InquiryQueue={requests:OperatorQuoteInquiry[];canCheckout:false;canIssueQuote:false};
type CandidateQueue={candidates:StoredCommercialCandidate[];canPublish:false;canCheckout:false};
type Archive={mode:'internal_research_snapshots';snapshots:PersistedInternalQuoteSnapshot[];
  canIssueCustomerQuote:false;canAcceptOrder:false;canCheckout:false;paid:false};
const EGP=(minor:number)=>new Intl.NumberFormat('ar-EG',{
  minimumFractionDigits:2,maximumFractionDigits:2,
}).format(minor/100)+' ج.م (بحثي)';
export default function InternalQuoteSnapshotsClient(){
 const [inquiries,setInquiries]=useState<OperatorQuoteInquiry[]>([]);
 const [candidates,setCandidates]=useState<StoredCommercialCandidate[]>([]);
 const [snapshots,setSnapshots]=useState<PersistedInternalQuoteSnapshot[]>([]);
 const [requestId,setRequestId]=useState('');
 const [candidateId,setCandidateId]=useState('');
 const [loading,setLoading]=useState(true);
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState<string|null>(null);
 const [message,setMessage]=useState<string|null>(null);
 const apply=(q:InquiryQueue,c:CandidateQueue,a:Archive)=>{
  if(q.canCheckout!==false||q.canIssueQuote!==false||
    c.canPublish!==false||c.canCheckout!==false||
    a.canIssueCustomerQuote!==false||a.canAcceptOrder!==false||
    a.canCheckout!==false||a.paid!==false)
    throw Error('حالة مالية غير متوقعة؛ تم إيقاف العرض');
  setInquiries(q.requests.filter(x=>x.status==='awaiting_pricing'));
  setCandidates(c.candidates.filter(x=>x.state==='pending_policy'&&x.canPublish===false));
  setSnapshots(a.snapshots);
 };
 const load=async()=>{
  const [q,c,a]=await Promise.all([
   platformFetch<InquiryQueue>('/api/admin/platform/modular-quote-inquiries?status=awaiting_pricing'),
   platformFetch<CandidateQueue>('/api/admin/platform/commercial-release-candidates'),
   platformFetch<Archive>('/api/admin/platform/internal-quote-snapshots'),
  ]);
  apply(q,c,a);
 };
 useEffect(()=>{
  let active=true;
  Promise.all([
   platformFetch<InquiryQueue>('/api/admin/platform/modular-quote-inquiries?status=awaiting_pricing'),
   platformFetch<CandidateQueue>('/api/admin/platform/commercial-release-candidates'),
   platformFetch<Archive>('/api/admin/platform/internal-quote-snapshots'),
  ]).then(([q,c,a])=>{if(active)apply(q,c,a);})
    .catch((e:Error)=>{if(active)setError(e.message);})
    .finally(()=>{if(active)setLoading(false);});
  return()=>{active=false;};
 },[]);
 const save=async()=>{
  if(busy||!requestId||!candidateId)return;
  setBusy(true);setError(null);setMessage(null);
  try{
   const result=await platformFetch<{
     snapshot:PersistedInternalQuoteSnapshot;canIssueCustomerQuote:false;
     canAcceptOrder:false;canCheckout:false;
   }>('/api/admin/platform/internal-quote-snapshots',{
    method:'POST',body:JSON.stringify({requestId,candidateId}),
   });
   if(result.canIssueCustomerQuote!==false||result.canAcceptOrder!==false||
      result.canCheckout!==false||result.snapshot.status!=='internal_only'||
      result.snapshot.canCheckout!==false)throw Error('تم منع رد غير آمن');
   await load();
   setMessage('حُفظت نسخة بحثية ثابتة، من غير إرسال سعر للعميل أو تفعيل اشتراك.');
  }catch(e){setError(e instanceof Error?e.message:'تعذر حفظ المحاكاة');}
  finally{setBusy(false);}
 };
 return <main dir="rtl" className="space-y-5">
  <header className="space-y-2">
   <h1 className="text-2xl font-bold">أرشيف المحاكاة الداخلية</h1>
   <p className="text-sm leading-7 text-muted-foreground">
    نسخة ثابتة من السيناريو البحثي مرتبطة بطلب العميل وملف إصدار الكتالوج.
    <strong> صلاحية النسخة 48 ساعة للأرشفة والمراجعة الداخلية فقط، وليست عرض بيع.</strong>
   </p>
  </header>
  <div className="flex flex-wrap gap-3 text-sm">
   <Link href="/platform/modular-quote-lab" className="underline">معمل الحساب</Link>
   <Link href="/platform/commercial-release" className="underline">ملفات البحث</Link>
  </div>
  {error&&<div role="alert" className="flex items-center gap-2 rounded-xl border border-rose-500/30 p-3 text-sm text-rose-600">
   <AlertCircle className="h-4 w-4"/>{error}
   <button type="button" className="mr-auto underline" onClick={()=>{setError(null);void load().catch((e:Error)=>setError(e.message));}}>إعادة التحميل</button>
  </div>}
  {message&&<p role="status" className="text-sm text-emerald-700">{message}</p>}
  {loading?<p role="status" className="flex items-center gap-2 text-sm">
   <Loader2 className="h-4 w-4 animate-spin"/>جاري تحميل الأرشيف…
  </p>:<section className="space-y-3 rounded-2xl border border-border bg-card p-5">
   <h2 className="font-semibold">حفظ نسخة محاكاة جديدة</h2>
   <div className="grid gap-3 sm:grid-cols-2">
    <label className="space-y-1 text-sm">
     <span>طلب عميل مفتوح</span>
     <select value={requestId} disabled={busy}
      onChange={e=>setRequestId(e.target.value)}
      className="w-full rounded-lg border border-border bg-background p-3">
      <option value="">اختار طلبًا</option>
      {inquiries.map(q=><option value={q.requestId} key={q.requestId}>
       {q.tenantCode} · {q.industry} · مسودة {q.draftRevision}
      </option>)}
     </select>
    </label>
    <label className="space-y-1 text-sm">
     <span>ملف بحث موثق</span>
     <select value={candidateId} disabled={busy}
      onChange={e=>setCandidateId(e.target.value)}
      className="w-full rounded-lg border border-border bg-background p-3">
      <option value="">اختار ملف بحث</option>
      {candidates.map(c=><option value={c.candidateId} key={c.candidateId}>
       {c.industry} · بحث v{c.sourceVersion}
      </option>)}
     </select>
    </label>
   </div>
   {(!inquiries.length||!candidates.length)&&<p className="text-xs text-muted-foreground">
    لازم يبقى فيه طلب مفتوح وملف بحثي تمت مراجعته بشكل مستقل.
   </p>}
   <button type="button" disabled={busy||!requestId||!candidateId}
    onClick={()=>void save()}
    className="min-h-11 rounded-lg bg-primary px-5 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50">
    {busy?'جاري الحفظ…':'حفظ نسخة داخلية غير قابلة للبيع'}
   </button>
  </section>}
  <section className="space-y-3">
   <h2 className="text-lg font-semibold">النسخ المحفوظة</h2>
   {!loading&&snapshots.length===0&&<p className="rounded-xl border border-border p-4 text-sm text-muted-foreground">
    لا توجد نسخ محفوظة بعد.
   </p>}
   {snapshots.map(s=><details key={s.snapshotId} className="rounded-xl border border-border bg-card p-4">
    <summary className="flex cursor-pointer flex-wrap items-center justify-between gap-2 text-sm">
     <span className="font-semibold">
      <ShieldAlert className="ml-2 inline h-4 w-4 text-amber-600"/>
      {s.availability==='internal_expired'?'منتهية الصلاحية':'نسخة داخلية حالية'} ·
      بحث v{s.researchVersion} · {EGP(s.researchQuote.totalPeriodMinor)}
     </span>
     <span className="text-xs text-muted-foreground">{new Date(s.createdAt).toLocaleString('ar-EG')}</span>
    </summary>
    <div className="mt-4 space-y-3">
     <p className="text-xs text-muted-foreground">معرف النسخة: {s.snapshotId}</p>
     <p className="text-xs text-muted-foreground">رقم مراجعة اختيارات العميل: {s.draftRevision}</p>
     <p className="text-xs text-muted-foreground">تنتهي داخليًا: {new Date(s.expiresAt).toLocaleString('ar-EG')}</p>
     <p className="text-xs text-muted-foreground break-all">بصمة النسخة: {s.quoteDigest}</p>
     <table className="w-full text-right text-xs">
      <thead><tr className="border-b border-border">
       <th className="p-2">البند</th><th className="p-2">العدد</th><th className="p-2">التكلفة الشهرية الافتراضية</th>
      </tr></thead>
      <tbody>{s.researchQuote.lines.map(l=><tr key={l.code} className="border-b border-border">
       <td className="p-2">{l.label}</td><td className="p-2">{l.quantity}</td>
       <td className="p-2">{EGP(l.totalMonthlyMinor)}</td>
      </tr>)}</tbody>
     </table>
     <p className="text-xs font-medium text-muted-foreground">
      ليست فاتورة ولا Quote للعميل. الضرائب والاستهلاك ورسوم الدفع غير محسوبة.
      لا يمكن قبول طلب شراء أو دفع أو تفعيل اشتراك من هذه النسخة.
     </p>
    </div>
   </details>)}
  </section>
 </main>;
}

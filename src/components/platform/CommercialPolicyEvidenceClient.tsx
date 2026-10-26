'use client';

import {useCallback,useEffect,useState} from 'react';
import Link from 'next/link';
import {AlertCircle,Loader2,ShieldAlert,CheckCircle2} from 'lucide-react';
import {platformFetch} from '@/components/platform/platformFetch';

type Status='submitted'|'reviewed_internal'|'changes_requested';
type Evidence={
  evidenceId:string;candidateId:string;blockerCode:string;revision:number;
  evidenceText:string;status:Status;submittedByUserId:number;submittedAt:string;
  reviewedByUserId:number|null;reviewedAt:string|null;reviewNote:string|null;
  canPublish:false;canCheckout:false;
};
type Data={
  mode:'internal_policy_evidence';canPublish:false;canIssueCustomerQuote:false;
  canCheckout:false;candidateId:string;sourceDigest:string;rows:Evidence[];
  summary:{latestByBlocker:Record<string,{revision:number;status:Status}|null>;
    submittedCount:number;reviewedInternalCount:number;canPublish:false};
};
const BLOCKERS:Record<string,string>={
 COMMERCIAL_PRICING_NOT_APPROVED:'أسعار التطبيقات ونموذج البيع',
 BILLING_UNIT_NOT_APPROVED:'وحدة التحصيل',
 BRANCH_QUOTAS_NOT_APPROVED:'الفروع والرسوم الإضافية',
 ANNUAL_TERMS_NOT_APPROVED:'قواعد السنوي',
 TAXES_AND_INVOICE_RULES_NOT_APPROVED:'الضرائب والفواتير',
 REFUND_PRORATION_NOT_APPROVED:'الاسترجاع وفروق الفترات',
 TRIAL_FREE_AND_USAGE_LIMITS_NOT_APPROVED:'التجربة والمجاني والاستهلاك',
 LEGAL_CONTRACT_NOT_APPROVED:'الشروط القانونية وموافقة العميل',
 GATEWAY_SETTLEMENT_NOT_VERIFIED:'التحقق من بوابة الدفع والتسوية',
 STAGING_END_TO_END_NOT_VERIFIED:'اختبارات Staging الشاملة',
};
const STATUS:Record<Status,string>={
 submitted:'بانتظار مراجعة مستقلة',
 reviewed_internal:'تمت المراجعة داخليًا (ليست موافقة بيع)',
 changes_requested:'تحتاج تحديث الدليل',
};
export default function CommercialPolicyEvidenceClient({
  candidateId,actorUserId,
}:{candidateId:string;actorUserId:number}){
 const [data,setData]=useState<Data|null>(null);
 const [edits,setEdits]=useState<Record<string,string>>({});
 const [notes,setNotes]=useState<Record<string,string>>({});
 const [busy,setBusy]=useState<string|null>(null);
 const [error,setError]=useState<string|null>(null);
 const [message,setMessage]=useState<string|null>(null);
 const [loading,setLoading]=useState(true);
 const load=useCallback(async()=>{
  const result=await platformFetch<Data>(
   '/api/admin/platform/commercial-policy-evidence?candidateId='+encodeURIComponent(candidateId));
  if(result.mode!=='internal_policy_evidence'||result.canPublish!==false||
     result.canCheckout!==false||result.summary.canPublish!==false)
   throw Error('حالة دليل اعتماد غير متوقعة');
  setData(result);
 },[candidateId]);
 useEffect(()=>{
  let active=true;
  platformFetch<Data>('/api/admin/platform/commercial-policy-evidence?candidateId='+encodeURIComponent(candidateId))
   .then(r=>{if(!active)return;
    if(r.canPublish!==false||r.canIssueCustomerQuote!==false||r.summary.canPublish!==false)
     throw Error('حالة مراجعة غير آمنة');
    setData(r);
   }).catch((e:Error)=>{if(active)setError(e.message);})
   .finally(()=>{if(active)setLoading(false);});
  return()=>{active=false;};
 },[candidateId]);
 const submit=async(code:string)=>{
  if(busy)return;
  setBusy(code);setError(null);setMessage(null);
  try{
   const r=await platformFetch<{evidence:Evidence;canPublish:false;canCheckout:false}>(
    '/api/admin/platform/commercial-policy-evidence',{
     method:'POST',body:JSON.stringify({
      candidateId,blockerCode:code,evidenceText:edits[code]??'',
     }),
    });
   if(r.canPublish!==false||r.canCheckout!==false)throw Error('حالة غير متوقعة');
   setEdits(prev=>({...prev,[code]:''}));
   await load();setMessage('تم حفظ الدليل للمراجعة، دون اعتماد البيع.');
  }catch(e){setError(e instanceof Error?e.message:'تعذر حفظ الدليل');}
  finally{setBusy(null);}
 };
 const review=async(evidence:Evidence,action:'reviewed_internal'|'changes_requested')=>{
  if(busy)return;
  setBusy(evidence.evidenceId);setError(null);setMessage(null);
  try{
   const r=await platformFetch<{evidence:Evidence;canPublish:false;canCheckout:false}>(
    '/api/admin/platform/commercial-policy-evidence',{
     method:'PATCH',body:JSON.stringify({
      evidenceId:evidence.evidenceId,action,note:notes[evidence.evidenceId]??'',
     }),
    });
   if(r.canPublish!==false||r.canCheckout!==false)throw Error('حالة غير متوقعة');
   setNotes(prev=>({...prev,[evidence.evidenceId]:''}));
   await load();setMessage('اتسجلت نتيجة المراجعة، ولم يتم نشر أي أسعار.');
  }catch(e){setError(e instanceof Error?e.message:'تعذر مراجعة الدليل');}
  finally{setBusy(null);}
 };
 return <main dir="rtl" className="space-y-5">
  <Link href="/platform/commercial-release" className="text-sm underline">العودة إلى ملفات الإصدارات</Link>
  <header className="space-y-2">
   <h1 className="text-2xl font-bold">مراجعة أدلة إطلاق الكتالوج</h1>
   <p className="text-sm leading-7 text-muted-foreground">
    سجّل القرار أو الدليل المرجعي لكل شرط. لازم مشغّل تاني يراجعه.
    <strong> المراجعة هنا للتوثيق فقط، ومش بتزيل شروط منع البيع أو تنشر الكتالوج.</strong>
   </p>
  </header>
  {error&&<div role="alert" className="flex items-center gap-2 rounded-xl border border-rose-500/30 p-3 text-sm text-rose-600">
   <AlertCircle className="h-4 w-4"/>{error}
   <button type="button" className="mr-auto underline" onClick={()=>{setError(null);void load().catch((e:Error)=>setError(e.message));}}>إعادة التحميل</button>
  </div>}
  {message&&<p role="status" className="flex items-center gap-2 text-sm text-emerald-600">
   <CheckCircle2 className="h-4 w-4"/>{message}
  </p>}
  {loading?<p role="status" className="flex items-center gap-2 text-sm"><Loader2 className="h-4 w-4 animate-spin"/>جاري التحميل…</p>:
   data&&<>
    <div className="rounded-2xl border border-border p-4 space-y-2">
     <p className="flex items-center gap-2 text-sm font-semibold">
      <ShieldAlert className="h-4 w-4 text-amber-600"/>ملف الإصدار غير معتمد للبيع
     </p>
     <p className="text-xs text-muted-foreground">
      تمت مراجعة {data.summary.reviewedInternalCount} من {Object.keys(BLOCKERS).length} داخليًا، وفي انتظار {data.summary.submittedCount} مراجعة.
     </p>
     <p className="text-xs text-muted-foreground break-all">بصمة المصدر: {data.sourceDigest}</p>
    </div>
    <div className="space-y-2">{Object.entries(BLOCKERS).map(([code,label])=>{
     const revisions=data.rows.filter(x=>x.blockerCode===code).sort((a,b)=>b.revision-a.revision);
     const latest=revisions[0];
     return <details key={code} className="rounded-xl border border-border bg-card p-4">
      <summary className="cursor-pointer text-sm font-semibold">
       {label} · {latest?STATUS[latest.status]:'لم يُقدّم دليل'}
      </summary>
      <div className="mt-3 space-y-3">
       {latest&&<div className="space-y-1 text-sm">
        <p className="whitespace-pre-wrap">{latest.evidenceText}</p>
        <p className="text-xs text-muted-foreground">إصدار #{latest.revision} · بواسطة #{latest.submittedByUserId} · {new Date(latest.submittedAt).toLocaleString('ar-EG')}</p>
        {latest.reviewNote&&<p className="text-xs text-muted-foreground">ملاحظة المراجع #{latest.reviewedByUserId}: {latest.reviewNote}</p>}
       </div>}
       {latest?.status==='submitted'&&latest.submittedByUserId!==actorUserId&&<>
        <textarea rows={2} maxLength={500} disabled={busy!==null}
         value={notes[latest.evidenceId]??''}
         onChange={e=>setNotes(v=>({...v,[latest.evidenceId]:e.target.value}))}
         placeholder="ملاحظة المراجع (إجبارية)"
         className="w-full rounded-lg border border-border bg-background p-3 text-sm"/>
        <div className="flex flex-wrap gap-2">
         <button type="button" disabled={busy!==null||!notes[latest.evidenceId]?.trim()}
          onClick={()=>void review(latest,'reviewed_internal')}
          className="min-h-10 rounded-lg border border-border px-3 text-sm disabled:opacity-50">تمت المراجعة الداخلية</button>
         <button type="button" disabled={busy!==null||!notes[latest.evidenceId]?.trim()}
          onClick={()=>void review(latest,'changes_requested')}
          className="min-h-10 rounded-lg border border-border px-3 text-sm disabled:opacity-50">طلب تعديل الدليل</button>
        </div>
       </>}
       {latest?.status==='submitted'&&latest.submittedByUserId===actorUserId&&
        <p className="text-xs text-muted-foreground">الدليل بانتظار شخص مختلف للمراجعة.</p>}
       {(!latest||latest.status!=='submitted')&&<>
        <textarea rows={3} maxLength={1000} disabled={busy!==null}
         value={edits[code]??''}
         onChange={e=>setEdits(v=>({...v,[code]:e.target.value}))}
         placeholder="اكتب القرار المرجعي، المتطلبات، أو نتيجة الاختبار. ده مش اعتماد تجاري."
         className="w-full rounded-lg border border-border bg-background p-3 text-sm"/>
        <button type="button" disabled={busy!==null||!edits[code]?.trim()}
         onClick={()=>void submit(code)}
         className="min-h-10 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-50">
         تسجيل إصدار دليل جديد
        </button>
       </>}
       {revisions.length>1&&<details className="text-xs text-muted-foreground">
        <summary className="cursor-pointer">السجل السابق ({revisions.length-1})</summary>
        {revisions.slice(1).map(v=><p key={v.evidenceId} className="mt-2 whitespace-pre-wrap">
         #{v.revision} · {STATUS[v.status]} · {v.evidenceText}
        </p>)}
       </details>}
      </div>
     </details>;
    })}</div>
    <p className="text-xs text-muted-foreground">
     مهما اكتملت المراجعات، يظل النشر وإنشاء عروض الأسعار المدفوعة وإصدار الطلبات والتفعيل غير متاحين حتى اعتماد السياسات رسميًا.
    </p>
   </>}
 </main>;
}

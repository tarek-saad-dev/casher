'use client';

import {useEffect,useState} from 'react';
import {AlertCircle,Check,Loader2} from 'lucide-react';
import {platformFetch} from '@/components/platform/platformFetch';
import type {InquiryReviewOutcome,OperatorQuoteInquiry} from '@/platform/commercial/modularInquiryReviewService';

const OUTCOMES:Record<InquiryReviewOutcome,string>={
  follow_up_recorded:'تمت المتابعة (دون تسعير)',
  not_applicable:'الطلب غير مناسب',
  duplicate:'طلب مكرر',
};
type Queue={mode:'unpriced_inquiry_review_only';canIssueQuote:false;canAcceptOrder:false;
  canCheckout:false;paid:false;requests:OperatorQuoteInquiry[]};

export default function OperatorModularInquiryQueue(){
  const [status,setStatus]=useState<'awaiting_pricing'|'closed'>('awaiting_pricing');
  const [rows,setRows]=useState<OperatorQuoteInquiry[]>([]);
  const [notes,setNotes]=useState<Record<string,string>>({});
  const [outcomes,setOutcomes]=useState<Record<string,InquiryReviewOutcome>>({});
  const [busy,setBusy]=useState<string|null>(null);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState<string|null>(null);
  const load=async(s:typeof status)=>{
    const payload=await platformFetch<Queue>('/api/admin/platform/modular-quote-inquiries?status='+s);
    if(payload.mode!=='unpriced_inquiry_review_only'||payload.canCheckout!==false||payload.paid!==false){
      throw new Error('حالة الطلبات غير متوقعة');
    }
    setRows(payload.requests);
  };
  useEffect(()=>{
    let active=true;
    setLoading(true);setError(null);
    platformFetch<Queue>('/api/admin/platform/modular-quote-inquiries?status='+status)
      .then(p=>{if(active){
        if(p.canIssueQuote!==false||p.canAcceptOrder!==false)throw Error('Invalid commercial status');
        setRows(p.requests);
      }})
      .catch((e:Error)=>{if(active)setError(e.message);})
      .finally(()=>{if(active)setLoading(false);});
    return()=>{active=false;};
  },[status]);
  const close=async(requestId:string)=>{
    const note=notes[requestId]?.trim()??'';
    if(!note){setError('لازم تسجل ملاحظة قبل إغلاق الطلب');return;}
    setBusy(requestId);setError(null);
    try{
      const result=await platformFetch<{ok:true;paid:false;orderCreated:false;canCheckout:false}>(
        '/api/admin/platform/modular-quote-inquiries',{
          method:'PATCH',body:JSON.stringify({requestId,outcome:outcomes[requestId]??'follow_up_recorded',note}),
        });
      if(result.paid!==false||result.orderCreated!==false||result.canCheckout!==false)
        throw Error('حالة المراجعة غير متوقعة');
      await load(status);
    }catch(e){setError(e instanceof Error?e.message:'تعذر إغلاق الطلب');}
    finally{setBusy(null);}
  };
  return <main dir="rtl" className="space-y-4">
    <header className="space-y-1">
      <h1 className="text-2xl font-bold">طلبات مراجعة تكلفة التطبيقات</h1>
      <p className="text-sm text-muted-foreground">
        دي طلبات اهتمام فقط، مش عروض أسعار نهائية أو Orders. كل طلب بيحفظ اختيارات العميل وقت الإرسال.
      </p>
    </header>
    <div className="flex gap-2">
      {(['awaiting_pricing','closed'] as const).map(s=><button type="button" key={s}
        onClick={()=>setStatus(s)}
        aria-pressed={status===s}
        className={'min-h-10 rounded-xl border px-4 py-2 text-sm '+(status===s?'border-primary bg-muted':'border-border')}>
        {s==='awaiting_pricing'?'تحتاج متابعة':'طلبات مغلقة'}
      </button>)}
    </div>
    {error&&<div role="alert" className="flex items-center gap-2 rounded-xl border border-rose-500/30 p-3 text-sm text-rose-600">
      <AlertCircle className="h-4 w-4"/>{error}
      <button type="button" onClick={()=>{setError(null);void load(status).catch((e:Error)=>setError(e.message));}} className="mr-auto underline">إعادة التحميل</button>
    </div>}
    {loading?<p role="status" className="flex items-center gap-2 text-sm"><Loader2 className="h-4 w-4 animate-spin"/>جاري التحميل…</p>:
      rows.length===0?<p className="rounded-2xl border border-border p-6 text-sm text-muted-foreground">لا توجد طلبات في الحالة دي.</p>:
      <div className="space-y-3">{rows.map(r=><article key={r.requestId} className="space-y-3 rounded-2xl border border-border bg-card p-4">
        <div className="flex flex-wrap justify-between gap-3">
          <div>
            <h3 className="font-semibold">{r.tenantCode} · {r.industry==='salon'?'صالون':r.industry==='supermarket'?'سوبر ماركت':r.industry}</h3>
            <p className="text-xs text-muted-foreground">
              {r.billingCycle==='annual'?'سنوي':'شهري'} · {r.branches} فرع · مسودة #{r.draftRevision}
              {' · '}{new Date(r.createdAt).toLocaleString('ar-EG')}
            </p>
          </div>
          <span className="rounded-full border border-border px-3 py-1 text-xs text-muted-foreground">
            {r.status==='closed'?'تمت المراجعة':'بانتظار التسعير'}
          </span>
        </div>
        <p className="text-sm"><span className="text-muted-foreground">التطبيقات المطلوبة: </span>
          {r.apps.join('، ')}</p>
        {r.status==='closed'?<div className="space-y-1 text-sm text-muted-foreground">
          <p>{r.reviewOutcome?OUTCOMES[r.reviewOutcome]:'مغلق'}</p>
          {r.reviewNote&&<p>الملاحظة: {r.reviewNote}</p>}
          {r.reviewedAt&&<p className="text-xs">تاريخ المراجعة: {new Date(r.reviewedAt).toLocaleString('ar-EG')}</p>}
        </div>:<>
          <label className="block space-y-1 text-sm">
            <span>نتيجة المتابعة</span>
            <select className="w-full rounded-xl border border-border bg-background p-2" disabled={busy!==null}
              value={outcomes[r.requestId]??'follow_up_recorded'}
              onChange={e=>setOutcomes(old=>({...old,[r.requestId]:e.target.value as InquiryReviewOutcome}))}>
              {Object.entries(OUTCOMES).map(([value,label])=><option key={value} value={value}>{label}</option>)}
            </select>
          </label>
          <label className="block space-y-1 text-sm">
            <span>ملاحظة المتابعة (إجباري)</span>
            <textarea value={notes[r.requestId]??''} rows={2} maxLength={500}
              onChange={e=>setNotes(old=>({...old,[r.requestId]:e.target.value}))}
              placeholder="ملخص التواصل أو سبب إغلاق الطلب"
              className="w-full rounded-xl border border-border bg-background p-3"/>
          </label>
          <div className="flex justify-end">
            <button type="button" disabled={busy!==null||!notes[r.requestId]?.trim()}
              onClick={()=>void close(r.requestId)}
              className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50">
              {busy===r.requestId?<Loader2 className="h-4 w-4 animate-spin"/>:<Check className="h-4 w-4"/>}
              تسجيل المتابعة وإغلاق الطلب
            </button>
          </div>
        </>}
      </article>)}</div>}
    <p className="text-xs leading-6 text-muted-foreground">
      إغلاق الطلب لا يعتمد سعرًا، ولا يصدر فاتورة، ولا يغيّر التطبيقات أو الاشتراك، ولا يثبت تحصيل أي مبلغ.
    </p>
  </main>;
}

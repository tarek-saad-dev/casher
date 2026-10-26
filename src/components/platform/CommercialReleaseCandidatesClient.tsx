'use client';

import {useEffect,useState} from 'react';
import Link from 'next/link';
import {AlertCircle,Loader2,ShieldAlert} from 'lucide-react';
import {platformFetch} from '@/components/platform/platformFetch';

type Candidate={
  candidateId:string;sourceProposalId:string;sourceVersion:number;industry:string;
  sourceDigest:string;state:'pending_policy';createdAt:string;requestedByUserId:number;
  canPublish:false;canIssueCustomerQuote:false;canAcceptOrder:false;
  canCheckout:false;canActivate:false;blockers:string[];
};
type Proposal={proposalId:string;version:number;status:string;industry:string};
type Responses={
  candidates:{canPublish:false;canCheckout:false;candidates:Candidate[]};
  research:{approvedForSale:false;canCheckout:false;proposals:Proposal[]};
};
const TITLES:Record<string,string>={
  COMMERCIAL_PRICING_NOT_APPROVED:'اعتماد أسعار التطبيقات الفعلية ونموذج رسوم المنصة',
  BILLING_UNIT_NOT_APPROVED:'تحديد وحدة التحصيل: تطبيقات أم رسوم أساسية أم نموذج مختلط',
  BRANCH_QUOTAS_NOT_APPROVED:'اعتماد عدد الفروع المشمولة ورسوم الفرع الإضافي',
  ANNUAL_TERMS_NOT_APPROVED:'اعتماد الخصم والمدة السنوية',
  TAXES_AND_INVOICE_RULES_NOT_APPROVED:'اعتماد الضرائب والفواتير وطريقة عرض السعر',
  REFUND_PRORATION_NOT_APPROVED:'اعتماد الاسترجاع وفروق الترقية والتخفيض',
  TRIAL_FREE_AND_USAGE_LIMITS_NOT_APPROVED:'اعتماد قواعد التجربة والاستخدام المدفوع والرصيد المجاني',
  LEGAL_CONTRACT_NOT_APPROVED:'اعتماد الشروط القانونية ونص موافقة العميل',
  GATEWAY_SETTLEMENT_NOT_VERIFIED:'ربط بوابة دفع موثوقة والتحقق من التسوية',
  STAGING_END_TO_END_NOT_VERIFIED:'اختبار رحلة البيع كاملة على Staging وعزل الشركات',
};
export default function CommercialReleaseCandidatesClient(){
  const [candidates,setCandidates]=useState<Candidate[]>([]);
  const [research,setResearch]=useState<Proposal[]>([]);
  const [sourceId,setSourceId]=useState('');
  const [loading,setLoading]=useState(true);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState<string|null>(null);
  const [note,setNote]=useState<string|null>(null);
  const load=async()=>{
    const [a,b]=await Promise.all([
      platformFetch<Responses['candidates']>('/api/admin/platform/commercial-release-candidates'),
      platformFetch<Responses['research']>('/api/admin/platform/tariff-research'),
    ]);
    if(a.canPublish!==false||a.canCheckout!==false||
       b.approvedForSale!==false||b.canCheckout!==false)throw Error('حالة كتالوج غير آمنة');
    setCandidates(a.candidates);
    setResearch(b.proposals.filter(p=>p.status==='reviewed_research'));
  };
  useEffect(()=>{
    let active=true;
    Promise.all([
      platformFetch<Responses['candidates']>('/api/admin/platform/commercial-release-candidates'),
      platformFetch<Responses['research']>('/api/admin/platform/tariff-research'),
    ]).then(([a,b])=>{
      if(!active)return;
      if(a.canPublish!==false||a.canCheckout!==false||
         b.approvedForSale!==false||b.canCheckout!==false)throw Error('حالة كتالوج غير آمنة');
      setCandidates(a.candidates);
      setResearch(b.proposals.filter(p=>p.status==='reviewed_research'));
    }).catch((e:Error)=>{if(active)setError(e.message);})
      .finally(()=>{if(active)setLoading(false);});
    return()=>{active=false;};
  },[]);
  const prepare=async()=>{
    if(!sourceId||busy)return;
    setBusy(true);setError(null);setNote(null);
    try{
      const res=await platformFetch<{candidate:Candidate;canPublish:false;canCheckout:false}>(
        '/api/admin/platform/commercial-release-candidates',{
          method:'POST',body:JSON.stringify({sourceProposalId:sourceId}),
        });
      if(res.canPublish!==false||res.canCheckout!==false||
         res.candidate.canPublish!==false||res.candidate.canCheckout!==false)
        throw Error('حالة غير آمنة');
      await load();
      setNote('تم تجهيز ملف الإصدار فقط. الأسعار غير معتمدة ولم تُنشر للعملاء.');
    }catch(e){setError(e instanceof Error?e.message:'تعذر تجهيز الملف');}
    finally{setBusy(false);}
  };
  return <main dir="rtl" className="space-y-5">
    <header className="space-y-2">
      <h1 className="text-2xl font-bold">تجهيز اعتماد كتالوج الأسعار</h1>
      <p className="text-sm leading-7 text-muted-foreground">
        جهّز ملف إصدار من بحث راجعه شخص مستقل، وحدد المطلوب قبل البيع.
        <strong> تجهيز الملف مش اعتماد ولا نشر للأسعار.</strong>
      </p>
    </header>
    <p className="text-sm"><Link className="underline" href="/platform/tariff-research">الأبحاث السعرية ومراجعتها</Link></p>
    {error&&<div role="alert" className="flex items-center gap-2 rounded-xl border border-rose-500/30 p-3 text-sm text-rose-600">
      <AlertCircle className="h-4 w-4"/>{error}
      <button type="button" className="mr-auto underline" onClick={()=>{setError(null);void load().catch((e:Error)=>setError(e.message));}}>إعادة المحاولة</button>
    </div>}
    {note&&<p role="status" className="text-sm text-emerald-600">{note}</p>}
    {loading?<p role="status" className="flex items-center gap-2 text-sm"><Loader2 className="h-4 w-4 animate-spin"/>جاري التحميل…</p>:
      <section className="space-y-3 rounded-2xl border border-border bg-card p-5">
        <label className="block space-y-2 text-sm">
          <span>نسخة بحثية تمت مراجعتها</span>
          <select value={sourceId} onChange={e=>setSourceId(e.target.value)}
            disabled={busy} className="w-full rounded-xl border border-border bg-background p-3">
            <option value="">اختار نسخة البحث</option>
            {research.map(p=><option key={p.proposalId} value={p.proposalId}>
              {p.industry} · إصدار {p.version}
            </option>)}
          </select>
        </label>
        <button type="button" onClick={()=>void prepare()} disabled={!sourceId||busy}
          className="min-h-11 rounded-xl bg-primary px-5 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50">
          {busy?'جاري التجهيز…':'تجهيز ملف مراجعة الإصدار'}
        </button>
        {!research.length&&<p className="text-xs text-muted-foreground">يلزم وجود مقترح أسعار راجعه شخص مستقل.</p>}
      </section>}
    <section className="space-y-3">
      <h2 className="text-lg font-semibold">ملفات الإصدارات المرشحة</h2>
      {!loading&&candidates.length===0&&<p className="text-sm text-muted-foreground">لا توجد ملفات إصدار محفوظة.</p>}
      {candidates.map(c=><article key={c.candidateId} className="space-y-3 rounded-2xl border border-border p-4">
        <div className="flex items-center gap-2"><ShieldAlert className="h-5 w-5 text-amber-600"/>
          <h3 className="font-semibold">إصدار بحثي {c.sourceVersion} · في انتظار القرار التجاري</h3>
        </div>
        <p className="text-xs text-muted-foreground">بصمة المصدر: <code className="break-all">{c.sourceDigest}</code></p>
        <p className="text-xs text-muted-foreground">تم التجهيز: {new Date(c.createdAt).toLocaleString('ar-EG')}</p>
        <h4 className="text-sm font-semibold">الاعتمادات الناقصة قبل البيع</h4>
        <ul className="list-disc space-y-1 pr-5 text-sm text-muted-foreground">
          {c.blockers.map(b=><li key={b}>{TITLES[b]??b}</li>)}
        </ul>
        <p className="text-xs font-medium text-muted-foreground">
          لا يمكن من هنا نشر أسعار أو إرسال Quote أو إنشاء Order أو تحصيل أو تفعيل.
        </p>
      </article>)}
    </section>
  </main>;
}

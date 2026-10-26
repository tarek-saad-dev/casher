'use client';

import {useEffect,useState} from 'react';
import Link from 'next/link';
import {AlertCircle,Loader2,ShieldAlert} from 'lucide-react';
import {platformFetch} from '@/components/platform/platformFetch';
import type {OperatorQuoteInquiry} from '@/platform/commercial/modularInquiryReviewService';
import type {TariffResearchProposal} from '@/platform/commercial/tariffResearchService';
import type {QuoteLabSimulation} from '@/platform/commercial/modularQuoteLab';

type InquiryQueue={requests:OperatorQuoteInquiry[];canCheckout:false;canIssueQuote:false};
type ResearchQueue={proposals:TariffResearchProposal[];approvedForSale:false;canCheckout:false};
const BLOCKER_LABELS:Record<string,string>={
  UNAPPROVED_COMMERCIAL_TARIFF:'التعريفة التجارية لم تعتمد للبيع.',
  TAX_AND_GATEWAY_FEES_UNRESOLVED:'الضرائب ورسوم بوابات الدفع غير معتمدة.',
  TRIAL_FREE_ALLOWANCE_AND_USAGE_TARIFFS_UNRESOLVED:'قواعد التجربة والمجاني ورسوم الاستهلاك غير مكتملة.',
  REFUNDS_PRORATION_AND_TERMS_UNRESOLVED:'الاسترجاع وتوزيع فروق الفترات وشروط الاشتراك لم تعتمد.',
  CHECKOUT_SETTLEMENT_AND_ENTITLEMENTS_NOT_LIVE:'الدفع والتحقق والتفعيل المدفوع غير متاحين.',
};
const egp=(minor:number)=>new Intl.NumberFormat('ar-EG',{
  minimumFractionDigits:2,maximumFractionDigits:2,
}).format(minor/100)+' ج.م';
export default function ModularQuoteLabClient(){
  const [inquiries,setInquiries]=useState<OperatorQuoteInquiry[]>([]);
  const [proposals,setProposals]=useState<TariffResearchProposal[]>([]);
  const [requestId,setRequestId]=useState('');
  const [proposalId,setProposalId]=useState('');
  const [simulation,setSimulation]=useState<QuoteLabSimulation|null>(null);
  const [loading,setLoading]=useState(true);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState<string|null>(null);
  const load=async()=>{
    const [requests,research]=await Promise.all([
      platformFetch<InquiryQueue>('/api/admin/platform/modular-quote-inquiries?status=awaiting_pricing'),
      platformFetch<ResearchQueue>('/api/admin/platform/tariff-research'),
    ]);
    if(requests.canCheckout!==false||requests.canIssueQuote!==false||
       research.approvedForSale!==false||research.canCheckout!==false)
      throw new Error('حالة بيانات البحث غير متوقعة');
    setInquiries(requests.requests);
    setProposals(research.proposals.filter(p=>p.status==='reviewed_research'));
  };
  useEffect(()=>{
    let live=true;
    Promise.all([
      platformFetch<InquiryQueue>('/api/admin/platform/modular-quote-inquiries?status=awaiting_pricing'),
      platformFetch<ResearchQueue>('/api/admin/platform/tariff-research'),
    ]).then(([requests,research])=>{
      if(!live)return;
      if(requests.canCheckout!==false||requests.canIssueQuote!==false||
         research.approvedForSale!==false||research.canCheckout!==false)
        throw Error('حالة البيانات غير متوقعة');
      setInquiries(requests.requests);
      setProposals(research.proposals.filter(p=>p.status==='reviewed_research'));
    }).catch((e:Error)=>{if(live)setError(e.message);})
      .finally(()=>{if(live)setLoading(false);});
    return()=>{live=false;};
  },[]);
  const simulate=async()=>{
    if(!requestId||!proposalId||busy)return;
    setBusy(true);setError(null);setSimulation(null);
    try{
      const result=await platformFetch<QuoteLabSimulation>('/api/admin/platform/modular-quote-lab',{
        method:'POST',body:JSON.stringify({requestId,proposalId}),
      });
      if(result.mode!=='operator_internal_research_simulation'||
         result.canIssueCustomerQuote!==false||result.canAcceptOrder!==false||
         result.canCheckout!==false||result.canActivate!==false||result.paid!==false||
         result.researchQuote.canCheckout!==false||result.researchQuote.approvedForSale!==false)
        throw Error('حالة المحاكاة غير متوقعة');
      setSimulation(result);
    }catch(e){setError(e instanceof Error?e.message:'تعذر حساب المحاكاة');}
    finally{setBusy(false);}
  };
  return <main dir="rtl" className="space-y-5">
    <header className="space-y-2">
      <h1 className="text-2xl font-bold">معمل عروض الأسعار الداخلي</h1>
      <p className="text-sm leading-7 text-muted-foreground">
        حساب توضيحي لفريق المنصة فقط، من طلب مسجل ونسخة بحثية راجعها شخص مستقل.
        <strong> النتيجة ليست عرض سعر للعميل، ولا يمكن دفعها أو قبولها أو تفعيل اشتراك بها.</strong>
      </p>
    </header>
    <div className="flex flex-wrap gap-3 text-sm">
      <Link href="/platform/modular-quote-inquiries" className="underline">طلبات العملاء</Link>
      <Link href="/platform/tariff-research" className="underline">مراجعة الأبحاث السعرية</Link>
    </div>
    {error&&<div role="alert" className="flex flex-wrap items-center gap-2 rounded-xl border border-rose-500/30 p-3 text-sm text-rose-600">
      <AlertCircle className="h-4 w-4"/>{error}
      <button type="button" className="mr-auto underline"
        onClick={()=>{setError(null);void load().catch((e:Error)=>setError(e.message));}}>إعادة التحميل</button>
    </div>}
    {loading?<p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
      <Loader2 className="h-4 w-4 animate-spin"/>جاري تحميل المصادر…
    </p>:<section className="space-y-4 rounded-2xl border border-border bg-card p-5">
      <div className="grid gap-4 md:grid-cols-2">
        <label className="space-y-2 text-sm">
          <span>طلب العميل المسجل (مفتوح)</span>
          <select value={requestId} disabled={busy}
            onChange={e=>{setRequestId(e.target.value);setSimulation(null);}}
            className="w-full rounded-xl border border-border bg-background p-3">
            <option value="">اختار طلب</option>
            {inquiries.map(r=><option value={r.requestId} key={r.requestId}>
              {r.tenantCode} · {r.industry} · مسودة {r.draftRevision} · {r.branches} فرع
            </option>)}
          </select>
        </label>
        <label className="space-y-2 text-sm">
          <span>إصدار بحث أسعار مُراجَع</span>
          <select value={proposalId} disabled={busy}
            onChange={e=>{setProposalId(e.target.value);setSimulation(null);}}
            className="w-full rounded-xl border border-border bg-background p-3">
            <option value="">اختار إصدار البحث</option>
            {proposals.map(p=><option value={p.proposalId} key={p.proposalId}>
              {p.industry} · إصدار {p.version} · {p.pricingModel==='per_app'?'لكل تطبيق':'رسوم أساسية وتطبيقات'}
            </option>)}
          </select>
        </label>
      </div>
      {(!inquiries.length||!proposals.length)&&<p className="text-sm text-muted-foreground">
        المحاكاة تحتاج طلبًا مفتوحًا ومقترحًا بحثيًا تمت مراجعته من شخص مختلف.
      </p>}
      <button type="button" disabled={busy||!requestId||!proposalId}
        onClick={()=>void simulate()}
        className="min-h-11 rounded-xl bg-primary px-5 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50">
        {busy?'جاري الحساب…':'احسب المحاكاة الداخلية'}
      </button>
    </section>}
    {simulation&&<section className="space-y-4 rounded-2xl border border-border p-5">
      <div className="flex items-center gap-2">
        <ShieldAlert className="h-5 w-5 text-amber-600"/>
        <h2 className="text-lg font-bold">نتيجة بحثية فقط — غير معتمدة للبيع</h2>
      </div>
      <p className="text-xs text-muted-foreground">
        {simulation.tenantCode} · بحث رقم {simulation.proposalVersion} · {simulation.pricingModel} ·
        {simulation.researchQuote.cycle==='annual'?' سنوي':' شهري'} · {simulation.researchQuote.branches} فرع
      </p>
      <div className="overflow-auto">
        <table className="w-full text-right text-sm">
          <thead><tr className="border-b border-border text-muted-foreground">
            <th className="p-2">البند البحثي</th><th className="p-2">العدد</th>
            <th className="p-2">الوحدة شهريًا</th><th className="p-2">الإجمالي شهريًا</th>
          </tr></thead>
          <tbody>{simulation.researchQuote.lines.map(line=><tr key={line.code} className="border-b border-border">
            <td className="p-2">{line.label}</td><td className="p-2">{line.quantity}</td>
            <td className="p-2">{egp(line.unitMonthlyMinor)}</td>
            <td className="p-2">{egp(line.totalMonthlyMinor)}</td>
          </tr>)}</tbody>
        </table>
      </div>
      <div className="space-y-1 border-t border-border pt-3 text-sm">
        <p><b>الإجمالي الشهري الافتراضي:</b> {egp(simulation.researchQuote.totalMonthlyMinor)}</p>
        <p><b>مجموع الفترة الافتراضي:</b> {egp(simulation.researchQuote.totalPeriodMinor)} · {simulation.researchQuote.chargedMonths} شهر محتسب</p>
        <p className="text-xs text-muted-foreground">لا يشمل تقدير الضرائب أو رسوم الدفع أو الخدمات بحسب الاستخدام. المبلغ غير مستحق الدفع.</p>
      </div>
      <div className="space-y-2">
        <h3 className="font-semibold">ليه ممنوع إصدار سعر بيع من المحاكاة؟</h3>
        <ul className="list-disc space-y-1 pr-5 text-sm text-muted-foreground">
          {simulation.commercialBlockers.map(code=><li key={code}>{BLOCKER_LABELS[code]??code}</li>)}
        </ul>
      </div>
      <p className="text-xs font-medium text-muted-foreground">
        لا يوجد زر إصدار عرض، ولا موافقة شراء، ولا دفع أو تفعيل. المطلوب اعتماد القرارات التجارية وتدقيقها بشكل منفصل.
      </p>
    </section>}
  </main>;
}

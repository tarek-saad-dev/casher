'use client';

import {useEffect,useState} from 'react';
import {AlertCircle,CheckCircle2,Loader2} from 'lucide-react';
import {platformFetch} from '@/components/platform/platformFetch';
import {appManagerLabel} from '@/platform/apps/selfServiceAppManager';
import type {TariffResearchProposal} from '@/platform/commercial/tariffResearchService';

type Queue={
  scope:'internal_research';approvedForSale:false;canCheckout:false;canActivate:false;
  allowedApps:string[];proposals:TariffResearchProposal[];
};
const STATUSES:Record<string,string>={
  submitted:'بانتظار المراجعة',reviewed_research:'تمت المراجعة البحثية فقط',
  changes_requested:'تحتاج تعديلًا (أنشئ إصدارًا جديدًا)',
};
const MONEY=/^(0|[1-9]\d{0,10})(?:\.(\d{1,2}))?$/;
function egpToMinor(raw:string):number {
  const value=raw.trim();
  const m=MONEY.exec(value);
  if(!m)throw new Error('كل قيمة مالية لازم تكون بالجنيه، وبحد أقصى رقمين بعد العلامة');
  const [whole,fraction='']=value.split('.');
  const n=Number(whole)*100+Number(fraction.padEnd(2,'0')||'0');
  if(!Number.isSafeInteger(n)||n>1_000_000_000_000)
    throw new Error('القيمة أكبر من الحد المسموح');
  return n;
}
function formatMinor(value:number):string {
  return new Intl.NumberFormat('ar-EG',{minimumFractionDigits:2,maximumFractionDigits:2}).format(value/100)+' ج.م (افتراضي)';
}
export default function TariffResearchClient({actorUserId}:{actorUserId:number}){
  const [queue,setQueue]=useState<Queue|null>(null);
  const [values,setValues]=useState<Record<string,string>>({});
  const [base,setBase]=useState('');
  const [branch,setBranch]=useState('');
  const [branches,setBranches]=useState('1');
  const [annual,setAnnual]=useState('');
  const [model,setModel]=useState<'per_app'|'base_plus_apps'>('per_app');
  const [notes,setNotes]=useState<Record<string,string>>({});
  const [loading,setLoading]=useState(true);
  const [busy,setBusy]=useState<string|null>(null);
  const [error,setError]=useState<string|null>(null);
  const [message,setMessage]=useState<string|null>(null);
  const read=async()=>{
    const r=await platformFetch<Queue>('/api/admin/platform/tariff-research');
    if(r.scope!=='internal_research'||r.approvedForSale!==false||r.canCheckout!==false||
       r.canActivate!==false)throw Error('حالة البحث غير متوقعة');
    setQueue(r);
  };
  useEffect(()=>{
    let mounted=true;
    platformFetch<Queue>('/api/admin/platform/tariff-research')
      .then(r=>{
        if(mounted){
          if(r.scope!=='internal_research'||r.approvedForSale!==false||r.canCheckout!==false)
            throw Error('حالة البحث غير متوقعة');
          setQueue(r);
        }
      })
      .catch((e:Error)=>{if(mounted)setError(e.message);})
      .finally(()=>{if(mounted)setLoading(false);});
    return()=>{mounted=false;};
  },[]);
  const create=async()=>{
    if(!queue||busy)return;
    setBusy('create');setError(null);setMessage(null);
    try{
      const appPricesMinor:Record<string,number>={};
      for(const code of queue.allowedApps){
        if((values[code]??'').trim()==='')throw Error('لازم تدخل افتراض سعر لكل تطبيق، ولو صفر اكتب 0 صراحة');
        appPricesMinor[code]=egpToMinor(values[code]);
      }
      if(!base.trim()||!branch.trim()||!annual.trim())
        throw Error('اكتب كل افتراضات الرسوم والمدة السنوية، ولو الرسم صفر اكتبه صراحة');
      const includedBranches=Number(branches),annualMonthsCharged=Number(annual);
      if(!Number.isInteger(includedBranches)||includedBranches<1||includedBranches>20||
         !Number.isInteger(annualMonthsCharged)||annualMonthsCharged<1||annualMonthsCharged>12)
        throw Error('الفروع من 1 لـ20، والشهور المحصّلة في السنة من 1 لـ12');
      const result=await platformFetch<{proposal:TariffResearchProposal;approvedForSale:false;canCheckout:false}>(
        '/api/admin/platform/tariff-research',{
          method:'POST',body:JSON.stringify({
            industry:'salon',pricingModel:model,appPricesMinor,
            baseMonthlyMinor:egpToMinor(base),extraBranchMonthlyMinor:egpToMinor(branch),
            includedBranches,annualMonthsCharged,
          }),
        });
      if(result.approvedForSale!==false||result.canCheckout!==false||
         result.proposal.approvedForSale!==false)throw Error('الرد غير متوقع');
      setMessage('تم حفظ الإصدار البحثي رقم '+result.proposal.version+' للمراجعة. لم يتم اعتماد سعر للبيع.');
      await read();
    }catch(e){setError(e instanceof Error?e.message:'تعذر حفظ المقترح');}
    finally{setBusy(null);}
  };
  const review=async(proposal:TariffResearchProposal,action:'reviewed_research'|'changes_requested')=>{
    if(busy)return;
    const note=notes[proposal.proposalId]?.trim()??'';
    if(!note){setError('لازم تكتب سبب أو ملاحظة المراجعة');return;}
    setBusy(proposal.proposalId);setError(null);setMessage(null);
    try{
      const response=await platformFetch<{proposal:TariffResearchProposal;approvedForSale:false;canCheckout:false}>(
        '/api/admin/platform/tariff-research',{
          method:'PATCH',body:JSON.stringify({proposalId:proposal.proposalId,action,note}),
        });
      if(response.approvedForSale!==false||response.canCheckout!==false)
        throw Error('الرد غير متوقع');
      setMessage('اتسجلت المراجعة البحثية. ده مش اعتماد سعر للبيع.');
      await read();
    }catch(e){setError(e instanceof Error?e.message:'تعذر إتمام المراجعة');}
    finally{setBusy(null);}
  };
  return <main dir="rtl" className="space-y-5">
    <header className="space-y-2">
      <h1 className="text-2xl font-bold">بحث وتسعير التطبيقات</h1>
      <p className="text-sm leading-7 text-muted-foreground">
        مساحة داخلية لإعداد افتراضات الأسعار ومراجعتها بشخص مختلف. كل الأرقام بالجنيه المصري
        <strong> وليست أسعار بيع معتمدة</strong>، ولا تظهر للعميل ولا تدخل في فواتير أو اشتراكات.
      </p>
    </header>
    {error&&<div role="alert" className="flex flex-wrap items-center gap-2 rounded-xl border border-rose-500/30 p-3 text-sm text-rose-600">
      <AlertCircle className="h-4 w-4"/>{error}
      <button type="button" className="mr-auto underline" onClick={()=>{setError(null);void read().catch((e:Error)=>setError(e.message));}}>إعادة تحميل</button>
    </div>}
    {message&&<p role="status" className="flex items-center gap-2 text-sm text-emerald-700"><CheckCircle2 className="h-4 w-4"/>{message}</p>}
    {loading?<p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
      <Loader2 className="h-4 w-4 animate-spin"/> جاري التحميل…
    </p>:queue&&<>
      <section className="space-y-4 rounded-2xl border border-border bg-card p-5">
        <div>
          <h2 className="text-lg font-semibold">إعداد مقترح جديد — صالونات</h2>
          <p className="text-xs leading-6 text-muted-foreground">لا توجد أسعار افتراضية. اكتب كل الافتراضات صراحة؛ الإدخال 0 يعني افتراض صفر في البحث فقط.</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          {queue.allowedApps.map(code=><label key={code} className="block space-y-1 text-sm">
            <span>{appManagerLabel(code)} — افتراض شهري بالجنيه</span>
            <input type="text" inputMode="decimal" value={values[code]??''}
              disabled={busy!==null} placeholder="اكتب افتراض السعر"
              onChange={e=>setValues(v=>({...v,[code]:e.target.value}))}
              className="w-full rounded-xl border border-border bg-background p-3"/>
          </label>)}
          <label className="block space-y-1 text-sm"><span>رسوم أساسية شهرية افتراضية</span>
            <input type="text" inputMode="decimal" value={base} disabled={busy!==null}
              onChange={e=>setBase(e.target.value)} placeholder="اكتب 0 إن لم يوجد افتراض رسوم"
              className="w-full rounded-xl border border-border bg-background p-3"/>
          </label>
          <label className="block space-y-1 text-sm"><span>رسوم الفرع الإضافي شهريًا</span>
            <input type="text" inputMode="decimal" value={branch} disabled={busy!==null}
              onChange={e=>setBranch(e.target.value)} placeholder="افتراض رسوم الفرع"
              className="w-full rounded-xl border border-border bg-background p-3"/>
          </label>
          <label className="block space-y-1 text-sm"><span>الفروع المشمولة في البحث</span>
            <input type="number" min="1" max="20" value={branches} disabled={busy!==null}
              onChange={e=>setBranches(e.target.value)}
              className="w-full rounded-xl border border-border bg-background p-3"/>
          </label>
          <label className="block space-y-1 text-sm"><span>عدد الشهور التي يُفترض تحصيلها سنويًا</span>
            <input type="number" min="1" max="12" value={annual} disabled={busy!==null}
              onChange={e=>setAnnual(e.target.value)} placeholder="من 1 لـ12"
              className="w-full rounded-xl border border-border bg-background p-3"/>
          </label>
          <label className="block space-y-1 text-sm"><span>النموذج البحثي</span>
            <select value={model} disabled={busy!==null}
              onChange={e=>setModel(e.target.value as typeof model)}
              className="w-full rounded-xl border border-border bg-background p-3">
              <option value="per_app">لكل تطبيق</option>
              <option value="base_plus_apps">رسوم أساسية + تطبيقات</option>
            </select>
          </label>
        </div>
        <p className="text-xs leading-6 text-muted-foreground">
          الضرائب ورسوم بوابات الدفع والاستخدام الفعلي للذكاء الاصطناعي والمراسلات غير مُسعّرة هنا.
          والوظائف المالية الأساسية لا يمكن منعها بسبب عدم شراء تطبيق إضافي.
        </p>
        <div className="flex justify-end">
          <button type="button" disabled={busy!==null} onClick={()=>void create()}
            className="min-h-11 rounded-xl bg-primary px-5 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50">
            {busy==='create'?'جاري الحفظ…':'تسجيل مقترح بحثي للمراجعة'}
          </button>
        </div>
      </section>
      <section className="space-y-3">
        <h2 className="text-lg font-semibold">الإصدارات والمراجعات</h2>
        {queue.proposals.length===0?<p className="rounded-xl border border-border p-5 text-sm text-muted-foreground">مفيش افتراضات أسعار محفوظة لسه.</p>:
          queue.proposals.map(p=><article key={p.proposalId} className="space-y-3 rounded-2xl border border-border p-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <h3 className="font-semibold">إصدار بحثي #{p.version} · {p.pricingModel==='per_app'?'لكل تطبيق':'رسوم أساسية وتطبيقات'}</h3>
                <p className="text-xs text-muted-foreground">المنشئ: #{p.createdByUserId} · {new Date(p.createdAt).toLocaleString('ar-EG')}</p>
              </div>
              <span className="rounded-lg border border-border px-3 py-1 text-xs text-muted-foreground">{STATUSES[p.status]}</span>
            </div>
            <div className="grid gap-2 text-sm sm:grid-cols-2">
              {Object.entries(p.appPricesMinor).map(([code,value])=><p key={code}>{appManagerLabel(code)}: {formatMinor(value)}</p>)}
              <p>الرسوم الأساسية: {formatMinor(p.baseMonthlyMinor)}</p>
              <p>الفرع الإضافي: {formatMinor(p.extraBranchMonthlyMinor)}</p>
              <p>فروع مشمولة: {p.includedBranches}</p>
              <p>شهور التحصيل السنوي المفترضة: {p.annualMonthsCharged}</p>
            </div>
            {p.status==='submitted'&&p.createdByUserId!==actorUserId&&<>
              <label className="block space-y-1 text-sm">
                <span>ملاحظة مراجعة مستقلة (إجبارية)</span>
                <textarea rows={2} maxLength={500} disabled={busy!==null}
                  value={notes[p.proposalId]??''}
                  onChange={e=>setNotes(prev=>({...prev,[p.proposalId]:e.target.value}))}
                  className="w-full rounded-xl border border-border bg-background p-3"
                  placeholder="ليه الافتراض مناسب للدراسة أو محتاج تعديلات؟"/>
              </label>
              <div className="flex flex-wrap gap-2">
                <button type="button" disabled={busy!==null||!notes[p.proposalId]?.trim()}
                  className="min-h-10 rounded-lg border border-border px-3 py-2 text-sm disabled:opacity-50"
                  onClick={()=>void review(p,'reviewed_research')}>تمت المراجعة البحثية</button>
                <button type="button" disabled={busy!==null||!notes[p.proposalId]?.trim()}
                  className="min-h-10 rounded-lg border border-border px-3 py-2 text-sm disabled:opacity-50"
                  onClick={()=>void review(p,'changes_requested')}>طلب تعديل</button>
              </div>
            </>}
            {p.status==='submitted'&&p.createdByUserId===actorUserId&&
              <p className="text-xs text-muted-foreground">مستني مراجعة شخص آخر من فريق المنصة.</p>}
            {p.reviewNote&&<p className="text-sm text-muted-foreground">
              ملاحظة المراجع #{p.reviewedByUserId}: {p.reviewNote}
            </p>}
            <p className="text-xs text-muted-foreground">الحالة: بحث داخلي فقط · لا يمكن استخدامه لإنشاء فاتورة أو اشتراك مدفوع.</p>
          </article>)}
      </section>
    </>}
  </main>;
}

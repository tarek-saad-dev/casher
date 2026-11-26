'use client';
import { useEffect,useState } from 'react';
import { Activity,BarChart3,Clock3,Store,UserPlus,RefreshCw } from 'lucide-react';
import { ANALYTICS_PERIODS,type AnalyticsPeriod,type buildAnalytics } from '@/platform/onboarding/analyticsModel';
type Analytics=ReturnType<typeof buildAnalytics>&{period:AnalyticsPeriod;generatedAtUtc:string};
const number=(v:number)=>v.toLocaleString('en-EG');
const percent=(v:number|null)=>v===null?'—':number(v)+'%';
const card='rounded-2xl border border-slate-200 bg-white p-4 sm:p-5';

export default function OnboardingAnalyticsPanel(){
  const [period,setPeriod]=useState<AnalyticsPeriod>(30);
  const [version,setVersion]=useState(0);
  const [data,setData]=useState<Analytics|null>(null);
  const [error,setError]=useState('');
  const [loading,setLoading]=useState(true);
  useEffect(()=>{
    const ctrl=new AbortController();
    setLoading(true);setData(null);setError('');
    void (async()=>{
      try{
        const res=await fetch('/api/admin/platform/onboarding-analytics?days='+period,{cache:'no-store',signal:ctrl.signal});
        const json=await res.json();
        if(!res.ok||!json.ok)throw new Error(json.error||'تعذر التحميل.');
        if(!ctrl.signal.aborted)setData(json.analytics);
      }catch(e){if(!ctrl.signal.aborted)setError(e instanceof Error?e.message:'تعذر التحميل.');}
      finally{if(!ctrl.signal.aborted)setLoading(false);}
    })();
    return()=>ctrl.abort();
  },[period,version]);
  return <section dir="rtl" className="space-y-4 rounded-2xl bg-[#eef2f5] p-4 text-[#102433] sm:p-6">
    <header className="rounded-2xl bg-[#102433] p-5 text-white sm:p-7"><div className="flex items-center gap-2 text-xs font-bold text-[#66e0da]"><BarChart3 className="h-5 w-5"/> DRVO · Activation Intelligence</div><h2 className="mt-2 text-2xl font-black">رحلة المنشآت الجديدة</h2><p className="mt-2 text-sm leading-7 text-slate-300">تسجيلات الصالونات الحقيقية المحفوظة، والتجهيز والاستخدام الفعلي من بيانات النظام.</p></header>
    <div className="flex flex-wrap items-center justify-between gap-2"><div className="flex flex-wrap gap-2" aria-label="الفترة">{ANALYTICS_PERIODS.map(n=><button key={n} type="button" aria-pressed={period===n} onClick={()=>setPeriod(n)} className={'rounded-xl border px-4 py-2 text-sm font-bold '+(period===n?'border-teal-700 bg-[#087e7a] text-white':'border-slate-300 bg-white')}>آخر {n} يوم</button>)}</div><button type="button" onClick={()=>setVersion(v=>v+1)} className="flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-bold"><RefreshCw className={'h-4 w-4 '+(loading?'animate-spin':'')}/> تحديث</button></div>
    {loading&&<div role="status" className={card}>جاري تحميل المؤشرات…</div>}{error&&<div role="alert" className="rounded-xl bg-red-50 p-4 text-sm text-red-800">{error}</div>}
    {data&&<>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{[{label:'طلبات تسجيل محفوظة',value:number(data.counts.submitted),Icon:UserPlus},{label:'حسابات تم إنشاؤها',value:number(data.counts.provisioned),Icon:Store},{label:'سجلت فاتورة مبيعات',value:number(data.counts.sold),Icon:Activity},{label:'تحويل الحسابات لأول فاتورة',value:percent(data.conversion),Icon:BarChart3}].map(x=><div key={x.label} className={card}><x.Icon className="h-5 w-5 text-teal-700"/><p className="mt-3 text-xs leading-6 text-slate-600">{x.label}</p><div className="mt-1 text-2xl font-black sm:text-3xl">{x.value}</div></div>)}</div>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <section className={card}><h3 className="text-lg font-black">مسار التجهيز</h3><p className="mt-1 text-xs leading-6 text-slate-600">مراحل تراكمية حسب البيانات المتاحة حاليًا، وليست تتبعًا لزيارة شاشات التسجيل.</p><div className="mt-5 space-y-4">{data.stages.map(s=><div key={s.id}><div className="flex items-center justify-between gap-2 text-sm"><span className="font-bold">{s.label}</span><span className="font-bold tabular-nums">{number(s.count)} · {percent(s.percentage)}</span></div><div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-[#087e7a]" style={{width:(s.percentage??0)+'%'}}/></div>{s.waiting>0&&<p className="mt-1 text-xs text-slate-600">{number(s.waiting)} لم تستوفِ هذه المرحلة بعد، من اللي استوفوا السابقة.</p>}</div>)}</div></section>
        <section className={card}><h3 className="font-black">جودة التسجيل والاستخدام</h3><div className="mt-3 divide-y divide-slate-100">{[['نسبة إنشاء الحساب',percent(data.provisioningRate)],['محاولات فاشلة (آخر حالة)',number(data.counts.failed)],['قيد الإنشاء (آخر حالة)',number(data.counts.provisioning)],['سجلت حجزًا فعليًا',number(data.counts.booked)]].map(([label,v])=><div key={label} className="flex justify-between gap-2 py-3 text-sm"><span>{label}</span><b>{v}</b></div>)}</div><div className="mt-4 rounded-xl bg-slate-50 p-4"><div className="flex items-center gap-2 text-xs font-bold text-slate-600"><Clock3 className="h-4 w-4"/> متوسط الوقت لأول فاتورة محتفظ بها</div><div className="mt-2 text-2xl font-black">{data.meanCalendarDaysToFirstSale===null?'—':number(data.meanCalendarDaysToFirstSale)+' يوم'}</div><p className="mt-2 text-xs leading-6 text-slate-600">فرق أيام تقويمية تقريبي، من تاريخ إنشاء الحساب إلى أقدم فاتورة مبيعات باقية؛ عينة {number(data.counts.firstSaleMeasured)} منشأة. لا يقيس ساعات فعلية.</p></div></section>
      </div>
      {data.counts.submitted===0&&<div className={card}>لا توجد تسجيلات صالونات حقيقية محفوظة في الفترة المختارة.</div>}
      <section className={card}><h3 className="font-black">حدود القياس</h3><p className="mt-2 text-xs leading-7 text-slate-600">الفترة حسب أول تسجيل محفوظ، والحالة تُقرأ الآن. لا تشمل الزيارات قبل إرسال التسجيل، أو المحاولات المكررة غير المحفوظة، أو الديمو، أو المتاجر. الفاتورة مؤشر استخدام وليست اشتراكًا مدفوعًا أو دليل استمرار. سلسلة التجهيز ليست فحصًا لحالة الاشتراك أو يوم العمل الحالي. لا نعرض أرقام هواتف أو بيانات شخصية.</p><p className="mt-2 text-xs text-slate-500" dir="ltr">UTC · {data.generatedAtUtc}</p></section>
    </>}
  </section>;
}

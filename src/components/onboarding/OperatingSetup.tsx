'use client';
import Link from 'next/link';
import { useCallback,useEffect,useRef,useState } from 'react';
import { ArrowLeft,CalendarDays,CheckCircle2,CircleAlert,CreditCard,Loader2,Printer,Wallet,Rocket,ListChecks,RefreshCw } from 'lucide-react';
import { useSession } from '@/hooks/useSession';
import { getLocalAgentHealth,getLocalPrinterDiagnostics } from '@/lib/localPrintClient';
import { BOOKING_SLOT_INTERVAL_OPTIONS,BOOKING_MIN_NOTICE_OPTIONS } from '@/lib/booking/bookingSettingsValidation';
import { parseOperatingBookingPreferences,type OperatingBookingPreferences } from '@/platform/onboarding/operatingPreferences';
type Operating={branchName:string;apps:string[];booking:(OperatingBookingPreferences&{enabled:boolean})|null;publicBookingEnabled:boolean};
type Payment={ID:number;Name:string};
const endpoint='/api/tenant/onboarding/operating';
const card='rounded-2xl border border-slate-200 bg-white p-4 sm:p-5';
const action='inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-[#087e7a] px-4 py-2 text-sm font-bold text-white disabled:opacity-50';
const secondary='inline-flex min-h-10 items-center gap-2 rounded-xl border border-slate-300 px-3 py-2 text-xs font-bold text-slate-700';
const input='mt-2 min-h-12 w-full min-w-0 rounded-xl border border-slate-300 bg-slate-50/70 px-3 py-3 text-base text-[#102433] outline-none focus:border-teal-600 focus:bg-white focus:ring-2 focus:ring-teal-100 sm:text-sm';
function State({ok,children}:{ok:boolean;children:React.ReactNode}){return <span className={'inline-flex items-center gap-1 text-xs font-bold '+(ok?'text-emerald-700':'text-amber-800')}>{ok?<CheckCircle2 className="h-4 w-4"/>:<CircleAlert className="h-4 w-4"/>}{children}</span>;}
export default function OperatingSetup(){
  const session=useSession();
  const [data,setData]=useState<Operating|null>(null),[payments,setPayments]=useState<Payment[]|null>(null),[draft,setDraft]=useState<OperatingBookingPreferences|null>(null);
  const [loading,setLoading]=useState(true),[error,setError]=useState(''),[paymentError,setPaymentError]=useState(false),[saveMessage,setSaveMessage]=useState(''),[saving,setSaving]=useState(false);
  const [printer,setPrinter]=useState<{connected:boolean;found:boolean|null;name?:string}|null>(null),[checking,setChecking]=useState(false);
  const pending=useRef(false),printerPending=useRef(false);
  const dirty=!!draft&&!!data?.booking&&(draft.slotIntervalMinutes!==data.booking.slotIntervalMinutes||draft.minNoticeMinutes!==data.booking.minNoticeMinutes||draft.maxBookingDaysAhead!==data.booking.maxBookingDaysAhead);
  const checks=data?[
    ...(data.apps.includes('pos')?[{label:'طرق الدفع',state:paymentError?'تعذر التحميل':payments===null?'جاري المراجعة':payments.length?'مسجلة':'تحتاج تجهيز',ok:!paymentError&&!!payments?.length},{label:'الطابعة',state:printer?.found===true?'موجودة':printer?.connected?'الاتصال فقط':printer?'تعذر الاتصال':'لم يتم الفحص',ok:printer?.found===true}]:[]),
    ...(data.apps.includes('booking')?[{label:'إعدادات الحجز',state:data.booking?.enabled?'مفعّل':'غير مفعّل أو غير مهيأ',ok:data.booking?.enabled===true}]:[]),
    ...(data.apps.includes('treasury')?[{label:'يوم العمل والوردية',state:session.loading?'جاري المراجعة':session.hasActiveDay&&session.hasActiveShift?'مفتوحان':'تحتاج مراجعة',ok:!session.loading&&session.hasActiveDay===true&&session.hasActiveShift===true}]:[]),
  ]:[];
  const load=useCallback(async(signal?:AbortSignal)=>{
    setLoading(true);setError('');setPaymentError(false);setPayments(null);setData(null);setDraft(null);setSaveMessage('');
    try{
      const response=await fetch(endpoint,{cache:'no-store',signal});const result=await response.json();
      if(!response.ok||!result.ok)throw new Error(result.error||'تعذر التحميل.');
      if(signal?.aborted)return;
      const next=result as Operating;setData(next);
      if(next.booking)setDraft({slotIntervalMinutes:next.booking.slotIntervalMinutes,minNoticeMinutes:next.booking.minNoticeMinutes,maxBookingDaysAhead:next.booking.maxBookingDaysAhead});
      if(next.apps.includes('pos')){
        try{const pay=await fetch('/api/payment-methods',{cache:'no-store',signal});const rows=await pay.json();if(!pay.ok||!Array.isArray(rows))throw new Error('payment');if(!signal?.aborted)setPayments(rows.filter((r:Payment)=>Number.isFinite(r.ID)&&typeof r.Name==='string'));}
        catch{if(!signal?.aborted)setPaymentError(true);}
      }
    }catch(e){if(!signal?.aborted)setError(e instanceof Error?e.message:'تعذر التحميل.');}
    finally{if(!signal?.aborted)setLoading(false);}
  },[]);
  useEffect(()=>{const c=new AbortController();void load(c.signal);return()=>c.abort();},[load]);
  async function save(e:React.FormEvent){
    e.preventDefault();if(!draft||!data?.booking||pending.current||!dirty)return;
    pending.current=true;setSaving(true);setSaveMessage('');setError('');
    try{const payload=parseOperatingBookingPreferences(draft);const res=await fetch(endpoint,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload),cache:'no-store'});const result=await res.json();if(!res.ok||!result.ok)throw new Error(result.error||'تعذر الحفظ.');setData(old=>old?.booking?{...old,booking:{...old.booking,...payload}}:old);setSaveMessage('تم حفظ مواعيد الحجز بدون تغيير حالة النشر العام.');}
    catch(e){setError(e instanceof Error?e.message:'تعذر الحفظ.');}
    finally{pending.current=false;setSaving(false);}
  }
  async function checkPrinter(){
    if(printerPending.current)return;
    printerPending.current=true;setChecking(true);setPrinter(null);
    try{const health=await getLocalAgentHealth();try{const diag=await getLocalPrinterDiagnostics();setPrinter({connected:true,found:diag.printerFound,name:diag.printerName||health.printer});}catch{setPrinter({connected:true,found:null,name:health.printer});}}
    catch{setPrinter({connected:false,found:null});}
    finally{printerPending.current=false;setChecking(false);}
  }
  return <div className="space-y-4">
    <header className="rounded-2xl bg-gradient-to-br from-[#102433] via-[#123443] to-[#0b514f] p-5 text-white sm:p-8"><div className="flex items-center gap-2 text-xs font-bold text-[#66e0da]"><Rocket className="h-5 w-5"/> تجهيز أول يوم تشغيل</div><h1 className="mt-3 text-2xl font-black sm:text-3xl">خلّي كل حاجة جاهزة قبل أول عميل.</h1><p className="mt-2 text-sm leading-7 text-slate-300">{data?.branchName||'الفرع الحالي'} · راجع الإعدادات الفعلية من غير تسجيل أي حركة مالية تلقائيًا.</p></header>
    {loading&&<p role="status" className={card}><Loader2 className="me-2 inline h-4 w-4 animate-spin"/> جاري التحميل…</p>}
    {error&&<p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-800">{error}</p>}
    {!data&&!loading&&<button type="button" className={secondary} onClick={()=>void load()}>إعادة المحاولة</button>}
    {data&&checks.length>0&&<section className={card}><div className="flex flex-wrap items-center justify-between gap-3"><h2 className="flex items-center gap-2 font-black"><ListChecks className="h-5 w-5 text-teal-700"/> نظرة سريعة على حالة التجهيز</h2><span className="text-xs font-bold text-slate-600">{checks.filter(c=>c.ok).length} من {checks.length} مؤشرات متحققة</span></div><div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">{checks.map(check=><div key={check.label} className="min-w-0 rounded-xl border border-slate-200 bg-slate-50 p-3"><div className="mb-2 text-sm font-bold">{check.label}</div><State ok={check.ok}>{check.state}</State></div>)}</div><p className="mt-3 text-xs leading-6 text-slate-600">دي مؤشرات للحالة الحالية وليست شرطًا لإتمام التجهيز أو إثباتًا إن كل حاجة جاهزة للبيع.</p></section>}
    {data&&<div className="grid gap-4 lg:grid-cols-2">
      {data.apps.includes('pos')&&<section className={card}><h2 className="flex items-center gap-2 font-black"><CreditCard className="h-5 w-5 text-teal-700"/> طرق الدفع</h2><p className="mt-2 text-xs leading-6 text-slate-600">الطرق المسجلة فعليًا لحسابك. وجود طريقة لا يعني تفعيل بوابة دفع إلكتروني.</p>{paymentError?<State ok={false}>تعذر تحميل الطرق</State>:payments===null?<p className="mt-3 text-xs text-slate-600">جاري التحميل…</p>:payments.length?<div className="mt-3 flex flex-wrap gap-2">{payments.map(p=><span key={p.ID} className="rounded-lg border border-teal-200 bg-teal-50 px-3 py-2 text-sm font-bold">{p.Name}</span>)}</div>:<p className="mt-3 text-sm text-amber-800">مفيش طرق دفع مسجلة. راجع دعم المنصة قبل البيع.</p>}<p className="mt-3 text-xs text-slate-600">إضافة طرق مخصصة غير متاحة من شاشة التجهيز الحالية.</p></section>}
      {data.apps.includes('pos')&&<section className={card}><h2 className="flex items-center gap-2 font-black"><Printer className="h-5 w-5 text-teal-700"/> الطباعة</h2><p className="mt-2 text-xs leading-6 text-slate-600">اختبر خدمة الطباعة من جهاز الكاشير نفسه. مش هيتم طباعة إيصال تلقائيًا.</p><button type="button" disabled={checking} className={'mt-3 '+secondary} onClick={()=>void checkPrinter()}>{checking?<Loader2 className="h-4 w-4 animate-spin"/>:<Printer className="h-4 w-4"/>}فحص اتصال الطابعة</button>{printer&&<div role="status" className="mt-3 space-y-2"><State ok={printer.connected}>{printer.connected?'خدمة الطباعة المحلية متصلة':'تعذر الاتصال من الجهاز الحالي'}</State>{printer.connected&&<p className="text-xs text-slate-600">{printer.found===true?'الطابعة موجودة في النظام':printer.found===false?'الطابعة غير موجودة':'لم يتم التحقق من الطابعة'}{printer.name?' · '+printer.name:''}. الحالة الفعلية للطباعة تحتاج تجربة.</p>}</div>}<Link href="/admin/settings/printing" className="mt-3 inline-block text-xs font-bold text-teal-700 underline">إعدادات الطباعة وتجربة إيصال</Link></section>}
      {data.apps.includes('booking')&&<section className={card}><h2 className="flex items-center gap-2 font-black"><CalendarDays className="h-5 w-5 text-teal-700"/> الحجوزات</h2><div className="mt-3 flex flex-wrap gap-3"><State ok={data.booking?.enabled===true}>{data.booking?.enabled?'الحجز مفعّل في الإعدادات':'الحجز غير مفعّل أو غير مهيأ'}</State><State ok={data.publicBookingEnabled}>{data.publicBookingEnabled?'النشر العام مفعّل':'النشر العام غير مفعّل'}</State></div>{draft&&data.booking?<form onSubmit={save} className="mt-4 space-y-3"><fieldset disabled={saving} className="space-y-3"><div className="grid gap-3 sm:grid-cols-2"><label className="text-xs font-bold">الفاصل بين المواعيد<select className={input} value={draft.slotIntervalMinutes} onChange={e=>setDraft(d=>d?{...d,slotIntervalMinutes:Number(e.target.value)}:d)}>{BOOKING_SLOT_INTERVAL_OPTIONS.map(n=><option key={n} value={n}>{n} دقيقة</option>)}</select></label><label className="text-xs font-bold">أقل وقت قبل الحجز<select className={input} value={draft.minNoticeMinutes} onChange={e=>setDraft(d=>d?{...d,minNoticeMinutes:Number(e.target.value)}:d)}>{BOOKING_MIN_NOTICE_OPTIONS.map(n=><option key={n} value={n}>{n} دقيقة</option>)}</select></label></div><label className="block text-xs font-bold">الحجز مقدمًا (عدد الأيام)<input className={input} type="number" min={1} max={60} required value={draft.maxBookingDaysAhead} onChange={e=>setDraft(d=>d?{...d,maxBookingDaysAhead:Number(e.target.value)}:d)}/></label><div className="flex flex-wrap items-center gap-2"><button type="submit" disabled={saving||!dirty} className={action}>{saving?'جاري الحفظ…':'حفظ إعدادات المواعيد'}</button><button type="button" disabled={saving||!dirty} className={secondary+' disabled:opacity-50'} onClick={()=>{if(data.booking)setDraft({slotIntervalMinutes:data.booking.slotIntervalMinutes,minNoticeMinutes:data.booking.minNoticeMinutes,maxBookingDaysAhead:data.booking.maxBookingDaysAhead});setSaveMessage('');setError('');}}>إلغاء التعديلات</button></div>{dirty&&<p role="status" className="text-xs font-bold text-amber-800">فيه تعديلات على المواعيد لسه متحفظتش.</p>}</fieldset>{saveMessage&&<p role="status" className="text-xs font-bold text-emerald-700">{saveMessage}</p>}</form>:<p className="mt-3 text-sm text-amber-800">إعدادات الفرع غير مهيأة بعد. جهزها من شاشة الحجوزات.</p>}<Link href="/admin/queue-booking-settings" className="mt-4 inline-block text-xs font-bold text-teal-700 underline">إعدادات الحجوزات المتقدمة</Link><p className="mt-2 text-xs text-slate-600">الحفظ هنا لا يغيّر تفعيل الحجز أو ينشر الرابط العام.</p></section>}
      {data.apps.includes('queue')&&<section className={card}><h2 className="font-black">طابور العملاء</h2><p className="mt-2 text-xs leading-6 text-slate-600">راجع سياسة الانتظار والأولوية قبل استقبال العملاء.</p><Link href="/admin/queue-booking-settings" className={'mt-3 '+secondary}>إعدادات الطابور <ArrowLeft className="h-4 w-4"/></Link></section>}
      {data.apps.includes('treasury')&&<section className={card}><h2 className="flex items-center gap-2 font-black"><Wallet className="h-5 w-5 text-teal-700"/> الخزنة</h2><p className="mt-2 text-xs leading-6 text-slate-600">تأكد من يوم العمل ووردية الكاشير. الشاشة لا تسجل رصيدًا افتتاحيًا أو إيرادًا تلقائيًا.</p>{session.loading?<p className="mt-3 text-xs">جاري مراجعة الجلسة…</p>:<div className="mt-3 flex flex-wrap gap-3"><State ok={session.hasActiveDay===true}>{session.hasActiveDay?'يوم العمل مفتوح':'يوم العمل غير مفتوح'}</State><State ok={session.hasActiveShift===true}>{session.hasActiveShift?'ورديتك مفتوحة':'ورديتك غير مفتوحة هنا'}</State></div>}<Link href="/treasury/daily" className={'mt-4 '+secondary}>مراجعة الخزنة <ArrowLeft className="h-4 w-4"/></Link></section>}
    </div>}
    {data&&<section className={card}><h2 className="font-black">جاهز تبدأ؟</h2><p className="mt-2 text-sm leading-7 text-slate-600">ارجع لشاشة التشغيل عشان تفتح اليوم والوردية بإجراء واضح. راجع الأسعار والفريق وطرق الدفع قبل تسجيل أول فاتورة.</p>{dirty&&<p className="mt-3 text-xs font-bold text-amber-800">احفظ أو ألغِ تعديلات المواعيد قبل المتابعة.</p>}<div className="mt-4 flex flex-wrap gap-2">{dirty||saving?<button type="button" disabled className={action}>متابعة لفتح يوم العمل <ArrowLeft className="h-4 w-4"/></button>:<Link href="/setup/launch" className={action}>متابعة لفتح يوم العمل <ArrowLeft className="h-4 w-4"/></Link>}{dirty||saving?<button type="button" disabled className={secondary+' opacity-50'}>مراجعة التجهيز</button>:<Link href="/setup/finish" className={secondary}>مراجعة التجهيز</Link>}<button type="button" className={secondary+' disabled:opacity-50'} disabled={loading||saving||dirty} onClick={()=>void load()}><RefreshCw className="h-4 w-4"/> تحديث الحالة</button></div></section>}
  </div>;
}

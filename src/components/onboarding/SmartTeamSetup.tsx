'use client';

import Link from 'next/link';
import { useRef, useState, type FormEvent } from 'react';
import { ArrowLeft, CheckCircle2, Clock3, Loader2, Plus, ShieldCheck, Users, Wallet, Search, UserRound } from 'lucide-react';
import { SETUP_JOBS } from '@/platform/onboarding/selfServiceInput';
import { EMPLOYMENT_TYPES, EMPLOYMENT_TYPE_LABELS, PAYROLL_METHODS, PAYROLL_METHOD_LABELS, type EmploymentType, type PayrollMethod } from '@/lib/hr/employee-hr-model';

export type TeamEmployee={EmpID:number;EmpName:string;Job:string;EmploymentType?:string|null;PayrollMethod?:string|null;BaseSalary?:number|null;DailyRate?:number|null;ManualHourlyRate?:number|null;IsPayrollEnabled?:boolean|number|null};
const field='min-h-12 w-full min-w-0 rounded-xl border border-input bg-surface px-3 py-3 text-base text-foreground outline-none transition-colors focus:border-primary focus:bg-card focus:ring-2 focus:ring-primary/20 sm:text-sm';
const button='inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-bold text-primary-foreground disabled:opacity-50';
const payrollUnits={hourly:'قيمة الساعة',daily:'قيمة اليومية',monthly:'المرتب الشهري'};
const roleLabel=(method:string)=>PAYROLL_METHOD_LABELS[method as PayrollMethod]??method;

export default function SmartTeamSetup({employees,payrollAvailable,bookingAvailable,onSaved}:{employees:TeamEmployee[];payrollAvailable:boolean;bookingAvailable:boolean;onSaved:()=>Promise<void>}){
  const [name,setName]=useState('');
  const [query,setQuery]=useState('');
  const [job,setJob]=useState<string>(SETUP_JOBS[0]);
  const [configurePay,setConfigurePay]=useState(false);
  const [employmentType,setEmploymentType]=useState<EmploymentType>('full_time');
  const [payrollMethod,setPayrollMethod]=useState<PayrollMethod>('monthly');
  const [rate,setRate]=useState('');
  const [booking,setBooking]=useState<'default'|'yes'|'no'>('default');
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState('');
  const [error,setError]=useState('');
  const pending=useRef(false);
  const visibleEmployees=employees.filter(emp=>`${emp.EmpName} ${emp.Job}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  const payrollCount=employees.filter(emp=>Boolean(emp.IsPayrollEnabled)&&!!emp.PayrollMethod).length;
  async function save(e:FormEvent<HTMLFormElement>){
    e.preventDefault();if(pending.current)return;
    if(!name.trim()){setError('اكتب اسم الموظف.');return;}
    if(payrollAvailable&&configurePay&&(!rate.trim()||!Number.isFinite(Number(rate))||Number(rate)<=0||Number(rate)>1000000||Math.abs(Number(rate)*100-Math.round(Number(rate)*100))>1e-6)){setError('اكتب قيمة صحيحة للمرتب.');return;}
    pending.current=true;setBusy(true);setError('');setMessage('');
    try{
      const response=await fetch('/api/tenant/onboarding/setup-data',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'employee',name,job,...(payrollAvailable&&configurePay?{employmentType,payrollMethod,payRate:Number(rate)}:{}),...(bookingAvailable&&booking!=='default'?{acceptsBookings:booking==='yes'}:{})})});
      const data=await response.json().catch(()=>({}));
      if(!response.ok||!data.ok)throw new Error(data.error||'تعذر إضافة الموظف.');
      setMessage(data.existing?'الموظف موجود بالفعل. لم يتم تغيير بياناته أو مرتبه.':'تم إضافة الموظف وربطه بالفرع الحالي.');
      setName('');setRate('');setConfigurePay(false);setBooking('default');
      try{await onSaved();}catch{setError('تمت العملية، لكن القائمة لم تتحدث. حدّث الصفحة قبل إعادة المحاولة.');}
    }catch(err){setError(err instanceof Error?err.message:'تعذر الحفظ.');}
    finally{pending.current=false;setBusy(false);}
  }
  return <div className="mt-7 space-y-4 text-foreground" dir="rtl">
    <div className="rounded-2xl bg-brand-soft p-5 text-foreground sm:p-6"><div className="flex items-center gap-2 text-xs font-bold text-brand"><Users className="h-5 w-5"/> فريق العمل</div><h2 className="mt-2 text-xl font-black">جهّز فريقك من أول يوم.</h2><p className="mt-2 text-xs leading-6 text-muted-foreground">ضيف الموظف، وحدد وظيفته واتفاق المرتب الأساسي قبل التشغيل. الحسابات والصلاحيات والجداول المتقدمة ليها إعدادات منفصلة.</p><div className="mt-5 grid gap-2 sm:grid-cols-2"><div className="rounded-xl border border-border bg-card p-4"><div className="text-3xl font-black tabular-nums">{employees.length}</div><div className="mt-1 text-xs text-muted-foreground">موظف في الفرع الحالي</div></div>{payrollAvailable&&<div className="rounded-xl border border-border bg-card p-4"><div className="text-3xl font-black tabular-nums">{payrollCount}</div><div className="mt-1 text-xs text-muted-foreground">موظف بنظام مرتبات مفعّل</div></div>}</div></div>
    <form onSubmit={save} className="rounded-2xl border border-border bg-card p-4 sm:p-5">
      <div className="flex items-center gap-3"><span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary-soft text-foreground"><UserRound className="h-5 w-5"/></span><div><h3 className="font-black">إضافة فرد للفريق</h3><p className="mt-1 text-xs text-muted-foreground">ابدأ بالاسم والوظيفة، وباقي التفاصيل اختيارية.</p></div></div><fieldset disabled={busy} className="mt-5 min-w-0 space-y-4">
        <div className="grid gap-3 sm:grid-cols-2"><label className="block text-sm font-bold">اسم الموظف<input required maxLength={200} value={name} onChange={e=>{setName(e.target.value);setError('');setMessage('');}} placeholder="مثال: أحمد محمد" className={'mt-2 '+field}/></label><label className="block text-sm font-bold">الوظيفة<select value={job} onChange={e=>setJob(e.target.value)} className={'mt-2 '+field}>{SETUP_JOBS.map(j=><option key={j} value={j}>{j}</option>)}</select></label></div>
        {payrollAvailable?<section className="rounded-xl border border-border bg-surface p-4"><label className="flex items-center gap-3 text-sm font-bold"><input type="checkbox" checked={configurePay} onChange={e=>setConfigurePay(e.target.checked)} className="h-5 w-5 accent-primary"/><Wallet className="h-5 w-5 text-primary"/> تجهيز اتفاق المرتب الأساسي الآن</label><p className="mt-2 text-xs leading-6 text-muted-foreground">اختياري. الاتفاق هنا للموظف الجديد فقط، ولا ينشئ حركة مالية أو يصرف مرتبًا.</p>{configurePay&&<div className="mt-4 space-y-3"><div className="grid gap-3 sm:grid-cols-2"><label className="block text-sm font-bold">نوع التوظيف<select value={employmentType} onChange={e=>{const v=e.target.value as EmploymentType;setEmploymentType(v);if(v==='freelance'&&payrollMethod==='monthly')setPayrollMethod('daily');}} className={'mt-2 '+field}>{EMPLOYMENT_TYPES.map(v=><option key={v} value={v}>{EMPLOYMENT_TYPE_LABELS[v]}</option>)}</select></label><label className="block text-sm font-bold">طريقة الدفع<select value={payrollMethod} onChange={e=>setPayrollMethod(e.target.value as PayrollMethod)} className={'mt-2 '+field}>{PAYROLL_METHODS.filter(v=>employmentType!=='freelance'||v!=='monthly').map(v=><option key={v} value={v}>{PAYROLL_METHOD_LABELS[v]}</option>)}</select></label></div><label className="block text-sm font-bold">{payrollUnits[payrollMethod]} (ج.م)<input required type="number" min="0.01" max="1000000" step="0.01" value={rate} onChange={e=>setRate(e.target.value)} className={'mt-2 '+field}/></label></div>}</section>:<p className="rounded-xl bg-muted p-3 text-xs text-muted-foreground">تجهيز المرتبات متاح عند تثبيت تطبيق الرواتب.</p>}
        {bookingAvailable&&<label className="block text-sm font-bold">استقبال الحجوزات<select value={booking} onChange={e=>setBooking(e.target.value as typeof booking)} className={'mt-2 '+field}><option value="default">حسب الوظيفة (الإعداد الافتراضي)</option><option value="yes">يستقبل الحجوزات</option><option value="no">لا يستقبل الحجوزات</option></select></label>}
        <button type="submit" disabled={busy||!name.trim()} className={button+' w-full sm:w-auto'}>{busy?<Loader2 className="h-4 w-4 animate-spin"/>:<Plus className="h-4 w-4"/>}{busy?'جاري الحفظ…':'حفظ وإضافة الموظف'}</button>
      </fieldset>
      {message&&<p role="status" className="mt-3 flex items-center gap-2 rounded-xl bg-success-soft p-3 text-sm text-success"><CheckCircle2 className="h-4 w-4 shrink-0"/>{message}</p>}
      {error&&<p role="alert" className="mt-3 rounded-xl bg-destructive-soft p-3 text-sm text-destructive">{error}</p>}
    </form>
    <section className="rounded-2xl border border-border bg-card p-4 sm:p-5"><div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-black">فريق الفرع الحالي</h3><span className="rounded-full bg-primary-soft px-3 py-1 text-xs font-bold text-foreground">{employees.length} موظف</span></div>{employees.length>0&&<label className="relative mt-4 block"><span className="sr-only">بحث في الفريق</span><Search className="pointer-events-none absolute right-3 top-4 h-4 w-4 text-muted-foreground"/><input type="search" value={query} onChange={e=>setQuery(e.target.value)} placeholder="ابحث بالاسم أو الوظيفة" className={field+' pr-10'}/></label>}{employees.length===0?<div className="mt-4 rounded-xl border border-dashed border-border bg-muted p-5 text-center"><Users className="mx-auto h-6 w-6 text-primary"/><p className="mt-2 text-sm text-muted-foreground">لسه مفيش موظفين. أضف أول فرد في الفريق.</p></div>:visibleEmployees.length===0?<p role="status" className="mt-4 text-sm text-muted-foreground">مفيش موظفين مطابقين للبحث.</p>:<div className="mt-3 divide-y divide-border">{visibleEmployees.map(emp=>{const method=emp.PayrollMethod;const amount=method==='hourly'?emp.ManualHourlyRate:method==='daily'?emp.DailyRate:method==='monthly'?emp.BaseSalary:null;return <div key={emp.EmpID} className="flex flex-wrap items-center gap-3 py-3"><div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-primary-soft font-black text-foreground">{emp.EmpName.trim().charAt(0)}</div><div className="min-w-0 flex-1"><div className="break-words font-bold">{emp.EmpName}</div><p className="text-xs text-muted-foreground">{emp.Job}{payrollAvailable&&method&&Boolean(emp.IsPayrollEnabled)&&amount!=null?' · '+roleLabel(method)+' '+Number(amount).toLocaleString('en-EG')+' ج.م':''}</p></div><Link href={'/admin/hr/employees/'+emp.EmpID+'/branch-schedule'} className="inline-flex items-center gap-1 rounded-lg border border-border px-3 py-2 text-xs font-bold"><Clock3 className="h-4 w-4"/> جدول العمل</Link></div>})}</div>}</section>
    <section className="rounded-2xl border border-border bg-card p-4 sm:p-5"><h3 className="font-black">الإعدادات المتقدمة</h3><p className="mt-1 text-xs leading-6 text-muted-foreground">كملها من صفحات الإدارة الحالية. إضافة موظف لا تعني إنشاء حساب دخول أو اعتماد خطة عمولة.</p><div className="mt-3 grid gap-2 sm:grid-cols-2"><Link href="/admin/hr" className="flex items-center gap-2 rounded-xl border border-border p-3 text-sm font-bold"><Wallet className="h-4 w-4 text-primary"/> الرواتب والعمولات <ArrowLeft className="ms-auto h-4 w-4"/></Link><Link href="/admin/users" className="flex items-center gap-2 rounded-xl border border-border p-3 text-sm font-bold"><ShieldCheck className="h-4 w-4 text-primary"/> حسابات الدخول والصلاحيات <ArrowLeft className="ms-auto h-4 w-4"/></Link></div></section>
  </div>;
}

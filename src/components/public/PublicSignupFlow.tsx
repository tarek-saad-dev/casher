'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Check, Eye, EyeOff, Loader2, Scissors, Store, ShieldCheck, MessageCircle } from 'lucide-react';
import { localSignupPhone, signupStepError, type SignupDraft } from '@/platform/publicSignup/presentation';
import { getPublicSignupAppChoices, resolvePublicSignupAppSelection } from '@/platform/publicSignup/appSelection';
import type { PublicSignupIndustry } from '@/platform/publicSignup/types';

const labels: Record<string,string> = { booking:'الحجوزات', queue:'طابور العملاء', pos:'الكاشير والمبيعات', attendance:'الحضور', payroll:'المرتبات', treasury:'الخزنة', reports:'التقارير', inventory:'المخزون', purchasing:'المشتريات' };
const steps = ['رقم الموبايل','حساب المالك','نوع النشاط','التطبيقات','المراجعة'];
const initial: SignupDraft = { industry:null, selectedApps:[], contactName:'', businessName:'', phone:'', email:'', password:'', confirmation:'', startMode:'real' };
const input = 'w-full min-w-0 rounded-xl border border-slate-300 bg-white px-4 py-3.5 text-base text-[#102433] outline-none focus:border-[#087e7a] focus:ring-2 focus:ring-teal-100';
const primary = 'inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-[#087e7a] px-5 py-3 text-sm font-bold text-white hover:bg-[#076865] disabled:cursor-not-allowed disabled:opacity-50';
const secondary = 'inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-slate-300 px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-40';
const title = 'text-2xl font-black leading-tight sm:text-3xl xl:text-[2.5rem]';
const subtitle = 'mt-3 text-sm leading-7 text-slate-600 lg:text-base lg:leading-8';
type Ticket = { ticket:string; expiresAtUtc:string; resendAfterSec:number; phone:string };

export default function PublicSignupFlow({ otpRequired = false }: { otpRequired?: boolean }) {
  const [step,setStep] = useState(0);
  const [form,setForm] = useState<SignupDraft>(initial);
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState('');
  const [showPassword,setShowPassword] = useState(false);
  const [ticket,setTicket] = useState<Ticket|null>(null);
  const [code,setCode] = useState('');
  const [nextSend,setNextSend] = useState(0);
  const [now,setNow] = useState(0);
  const [copied,setCopied] = useState(false);
  const [done,setDone] = useState<{ownerLoginName:string;nextPath:string}|null>(null);
  const pending = useRef(false);
  const heading = useRef<HTMLDivElement>(null);
  useEffect(() => { heading.current?.focus({preventScroll:true}); },[step]);
  useEffect(() => { const timer=setInterval(()=>setNow(Date.now()),1000); return ()=>clearInterval(timer); },[]);
  const choices=form.industry ? getPublicSignupAppChoices(form.industry):null;
  const selectionError=useMemo(()=>{
    if (!form.industry) return null;
    try { resolvePublicSignupAppSelection(form.industry,form.selectedApps); return null; }
    catch(e) { return e instanceof Error?e.message:'راجع التطبيقات المختارة.'; }
  },[form.industry,form.selectedApps]);
  const localPhone=localSignupPhone(form.phone);
  const ticketValid=!!ticket && ticket.phone===localPhone && Date.parse(ticket.expiresAtUtc)>Math.max(now,0);
  const cooldown=Math.max(0,Math.ceil((nextSend-now)/1000));
  function update<K extends keyof SignupDraft>(key:K,value:SignupDraft[K]) {
    setForm(old=>({...old,[key]:value})); setError('');
    if(key==='phone'){setTicket(null);setCode('');}
  }
  function goto(n:number) { if(pending.current)return; setStep(n);setError('');setShowPassword(false); }
  function selectIndustry(industry:PublicSignupIndustry) {
    setForm(old=>({...old,industry,selectedApps:getPublicSignupAppChoices(industry).defaults,startMode:'real'}));setError('');
  }
  function next() {
    let invalid:string|null=null;
    if(step===0) invalid=!localPhone || (otpRequired && !/^01[0125]\d{8}$/.test(localPhone))?'اكتب رقم موبايل مصري صحيح.':null;
    if(step===1) invalid=form.contactName.trim().length<2?'اكتب اسمك.':form.email.trim()&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())?'راجع البريد الإلكتروني.':signupStepError(3,form,selectionError);
    if(step===2) invalid=!form.industry?'اختر نوع النشاط.':form.businessName.trim().length<2?'اكتب اسم المنشأة.':null;
    if(step===3) invalid=signupStepError(1,form,selectionError);
    if(invalid){setError(invalid);return;} goto(step+1);
  }
  async function sendOtp(){
    if(!otpRequired||pending.current||!localPhone||Date.now()<nextSend)return;
    pending.current=true;setBusy(true);setError('');setCode('');setTicket(null);
    const sentAt=Date.now();setNow(sentAt);setNextSend(sentAt+60_000);
    try{
      const res=await fetch('/api/public/signup/otp/send',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({phone:localPhone}),cache:'no-store'});
      const data=await res.json().catch(()=>({}));
      if(!res.ok||!data.ok||typeof data.ticket!=='string'||!Number.isFinite(Date.parse(data.expiresAtUtc)))throw new Error(data.error||'تعذر إرسال رمز التحقق.');
      setTicket({ticket:data.ticket,expiresAtUtc:data.expiresAtUtc,resendAfterSec:data.resendAfterSec,phone:localPhone});
      setNextSend(Date.now()+Math.max(60,Number(data.resendAfterSec)||60)*1000);
    }catch(e){setError(e instanceof Error?e.message:'تعذر الإرسال.');}
    finally{pending.current=false;setBusy(false);}
  }
  async function submit(){
    if(pending.current||step!==4)return;
    const invalid=signupStepError(4,form,selectionError);
    if(invalid){setError(invalid);return;}
    if(otpRequired&&(!ticket||!ticketValid||Date.parse(ticket.expiresAtUtc)<=Date.now()||!/^\d{6}$/.test(code))){setError('اطلب رمز تحقق صالح واكتبه قبل إنشاء الحساب.');return;}
    pending.current=true;setBusy(true);setError('');
    try{
      const res=await fetch('/api/public/signup/complete',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify({industry:form.industry,needs:[],selectedApps:form.selectedApps,contactName:form.contactName,businessName:form.businessName,phone:localPhone,email:form.email.trim()||null,password:form.password,startMode:form.startMode,...(otpRequired&&ticket?{otp:{ticket:ticket.ticket,code}}:{})})});
      const data=await res.json().catch(()=>({}));
      if(!res.ok){
        if(data.code==='OTP_INVALID'){setCode('');}
        else if(otpRequired){setTicket(null);setCode('');}
        throw new Error(data.error||'تعذر إنشاء الحساب.');
      }
      if(typeof data.ownerLoginName!=='string'||!data.ownerLoginName)throw new Error('راجع تسجيل الدخول؛ تعذر تحميل بيانات الحساب.');
      setDone({ownerLoginName:data.ownerLoginName,nextPath:data.nextPath==='/setup'?'/setup':'/operations'});
      setForm(old=>({...old,password:'',confirmation:''}));setTicket(null);setCode('');
    }catch(e){setError(e instanceof Error?e.message:'تعذر إنشاء الحساب.');}
    finally{pending.current=false;setBusy(false);}
  }
  return <div className="grid w-full shrink-0 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm sm:rounded-3xl lg:min-h-[560px] lg:flex-1 lg:grid-cols-[minmax(290px,25%)_minmax(0,1fr)]">
    <aside className="flex min-w-0 flex-col bg-[#102433] p-4 text-white sm:p-6 lg:p-8 xl:p-10">
      <div className="text-xs font-bold text-[#66e0da]">ابدأ تجربتك المجانية</div>
      <div className="mt-3 text-xl font-black leading-tight lg:text-3xl xl:text-4xl">كل شغلك، في مكان واحد.</div>
      <p className="mt-3 text-xs leading-6 text-slate-300 lg:text-sm lg:leading-7">14 يوم تجربة بدون بطاقة بنكية.</p>
      <nav aria-label="خطوات التسجيل" className="mt-4 flex gap-1 lg:mt-10 lg:flex-col lg:gap-2">
        {steps.map((name,i)=><button key={name} type="button" disabled={i>step||busy||!!done} aria-current={i===step?'step':undefined} onClick={()=>goto(i)} className={'flex min-w-0 flex-1 flex-col items-center gap-1 rounded-xl px-1 py-2 text-[10px] sm:text-xs lg:flex-none lg:flex-row lg:gap-3 lg:px-3 lg:py-3.5 lg:text-sm '+(i===step?'bg-white/15 font-bold text-white':'text-slate-300 disabled:opacity-75')}><span className={'grid h-6 w-6 shrink-0 place-items-center rounded-full border border-slate-500 lg:h-8 lg:w-8 '+(i<=step?'border-[#66e0da] bg-[#66e0da] text-[#102433]':'')}>{i<step?<Check className="h-4 w-4"/>:i+1}</span><span>{name}</span></button>)}
      </nav>
      <div className="mt-auto hidden pt-10 lg:block"><div className="rounded-2xl border border-white/10 bg-white/5 p-4"><div className="flex items-center gap-2 text-sm font-bold"><ShieldCheck className="h-5 w-5 shrink-0 text-[#66e0da]"/> حساب مستقل لمنشأتك</div><p className="mt-2 text-xs leading-6 text-slate-300">جهّز خدماتك وفريقك وإعدادات التشغيل بعد إنشاء الحساب.</p></div></div>
    </aside>
    <section className="flex min-w-0 flex-col">
      <div className="flex shrink-0 items-center justify-between border-b border-slate-100 px-5 py-4 text-xs font-bold text-slate-600 sm:px-8 lg:px-10 lg:py-5 lg:text-sm"><span>إنشاء حسابك</span><span>{done?'تم إنشاء الحساب':('الخطوة '+(step+1)+' من '+steps.length)}</span></div>
      <div role="progressbar" aria-label="تقدم التسجيل" aria-valuemin={0} aria-valuemax={5} aria-valuenow={step+1} className="h-1 bg-slate-100"><div className="h-full bg-[#087e7a] motion-safe:transition-all" style={{width:((step+1)/5*100)+'%'}}/></div>
      <div key={done?'done':step} ref={heading} tabIndex={-1} className="mx-auto flex w-full max-w-[760px] flex-1 flex-col justify-center p-5 outline-none sm:p-8 lg:px-10 lg:py-10">
        {done?<div className="py-6"><div className="grid h-14 w-14 place-items-center rounded-2xl bg-teal-50 text-[#087e7a]"><Check className="h-7 w-7"/></div><h1 className={'mt-4 '+title}>مساحة عملك جاهزة</h1><p className={subtitle}>احتفظ باسم الدخول عشان ترجع لحسابك في أي وقت.</p><div className="mt-5 rounded-xl border border-slate-200 bg-slate-50 p-4"><div className="text-xs text-slate-600">اسم الدخول</div><div dir="ltr" className="my-2 break-all font-mono font-bold">{done.ownerLoginName}</div><button type="button" className={secondary} onClick={async()=>{try{await navigator.clipboard.writeText(done.ownerLoginName);setCopied(true);}catch{setCopied(false);}}}>{copied?'تم النسخ':'نسخ اسم الدخول'}</button></div><button type="button" className={'mt-5 '+primary} onClick={()=>window.location.assign(done.nextPath)}>جهّز مساحة العمل <ArrowLeft className="h-4 w-4"/></button></div>:<>
        <div className="text-xs font-black text-[#087e7a]">{steps[step]}</div>
        {step===0&&<><h1 className={'mt-2 '+title}>خلينا نبدأ برقم موبايلك.</h1><p className={subtitle}>{otpRequired?'هنأكد ملكية الرقم على واتساب قبل إنشاء الحساب.':'هنستخدم الرقم للتواصل معاك وتجهيز حسابك.'}</p><label className="mt-8 block text-sm font-bold lg:text-base">رقم الموبايل<input dir="ltr" type="tel" autoComplete="tel" inputMode="tel" maxLength={32} value={form.phone} onChange={e=>update('phone',e.target.value)} placeholder="010 1234 5678" className={'mt-2 '+input}/></label><div className="mt-5 rounded-xl border border-teal-100 bg-teal-50 p-4 text-sm leading-7 text-teal-900 lg:p-5"><ShieldCheck className="inline h-5 w-5"/> تجربة مجانية لمدة 14 يوم، بدون دفع الآن.</div></>}
        {step===1&&<><h1 className={'mt-2 '+title}>خلينا نتعرف عليك.</h1><p className={subtitle}>بيانات حساب المالك هتستخدمها للدخول وإدارة نشاطك.</p><div className="mt-5 space-y-4"><label className="block text-sm font-bold">الاسم بالكامل<input autoComplete="name" maxLength={100} className={'mt-2 '+input} value={form.contactName} onChange={e=>update('contactName',e.target.value)}/></label><label className="block text-sm font-bold">البريد الإلكتروني — اختياري<input dir="ltr" type="email" autoComplete="email" maxLength={254} className={'mt-2 '+input} value={form.email} onChange={e=>update('email',e.target.value)}/></label><label className="block text-sm font-bold">كلمة المرور<div className="mt-2 flex gap-2"><input dir="ltr" type={showPassword?'text':'password'} autoComplete="new-password" maxLength={128} className={input} value={form.password} onChange={e=>update('password',e.target.value)} placeholder="10 أحرف على الأقل"/><button type="button" aria-label={showPassword?'إخفاء كلمة المرور':'إظهار كلمة المرور'} className={secondary} onClick={()=>setShowPassword(v=>!v)}>{showPassword?<EyeOff className="h-5 w-5"/>:<Eye className="h-5 w-5"/>}</button></div></label><label className="block text-sm font-bold">تأكيد كلمة المرور<input dir="ltr" type={showPassword?'text':'password'} autoComplete="new-password" maxLength={128} className={'mt-2 '+input} value={form.confirmation} onChange={e=>update('confirmation',e.target.value)}/></label></div></>}
        {step===2&&<><h1 className={'mt-2 '+title}>إيه طبيعة شغلك؟</h1><p className={subtitle}>اختار النشاط واسم المنشأة، وهنجهز الإعدادات المناسبة.</p><div className="mt-5 grid gap-3 sm:grid-cols-2">{([{id:'salon',name:'صالون / Barbershop',detail:'خدمات، حجوزات، فريق وكاشير',Icon:Scissors},{id:'supermarket',name:'متجر / Supermarket',detail:'مبيعات ومخزون ومشتريات',Icon:Store}] as const).map(x=><button type="button" key={x.id} aria-pressed={form.industry===x.id} onClick={()=>selectIndustry(x.id)} className={'rounded-xl border p-4 text-right '+(form.industry===x.id?'border-teal-600 bg-teal-50':'border-slate-200 hover:bg-slate-50')}><x.Icon className="h-6 w-6 text-[#087e7a]"/><div className="mt-3 font-bold">{x.name}</div><p className="mt-1 text-xs text-slate-600">{x.detail}</p></button>)}</div><label className="mt-5 block text-sm font-bold">اسم المنشأة<input autoComplete="organization" maxLength={200} className={'mt-2 '+input} value={form.businessName} onChange={e=>update('businessName',e.target.value)} placeholder="مثال: Nova Salon"/></label></>}
        {step===3&&<><h1 className={'mt-2 '+title}>اختار الأدوات المناسبة.</h1><p className={subtitle}>جهزنا لك اختيارات مقترحة. تقدر تعدل التطبيقات الاختيارية.</p><div className="mt-5 grid gap-2 sm:grid-cols-2">{choices?.apps.map(a=>{const checked=form.selectedApps.includes(a.code);return <button type="button" key={a.code} aria-pressed={checked} disabled={a.group==='required'} onClick={()=>update('selectedApps',checked?form.selectedApps.filter(c=>c!==a.code):[...form.selectedApps,a.code])} className={'flex items-center gap-3 rounded-xl border p-3 text-right '+(checked?'border-teal-600 bg-teal-50':'border-slate-200 hover:bg-slate-50')}><span className={'grid h-6 w-6 shrink-0 place-items-center rounded-md border '+(checked?'border-teal-700 bg-[#087e7a] text-white':'border-slate-300')}>{checked&&<Check className="h-4 w-4"/>}</span><span><b className="block text-sm">{labels[a.code]??a.code}</b><span className="text-xs text-slate-600">{a.group==='required'?'أساسي':'اختياري'}{a.requires.length?' · يحتاج '+a.requires.map(c=>labels[c]??c).join(' و'):''}</span></span></button>})}</div>{selectionError&&<p role="alert" className="mt-3 text-sm text-amber-800">{selectionError}</p>}<p className="mt-4 text-xs text-slate-600">هتبدأ بحساب نظيف وبياناتك الحقيقية. ربط واتساب والمساعد الذكي متاح لاحقًا حسب إعدادات المنشأة.</p></>}
        {step===4&&<><h1 className={'mt-2 '+title}>راجع بياناتك وابدأ.</h1><p className={subtitle}>هننشئ حسابًا مستقلًا باسم منشأتك بعد المراجعة.</p><div className="mt-5 divide-y divide-slate-100 rounded-xl border border-slate-200 px-4">{[{name:'رقم التواصل',value:localPhone,edit:0},{name:'صاحب الحساب',value:form.contactName,edit:1},{name:'المنشأة',value:form.businessName,edit:2},{name:'النشاط',value:form.industry==='salon'?'صالون':'متجر',edit:2},{name:'التطبيقات',value:form.selectedApps.map(c=>labels[c]??c).join(' · '),edit:3}].map(x=><div key={x.name} className="flex items-center justify-between gap-3 py-3"><div className="min-w-0"><div className="text-xs text-slate-600">{x.name}</div><div className="break-words text-sm font-bold">{x.value}</div></div><button type="button" disabled={busy} onClick={()=>goto(x.edit)} className="text-xs font-bold text-[#087e7a]">تعديل</button></div>)}</div>
        {otpRequired&&<div className="mt-5 rounded-xl border border-teal-200 bg-teal-50 p-4"><div className="flex items-center gap-2 font-bold"><MessageCircle className="h-5 w-5 text-[#087e7a]"/> تأكيد الرقم على واتساب</div><p className="mt-2 text-xs leading-6 text-slate-700">اطلب الكود هنا عشان يكون صالح وقت إنشاء الحساب. الرمز صالح لمدة 5 دقائق، والتحقق بيتم عند الضغط على إنشاء الحساب.</p><button type="button" className={'mt-3 '+secondary} disabled={busy||cooldown>0} onClick={()=>void sendOtp()}>{cooldown>0?'إعادة الإرسال بعد '+cooldown+' ث':ticket?'إرسال رمز جديد':'إرسال رمز التحقق'}</button>{ticketValid&&<label className="mt-3 block text-sm font-bold">رمز التحقق<input type="text" inputMode="numeric" autoComplete="one-time-code" dir="ltr" maxLength={6} value={code} onChange={e=>setCode(e.target.value.replace(/[٠-٩]/g,d=>String(d.charCodeAt(0)-1632)).replace(/[۰-۹]/g,d=>String(d.charCodeAt(0)-1776)).replace(/\D/g,'').slice(0,6))} className={'mt-2 text-center font-mono text-xl tracking-[0.4em] '+input} placeholder="000000"/></label>}{ticket&&!ticketValid&&<p role="status" className="mt-2 text-sm text-amber-800">انتهت صلاحية الكود. اطلب رمزًا جديدًا.</p>}</div>}
        </>}
        {error&&<p role="alert" className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p>}
        </>}
      </div>
      {!done&&<footer className="shrink-0 border-t border-slate-200 bg-white"><div className="mx-auto flex w-full max-w-[760px] items-center justify-between gap-3 px-5 py-4 sm:px-8 lg:px-10 lg:py-5"><button type="button" className={secondary} disabled={step===0||busy} onClick={()=>goto(step-1)}><ArrowRight className="h-4 w-4"/> السابق</button>{step<4?<button type="button" className={primary} disabled={busy} onClick={next}>متابعة <ArrowLeft className="h-4 w-4"/></button>:<button type="button" className={primary} disabled={busy||(otpRequired&&(!ticketValid||code.length!==6))} onClick={()=>void submit()}>{busy?<Loader2 className="h-4 w-4 animate-spin"/>:<ShieldCheck className="h-4 w-4"/>}{busy?'جاري تجهيز الحساب…':'إنشاء الحساب'}</button>}</div></footer>}
    </section>
  </div>;
}

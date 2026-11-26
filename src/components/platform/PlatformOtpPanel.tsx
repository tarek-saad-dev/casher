'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { CheckCircle2, CircleAlert, Loader2, MessageCircle, ShieldCheck } from 'lucide-react';

const endpoint = '/api/admin/platform/authentication/otp';
type Status = { required:boolean; configured:boolean; senderKeyPresent:boolean; independentSigningKeyPresent:boolean; edgeRateLimitDeclared:boolean; providerUrlPresent:boolean };
type Challenge = { ticket:string; phone:string; expiresAtUtc:string };
const button = 'inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-[#087e7a] px-4 py-2 text-sm font-bold text-white disabled:opacity-50';
const field = 'w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm text-[#102433] outline-none focus:ring-2 focus:ring-teal-200';

export default function PlatformOtpPanel() {
  const [status,setStatus]=useState<Status|null>(null);
  const [phone,setPhone]=useState('');
  const [code,setCode]=useState('');
  const [challenge,setChallenge]=useState<Challenge|null>(null);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [success,setSuccess]=useState('');
  const [retry,setRetry]=useState(0);
  const [now,setNow]=useState(0);
  const pending=useRef(false);
  const load=useCallback(async()=>{
    setError('');
    try{
      const response=await fetch(endpoint,{cache:'no-store'});
      const data=await response.json();
      if(!response.ok||!data.status)throw new Error('تعذر تحميل إعدادات التحقق.');
      setStatus(data.status);
    }catch(e){setStatus(null);setError(e instanceof Error?e.message:'تعذر التحميل.');}
  },[]);
  useEffect(()=>{void load();},[load]);
  useEffect(()=>{const t=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(t);},[]);
  const cooldown=Math.max(0,Math.ceil((retry-now)/1000));
  const valid=!!challenge&&challenge.phone===phone&&Date.parse(challenge.expiresAtUtc)>now;
  async function act(action:'send'|'verify'){
    if(pending.current||!status?.configured)return;
    if(action==='send'&&Date.now()<retry)return;
    if(action==='verify'&&(!challenge||!valid||Date.parse(challenge.expiresAtUtc)<=Date.now()||!/^\d{6}$/.test(code)))return;
    pending.current=true;setBusy(true);setError('');setSuccess('');
    if(action==='send'){setChallenge(null);setCode('');const n=Date.now();setNow(n);setRetry(n+60000);}
    try{
      const response=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,phone,...(action==='verify'&&challenge?{ticket:challenge.ticket,code}:{})}),cache:'no-store'});
      const data=await response.json().catch(()=>({}));
      if(!response.ok||!data.ok)throw new Error(data.error||'تعذر تنفيذ الاختبار.');
      if(action==='send'){
        if(typeof data.ticket!=='string'||!Number.isFinite(Date.parse(data.expiresAtUtc)))throw new Error('استجابة إرسال غير صالحة.');
        setChallenge({ticket:data.ticket,phone,expiresAtUtc:data.expiresAtUtc});
        setRetry(Date.now()+Math.max(60,Math.min(300,Number(data.resendAfterSec)||60))*1000);
        setSuccess('تم قبول إرسال الرمز من المزود. راجع واتساب.');
      }else{
        if(data.verified!==true)throw new Error('لم يتم تأكيد الرمز.');
        setChallenge(null);setCode('');setSuccess('نجح التحقق من رمز الاختبار. لم يتم إنشاء أي حساب.');
      }
    }catch(e){setError(e instanceof Error?e.message:'تعذر تنفيذ الاختبار.');if(action==='verify')setCode('');}
    finally{pending.current=false;setBusy(false);}
  }
  return <section dir="rtl" className="space-y-5 rounded-2xl bg-[#eef2f5] p-4 text-[#102433] sm:p-7">
    <header className="rounded-2xl bg-[#102433] p-5 text-white"><div className="flex items-center gap-2 text-sm text-[#66e0da]"><ShieldCheck className="h-5 w-5"/> أمان المنصة</div><h2 className="mt-2 text-2xl font-black">التحقق من رقم الموبايل</h2><p className="mt-2 text-sm text-slate-200">إعدادات تسجيل المنشآت الجديدة — DRVO AutoResponse.</p></header>
    <div className="grid gap-4 lg:grid-cols-2">
      <section className="rounded-2xl border border-slate-200 bg-white p-5">
        <h3 className="font-black">جاهزية الإعدادات</h3><p className="mt-1 text-xs leading-6 text-slate-600">حالة الإعداد لا تعني أن رقم واتساب متصل؛ اختبار إرسال وتحقق فعلي هو الدليل.</p>
        {status?<><div className="mt-4 divide-y divide-slate-100">{([
          ['رابط المزود موجود',status.providerUrlPresent],['مفتاح حساب الإرسال موجود',status.senderKeyPresent],['مفتاح توقيع مستقل',status.independentSigningKeyPresent],['إقرار تهيئة حماية الطلبات',status.edgeRateLimitDeclared],['الإعدادات تستوفي الشروط',status.configured]
        ] as const).map(([label,ok])=><div key={label} className="flex items-center justify-between gap-3 py-3 text-sm"><span>{label}</span><span className={'flex items-center gap-1 text-xs font-bold '+(ok?'text-emerald-700':'text-amber-800')}>{ok?<CheckCircle2 className="h-4 w-4"/>:<CircleAlert className="h-4 w-4"/>}{ok?'موجود':'ناقص'}</span></div>)}</div><div className="mt-4 rounded-xl bg-slate-50 p-3 text-sm font-bold">التحقق الإلزامي للتسجيل: {status.required?'مفعّل في إعدادات السيرفر':'غير مفعّل'}</div></>:<p role="status" className="mt-4 text-sm text-slate-600">الإعدادات غير محملة.</p>}
        <button type="button" onClick={()=>void load()} disabled={busy} className="mt-4 rounded-lg border border-slate-300 px-3 py-2 text-xs font-bold">تحديث الحالة</button>
      </section>
      <section className="rounded-2xl border border-slate-200 bg-white p-5"><h3 className="flex items-center gap-2 font-black"><MessageCircle className="h-5 w-5 text-teal-700"/> اختبار واتساب</h3><p className="mt-2 text-sm leading-7 text-slate-600">استخدم رقم اختبار تملكه. الإرسال فعلي ويستهلك رسالة من حساب الإرسال؛ لا ينشئ منشأة.</p>
        <label className="mt-4 block text-sm font-bold">رقم الاختبار<input className={'mt-2 '+field} type="tel" dir="ltr" maxLength={32} placeholder="01012345678" value={phone} disabled={busy} onChange={e=>{setPhone(e.target.value);setChallenge(null);setCode('');setSuccess('');setError('');}}/></label>
        <button type="button" className={'mt-3 '+button} disabled={!status?.configured||busy||!phone.trim()||cooldown>0} onClick={()=>void act('send')}>{busy&&<Loader2 className="h-4 w-4 animate-spin"/>}{cooldown?'إعادة الإرسال بعد '+cooldown+' ث':'إرسال رمز تجريبي'}</button>
        {valid&&<><label className="mt-4 block text-sm font-bold">رمز التحقق<input className={'mt-2 text-center font-mono tracking-widest '+field} dir="ltr" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} disabled={busy} onChange={e=>setCode(e.target.value.replace(/\D/g,'').slice(0,6))}/></label><button type="button" className={'mt-3 '+button} disabled={busy||code.length!==6} onClick={()=>void act('verify')}>تحقق من الرمز</button></>}
        {challenge&&!valid&&<p className="mt-3 text-xs text-amber-800">انتهت صلاحية الرمز. اطلب رمزًا جديدًا.</p>}
        {success&&<p role="status" className="mt-3 rounded-xl bg-emerald-50 p-3 text-sm text-emerald-800">{success}</p>}
        {error&&<p role="alert" className="mt-3 rounded-xl bg-red-50 p-3 text-sm text-red-800">{error}</p>}
      </section>
    </div>
    <section className="rounded-2xl border border-slate-200 bg-white p-5"><h3 className="font-black">ربط رقم الإرسال</h3><ol className="mt-3 list-decimal space-y-2 pe-4 text-sm leading-7 text-slate-700"><li>افتح DRVO AutoResponse واختار حساب DRVO المخصص للتحقق واربط رقم واتساب عبر QR.</li><li>جهز مفتاح الربط الخاص بالمنصة، وليس مفتاح أي منشأة عميلة. خزّنه في إعدادات السيرفر مع مفتاح توقيع مستقل.</li><li>بعد تهيئة حماية الطلبات، نفّذ اختبار الإرسال والتحقق على بيئة الاختبار قبل التفعيل.</li></ol><p className="mt-4 text-xs leading-6 text-slate-600">لا يمكن تغيير المفاتيح أو تفعيل الإلزام من الصفحة الحالية. لا تعرض اللوحة أي قيمة سرية.</p><a href="https://app.drvotech.com/dashboard/integrations" target="_blank" rel="noreferrer" className="mt-3 inline-block text-sm font-bold text-teal-700 underline">فتح تكاملات DRVO AutoResponse</a></section>
  </section>;
}

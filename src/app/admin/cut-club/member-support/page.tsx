'use client';
import { useState } from 'react';
import { Search, LogOut, Unlink, AlertTriangle } from 'lucide-react';

type Account={accountId:string;phoneMasked:string;linkStatus:string;legacyClientId:number|null;clientName:string|null;
  linkApprovedAt:string|null;linkApprovedBy:number|null;createdAt:string;liveSessions:number};
const statusLabel:Record<string,string>={ACTIVE:'مربوط بمحفظة',REVIEW_REQUIRED:'يحتاج مراجعة ربط',UNLINKED:'عضو جديد بدون سجل'};

export default function CutClubMemberSupportPage(){
  const [phone,setPhone]=useState('');
  const [account,setAccount]=useState<Account|null|undefined>(undefined);
  const [reason,setReason]=useState('');
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState('');
  const [error,setError]=useState('');

  const search=async(e?:React.FormEvent)=>{
    e?.preventDefault();setError('');setMessage('');setBusy(true);
    try{
      const r=await fetch('/api/admin/cut-club/member-account?phone='+encodeURIComponent(phone),{cache:'no-store',credentials:'same-origin'});
      const d=await r.json();
      if(!r.ok||!d.ok)throw Error(d?.code||'DENIED');
      setAccount(d.account);
    }catch(err){
      setAccount(undefined);
      setError(err instanceof Error&&err.message==='INVALID_PHONE'?'رقم الموبايل غير صحيح.':'البحث غير متاح. تأكد من الصلاحيات وتفعيل النظام.');
    }finally{setBusy(false);}
  };
  const act=async(action:'UNLINK'|'REVOKE_SESSIONS')=>{
    if(!account||reason.trim().length<5)return;
    if(action==='UNLINK'&&!window.confirm('فك ربط المحفظة؟ العميل هيحتاج مراجعة هوية جديدة علشان يشوف رصيده.'))return;
    setBusy(true);setError('');setMessage('');
    try{
      const r=await fetch('/api/admin/cut-club/member-account',{method:'POST',credentials:'same-origin',
        headers:{'Content-Type':'application/json'},body:JSON.stringify({accountId:account.accountId,action,reason:reason.trim()})});
      const d=await r.json();
      if(!r.ok||!d.ok)throw Error(d?.code||'DENIED');
      setMessage(action==='UNLINK'
        ?`تم فك الربط وإلغاء ${d.revokedSessions} جلسة. الحساب رجع لحالة المراجعة.`
        :`تم إلغاء ${d.revokedSessions} جلسة. العميل محتاج يسجل دخول من جديد.`);
      setReason('');await search();
    }catch{setError('تعذر تنفيذ العملية. حدّث الصفحة وحاول تاني.');}
    finally{setBusy(false);}
  };

  return <main dir="rtl" lang="ar" className="mx-auto max-w-3xl space-y-6 p-5">
    <div><p className="text-sm font-bold text-amber-700">CUT CLUB / STAFF ONLY</p>
      <h1 className="mt-2 text-3xl font-black">دعم عضويات العملاء</h1>
      <p className="mt-3 text-sm text-slate-500">ابحث برقم الموبايل الموثّق. تقدر تخرج العميل من كل الأجهزة أو تفك ربط محفظته. النقاط والقسائم مش بتتأثر.</p></div>
    <form onSubmit={search} className="flex gap-2">
      <input dir="ltr" inputMode="tel" value={phone} onChange={e=>setPhone(e.target.value)} placeholder="01xxxxxxxxx"
        className="h-12 flex-1 rounded-lg border px-4" required/>
      <button disabled={busy} className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-5 text-sm font-bold text-white disabled:opacity-50"><Search className="h-4 w-4"/> بحث</button>
    </form>
    {account===null&&<p className="text-sm text-slate-600">مفيش عضوية CUT CLUB مسجلة بالرقم ده.</p>}
    {account&&<section className="space-y-4 rounded-xl border bg-white p-5 text-sm">
      <dl className="grid grid-cols-2 gap-3">
        <dt className="text-slate-500">الرقم</dt><dd dir="ltr" className="text-right">{account.phoneMasked}</dd>
        <dt className="text-slate-500">الحالة</dt><dd className="font-bold">{statusLabel[account.linkStatus]||account.linkStatus}</dd>
        <dt className="text-slate-500">سجل Casher</dt><dd>{account.legacyClientId?`${account.clientName||'بدون اسم'} #${account.legacyClientId}`:'—'}</dd>
        <dt className="text-slate-500">اعتماد الربط</dt><dd>{account.linkApprovedAt?`${new Date(account.linkApprovedAt).toLocaleString('ar-EG')} — موظف #${account.linkApprovedBy}`:'—'}</dd>
        <dt className="text-slate-500">جلسات مفتوحة</dt><dd>{account.liveSessions}</dd>
      </dl>
      <label className="block font-semibold">سبب الإجراء (إلزامي)
        <input value={reason} onChange={e=>setReason(e.target.value)} maxLength={300}
          className="mt-2 block h-11 w-full rounded-lg border px-3" placeholder="مثال: العميل فقد موبايله"/>
      </label>
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={busy||reason.trim().length<5||account.liveSessions===0} onClick={()=>void act('REVOKE_SESSIONS')}
          className="inline-flex min-h-11 items-center gap-2 rounded-lg border px-4 font-bold disabled:opacity-50"><LogOut className="h-4 w-4"/> خروج من كل الأجهزة</button>
        {account.linkStatus==='ACTIVE'&&<button type="button" disabled={busy||reason.trim().length<5} onClick={()=>void act('UNLINK')}
          className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-red-700 px-4 font-bold text-white disabled:opacity-50"><Unlink className="h-4 w-4"/> فك ربط المحفظة</button>}
      </div>
      {account.linkStatus!=='ACTIVE'&&<p className="text-slate-500">لربط الحساب بسجل عميل استخدم <a className="underline" href="/admin/cut-club/member-review">مراجعة ربط العضويات</a>.</p>}
    </section>}
    {message&&<p role="status" className="text-sm font-semibold text-green-800">{message}</p>}
    {error&&<p role="alert" className="flex items-center gap-2 text-sm text-red-700"><AlertTriangle className="h-4 w-4"/>{error}</p>}
  </main>;
}

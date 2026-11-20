'use client';
import { useCallback, useEffect, useState } from 'react';
import { ShieldCheck, Link2, RefreshCw, AlertTriangle } from 'lucide-react';

type Pending={accountId:string;phoneMasked:string;linkStatus:string;createdAt:string};
type Candidate={clientId:number;name:string|null;visits:number|null;hasLoyalty:boolean;linkedElsewhere:boolean};
export default function CutClubMemberReviewPage(){
  const [items,setItems]=useState<Pending[]>([]);
  const [selected,setSelected]=useState('');
  const [clientId,setClientId]=useState('');
  const [approved,setApproved]=useState(false);
  const [loading,setLoading]=useState(false);
  const [saving,setSaving]=useState(false);
  const [message,setMessage]=useState('');
  const [error,setError]=useState('');
  const [candidates,setCandidates]=useState<Candidate[]|null>(null);
  const [candidatesLoading,setCandidatesLoading]=useState(false);
  const [manualEntry,setManualEntry]=useState(false);
  const loadCandidates=useCallback(async(accountId:string)=>{
    setCandidates(null);setClientId('');setManualEntry(false);setCandidatesLoading(true);
    try{
      const resp=await fetch('/api/admin/cut-club/member-link/candidates?accountId='+encodeURIComponent(accountId),{cache:'no-store',credentials:'same-origin'});
      const data=await resp.json();
      if(!resp.ok||!data.ok)throw Error(data?.code||'DENIED');
      setCandidates(data.items||[]);
    }catch{setCandidates(null);setManualEntry(true);}
    finally{setCandidatesLoading(false);}
  },[]);
  const reload=useCallback(async()=>{
    setLoading(true);setError('');
    try {
      const resp=await fetch('/api/admin/cut-club/member-link',{cache:'no-store',credentials:'same-origin'});
      const data=await resp.json();
      if(!resp.ok||!data.ok)throw Error(data?.code||'NOT_AUTHORIZED');
      setItems(data.items||[]);
    }catch{setError('مراجعة العضويات غير متاحة. تأكد من تسجيل الدخول بصلاحيات الإدارة ومن تفعيل النظام.');}
    finally{setLoading(false);}
  },[]);
  useEffect(()=>{void reload();},[reload]);
  const submit=async(e:React.FormEvent)=>{
    e.preventDefault();setMessage('');setError('');
    const id=Number(clientId);
    if(!selected||!Number.isSafeInteger(id)||id<=0||!approved)return;
    setSaving(true);
    try{
      const res=await fetch('/api/admin/cut-club/member-link',{
        method:'POST',headers:{'Content-Type':'application/json'},credentials:'same-origin',
        body:JSON.stringify({accountId:selected,clientId:id,proofType:'IN_PERSON_ID',confirmedInPerson:true})
      });
      const data=await res.json();
      if(!res.ok||data.ok!==true)throw Error(data?.code||'DENIED');
      setMessage('تم اعتماد الربط بعد التحقق من العميل. المحفظة تظهر في جلسة CUT CLUB.');
      setSelected('');setClientId('');setApproved(false);setCandidates(null);await reload();
    }catch(err){
      setError(err instanceof Error&&err.message==='CLIENT_ALREADY_LINKED'
        ?'تعذر الربط: سجل العميل ده مربوط بالفعل بعضوية تانية. راجع الحالة مع الإدارة.'
        :'تعذر الربط: لازم رقم العميل والرقم الموثق يتطابقوا، وما يكونش الحساب مرتبط مسبقًا.');
    }
    finally{setSaving(false);}
  };
  return <main dir="rtl" lang="ar" className="mx-auto max-w-5xl space-y-6 p-5">
    <div className="flex flex-wrap items-center justify-between gap-4">
      <div><p className="text-sm font-bold text-amber-700">CUT CLUB / STAFF ONLY</p><h1 className="mt-2 text-3xl font-black">مراجعة ربط عضوية العملاء</h1>
        <p className="mt-3 text-sm text-slate-500">إثبات ملكية الرقم بـOTP لا يكفي وحده لصرف أرصدة العميل القديمة. راجع الهوية داخل الفرع قبل الربط.</p></div>
      <button type="button" onClick={()=>void reload()} disabled={loading} className="inline-flex items-center gap-2 rounded-lg border px-4 py-3 text-sm font-semibold"><RefreshCw className="h-4 w-4"/> تحديث</button>
    </div>
    <section className="rounded-xl border bg-white p-5">
      <h2 className="mb-3 text-lg font-bold">حسابات تحتاج مراجعة</h2>
      {items.length===0?<p className="text-sm text-slate-500">لا توجد حسابات معلّقة أو القائمة غير متاحة بعد.</p>:
        <div className="overflow-auto"><table className="w-full min-w-[560px] text-right text-sm">
          <thead><tr className="border-b"><th className="p-3">اختيار</th><th>الهاتف (مخفي جزئيًا)</th><th>الحالة</th><th>التاريخ</th></tr></thead>
          <tbody>{items.map(it=><tr key={it.accountId} className="border-b">
            <td className="p-3"><input type="radio" name="account" checked={selected===it.accountId} onChange={()=>{setSelected(it.accountId);setApproved(false);void loadCandidates(it.accountId);}} aria-label={'مراجعة '+it.phoneMasked}/></td>
            <td dir="ltr" className="text-right">{it.phoneMasked}</td><td>{it.linkStatus==='REVIEW_REQUIRED'?'يحتاج ربط سجل قديم':'عضو جديد'}</td>
            <td>{new Date(it.createdAt).toLocaleDateString('ar-EG')}</td>
          </tr>)}</tbody>
        </table></div>}
    </section>
    <form onSubmit={submit} className="space-y-4 rounded-xl border border-amber-200 bg-amber-50 p-5">
      <div className="flex items-center gap-2 text-amber-900"><AlertTriangle className="h-5 w-5"/><h2 className="text-lg font-bold">اعتماد الربط بعد فحص الهوية</h2></div>
      <p className="text-sm leading-7 text-amber-900">افتح سجل العميل بنفسك من إدارة العملاء / الولاء وتأكد حضوره وهويته ورقم هاتفه. لو الرقم مكرر، اتأكد من صاحب السجل الصحيح؛ ممنوع الاختيار تلقائيًا.</p>
      {!selected&&<p className="text-sm text-slate-600">اختار حساب من القائمة فوق علشان تظهر سجلات Casher اللي بنفس الرقم.</p>}
      {selected&&candidatesLoading&&<p className="text-sm text-slate-600">جاري البحث عن سجلات العملاء بنفس الرقم…</p>}
      {selected&&!candidatesLoading&&candidates&&candidates.length===0&&
        <p className="text-sm font-semibold text-slate-700">مفيش سجل في Casher بنفس الرقم. ده عضو جديد ومفيش محفظة قديمة تتربط.</p>}
      {selected&&!candidatesLoading&&candidates&&candidates.length>0&&<fieldset className="space-y-2">
        <legend className="mb-2 text-sm font-semibold">سجلات Casher بنفس الرقم الموثق</legend>
        {candidates.length>1&&<p className="text-sm font-bold text-red-700">الرقم ده مسجل على {candidates.length} سجلات. اسأل العميل واختار صاحب السجل الصحيح بعد مراجعة الهوية.</p>}
        {candidates.map(c=><label key={c.clientId} className={'flex items-center gap-3 rounded-lg border bg-white p-3 text-sm '+(c.linkedElsewhere?'opacity-50':'')}>
          <input type="radio" name="candidate" disabled={c.linkedElsewhere} checked={clientId===String(c.clientId)} onChange={()=>{setClientId(String(c.clientId));setApproved(false);}}/>
          <span className="font-bold">{c.name||'بدون اسم'}</span>
          <span className="text-slate-500">#{c.clientId}</span>
          <span className="text-slate-500">{c.visits!==null?c.visits+' زيارة':c.hasLoyalty?'':'بدون سجل ولاء'}</span>
          {c.linkedElsewhere&&<span className="text-red-700">مربوط بعضوية أخرى</span>}
        </label>)}
      </fieldset>}
      {selected&&!candidatesLoading&&(manualEntry
        ?<label className="block text-sm font-semibold">ClientID من Casher (إدخال يدوي)
          <input type="number" min="1" step="1" value={clientId} onChange={e=>setClientId(e.target.value)}
            className="mt-2 block h-12 w-full rounded-lg border px-4" required placeholder="رقم سجل العميل الصحيح"/>
          {candidates===null&&<span className="mt-1 block text-xs font-normal text-slate-500">البحث التلقائي غير متاح حاليًا؛ ادخل الرقم يدويًا.</span>}
        </label>
        :<button type="button" onClick={()=>{setManualEntry(true);setClientId('');}} className="text-sm text-slate-600 underline">إدخال ClientID يدويًا بدل الاختيار</button>)}
      <label className="flex items-start gap-3 text-sm leading-7">
        <input type="checkbox" checked={approved} onChange={e=>setApproved(e.target.checked)} className="mt-1"/>
        أؤكد أن العميل حضر شخصيًا، وراجعت دليل هويته وسجل Casher قبل ربط المحفظة التاريخية.
      </label>
      <button disabled={!selected||!approved||!clientId||saving} type="submit"
        className="inline-flex min-h-12 items-center gap-2 rounded-lg bg-slate-900 px-6 text-sm font-bold text-white disabled:opacity-50"><Link2 className="h-4 w-4"/> اعتماد ربط المحفظة</button>
      {message&&<p role="status" className="flex items-center gap-2 text-sm font-semibold text-green-800"><ShieldCheck className="h-4 w-4"/>{message}</p>}
      {error&&<p role="alert" className="text-sm text-red-700">{error}</p>}
    </form>
  </main>;
}

'use client';
import { useCallback,useEffect,useState } from 'react';
type Item={ParticipantId:string;DisplayName:string;PhoneMasked:string;ReferralCode:string;ClientId:number|null;IsStudent:boolean;
 EducationType:string|null;Institution:string|null;FacultyOrSpecialization:string|null;AcademicYear:string|null;IdentityVerifiedAtUtc:string|null;StudentVerifiedAtUtc:string|null};
const endpoint='/api/admin/offers/december/participants';
export default function DecemberParticipants(){
 const [items,setItems]=useState<Item[]>([]),[search,setSearch]=useState(''),[selected,setSelected]=useState<Item|null>(null);
 const [recoveryReason,setRecoveryReason]=useState(''),[recoveryToken,setRecoveryToken]=useState('');
 const [client,setClient]=useState(''),[identity,setIdentity]=useState(false),[card,setCard]=useState(false);
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[success,setSuccess]=useState('');
 const load=useCallback(async(code='')=>{
  setBusy(true);setError('');setRecoveryToken('');setRecoveryReason('');setItems([]);setSelected(null);setClient('');setIdentity(false);setCard(false);
  try{const r=await fetch(endpoint+(code?'?'+(/^CUT-/i.test(code)?'code':'phone')+'='+encodeURIComponent(code):''),{cache:'no-store'});
   const d=await r.json();if(!r.ok||d.ok!==true)throw Error('UNAVAILABLE');setItems(d.items);
  }catch{setError('تعذر تحميل المشاركين. تأكد من تفعيل الحملة وصلاحية الإدارة.');}finally{setBusy(false);}
 },[]);
 useEffect(()=>{void load();},[load]);
 async function verify(e:React.FormEvent){
  e.preventDefault();if(!selected||!identity||!Number.isSafeInteger(Number(client))||Number(client)<=0||busy)return;
  setBusy(true);setError('');setSuccess('');
  try{const r=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},
   body:JSON.stringify({participantId:selected.ParticipantId,clientId:Number(client),confirmedInPerson:identity,studentCardChecked:card})});
   const d=await r.json();if(!r.ok||d.ok!==true)throw Error(d.code||'UNAVAILABLE');
   setSuccess('تم ربط العميل واعتماد البيانات المحددة. لا يوجد خصم مالي مطبق.');await load(search.trim());
  }catch(e){setError(e instanceof Error&&e.message==='IDENTITY_MISMATCH'?'رقم الهاتف في سجل العميل لا يطابق التسجيل.':'تعذر الاعتماد. راجع بيانات العميل والحالة والصلاحيات.');}finally{setBusy(false);}
 }
 async function recover(){if(!selected?.IdentityVerifiedAtUtc||!identity||busy||recoveryReason.trim().length<5)return;setBusy(true);setRecoveryToken('');setError('');
 try{const r=await fetch('/api/admin/offers/december/recover',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({participantId:selected.ParticipantId,confirmedInPerson:true,reason:recoveryReason})});const d=await r.json();if(!r.ok||d.ok!==true||typeof d.recoveryToken!=='string')throw Error();setRecoveryToken(d.recoveryToken);setRecoveryReason('');}catch{setError('تعذر استرجاع الجلسة؛ راجع تطابق الهوية والرقم.');}finally{setBusy(false);}}
 return <main dir="rtl" className="mx-auto max-w-6xl p-5 space-y-6">
  <header><p className="text-sm font-bold text-red-600">CUT / DECEMBER EXAM</p><h1 className="text-3xl font-black">مراجعة المشاركين</h1><p className="text-sm text-muted-foreground mt-2">اعتماد الهوية وبيانات الطالب قبل استحقاق الخصم. شاشة الإدارة التجريبية.</p></header>
  <nav className="flex flex-wrap gap-4 text-sm"><a href="/admin/offers/december/education" className="underline">المؤسسات التعليمية</a><a href="/admin/offers/december/config" className="underline">الإعدادات</a><a href="/admin/offers/december/analytics" className="underline">نتائج الحملة</a></nav>
  <form className="flex flex-wrap gap-2" onSubmit={e=>{e.preventDefault();setSuccess('');void load(search.trim());}}>
   <input className="rounded-lg border bg-background p-3 flex-1" value={search} onChange={e=>setSearch(e.target.value)} placeholder="كود التسجيل أو رقم الموبايل" dir="ltr" aria-label="كود تسجيل العميل"/>
   <button disabled={busy} className="border rounded-lg px-4">بحث / تحديث</button></form>
  {error&&<p role="alert" className="text-red-600">{error}</p>}{success&&<p role="status" className="text-green-600">{success}</p>}
  <section className="rounded-xl border overflow-x-auto"><table className="w-full text-right min-w-[650px] text-sm"><thead><tr className="border-b"><th className="p-3">الاسم</th><th>الهاتف</th><th>التعليم</th><th>الحالة</th><th>مراجعة</th></tr></thead><tbody>
   {items.map(it=><tr key={it.ParticipantId} className="border-b"><td className="p-3">{it.DisplayName}</td><td dir="ltr">{it.PhoneMasked}</td><td>{[it.Institution,it.FacultyOrSpecialization].filter(Boolean).join(' / ')||'غير طالب'}</td><td>{it.IdentityVerifiedAtUtc?'تم الربط':'معلق'}</td><td><button type="button" disabled={busy} className="underline p-3" onClick={()=>{setRecoveryToken('');setRecoveryReason('');setSelected(it);setClient(it.ClientId?String(it.ClientId):'');setIdentity(false);setCard(false);setSuccess('');}}>اختيار</button></td></tr>)}
   {!items.length&&<tr><td colSpan={5} className="p-5 text-center">{busy?'جاري التحميل…':'لا توجد نتائج في القائمة الحالية'}</td></tr>}</tbody></table></section>
  {selected&&<form onSubmit={verify} className="border rounded-xl p-5 space-y-4">
   <h2 className="font-bold text-lg">{selected.DisplayName}</h2><p>{selected.Institution} {selected.FacultyOrSpecialization} {selected.AcademicYear}</p>
   <p className="text-sm">لو عميل جديد، أنشئ سجل العميل بالطريقة المعتادة في Casher أولًا. تأكد من الهوية والرقم وعدم تكرار السجل قبل الربط.</p>
   <label className="block">Client ID<input required type="number" min={1} step={1} disabled={selected.ClientId!==null} value={client} onChange={e=>setClient(e.target.value)} className="block border rounded-md p-3 bg-background w-full"/></label>
   <label className="flex gap-2"><input type="checkbox" checked={identity} onChange={e=>setIdentity(e.target.checked)}/> راجعت هوية العميل حضوريًا وتأكدت من السجل الصحيح.</label>
   {selected.IsStudent&&<label className="flex gap-2"><input type="checkbox" checked={card} onChange={e=>setCard(e.target.checked)}/> راجعت كارنيه الطالب الساري وتطابق المؤسسة والكلية.</label>}
   <button disabled={busy||!identity||!client} className="rounded-md bg-[#CF252B] text-white px-6 py-3 disabled:opacity-50">اعتماد</button>
  </form>}
 {selected?.IdentityVerifiedAtUtc&&<section className="border rounded-xl p-5 space-y-3"><h2 className="font-bold">استرجاع جلسة الحملة</h2><p className="text-sm">بعد التحقق حضوريًا فقط. إلغاء الجلسة السابقة وإصدار رمز دخول بديل للحملة، ليس لحساب CUT CLUB.</p><textarea value={recoveryReason} onChange={e=>setRecoveryReason(e.target.value)} maxLength={300} placeholder="سبب الاسترجاع" className="border rounded bg-background w-full p-3"/><button type="button" disabled={busy||!identity||recoveryReason.trim().length<5} onClick={()=>void recover()} className="border rounded p-3">إصدار رمز بديل</button>{recoveryToken&&<div className="border rounded p-3"><p>سلّم الرمز للعميل بشكل خاص فقط، ولا ترسله في لينك أو جروب.</p><code dir="ltr" className="break-all block">{recoveryToken}</code><button onClick={()=>setRecoveryToken('')} className="underline">إخفاء الرمز</button></div>}</section>}
 </main>;
}

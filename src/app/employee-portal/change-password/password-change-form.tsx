'use client';
import { FormEvent, useState } from 'react';
import { useRouter } from 'next/navigation';
export default function PasswordChangeForm({forced}:{forced:boolean}) {
  const router=useRouter();
  const [current,setCurrent]=useState('');
  const [next,setNext]=useState('');
  const [confirm,setConfirm]=useState('');
  const [error,setError]=useState('');
  const [busy,setBusy]=useState(false);
  async function submit(event:FormEvent) {
    event.preventDefault();
    if(next.length<12 || next!==confirm) {setError('كلمة المرور الجديدة لازم 12 حرف على الأقل وتطابق التأكيد');return;}
    setBusy(true);setError('');
    try {
      const response=await fetch('/api/employee-portal/change-password',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({current,next})});
      if(!response.ok)throw new Error('تعذر تغيير كلمة المرور. اتأكد من كلمة المرور الحالية');
      router.replace('/employee-portal');router.refresh();
    } catch(e) {setError(e instanceof Error?e.message:'حدث خطأ');}
    finally {setBusy(false);}
  }
  return <main dir="rtl" className="flex-1 flex items-center justify-center p-4 bg-zinc-950 text-white">
    <form onSubmit={submit} className="max-w-md w-full bg-zinc-900 border border-zinc-800 rounded-2xl p-6 space-y-4">
      <h1 className="text-2xl font-bold">{forced?'لازم تغيّر كلمة المرور أول مرة':'تغيير كلمة المرور'}</h1>
      <p className="text-zinc-400 text-sm">كلمة المرور الجديدة خاصة بيك. بعد الحفظ سجّل دخول تاني.</p>
      <label className="block text-sm">كلمة المرور الحالية<input type="password" autoComplete="current-password" required value={current} onChange={e=>setCurrent(e.target.value)} className="mt-2 w-full p-3 rounded-lg border border-zinc-700 bg-zinc-950"/></label>
      <label className="block text-sm">كلمة المرور الجديدة<input type="password" autoComplete="new-password" required minLength={12} value={next} onChange={e=>setNext(e.target.value)} className="mt-2 w-full p-3 rounded-lg border border-zinc-700 bg-zinc-950"/></label>
      <label className="block text-sm">تأكيد كلمة المرور<input type="password" autoComplete="new-password" required minLength={12} value={confirm} onChange={e=>setConfirm(e.target.value)} className="mt-2 w-full p-3 rounded-lg border border-zinc-700 bg-zinc-950"/></label>
      {error&&<p role="alert" className="text-rose-400 text-sm">{error}</p>}
      <button disabled={busy} className="bg-amber-500 text-zinc-950 font-semibold rounded-lg w-full p-3">{busy?'جاري الحفظ...':'حفظ كلمة المرور'}</button>
    </form>
  </main>;
}

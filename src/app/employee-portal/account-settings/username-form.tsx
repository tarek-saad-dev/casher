'use client';
import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
export default function UsernameForm({currentUsername}:{currentUsername:string}) {
 const router=useRouter();const [username,setUsername]=useState(currentUsername);
 const [password,setPassword]=useState('');const [busy,setBusy]=useState(false);const [error,setError]=useState('');
 async function submit(e:FormEvent) {
  e.preventDefault();setBusy(true);setError('');
  try{
   const response=await fetch('/api/employee-portal/change-username',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username,password})});
   const data=await response.json();
   if(!response.ok)throw new Error(data.error==='USERNAME_TAKEN'?'اسم الدخول مستخدم بالفعل':data.error==='WRONG_PASSWORD'?'كلمة المرور الحالية غير صحيحة':'تعذر تغيير اسم الدخول، راجع البيانات وحاول تاني');
   router.replace('/employee-portal');router.refresh();
  }catch(err){setError(err instanceof Error?err.message:'حدث خطأ');}finally{setBusy(false);}
 }
 return <form onSubmit={submit} className="space-y-4 rounded-2xl border border-zinc-800 bg-zinc-900 p-5">
  <h2 className="font-bold text-lg">تغيير اسم الدخول</h2>
  <p className="text-sm text-zinc-400">حروف إنجليزية فقط، بدون أرقام. ينفع تفصل بين الأسماء بنقطة أو شرطة. بعد التغيير هتسجل دخول من جديد.</p>
  <label className="block text-sm">اسم الدخول الجديد<input dir="ltr" required minLength={3} maxLength={60} pattern="[a-z]+([._-][a-z]+)*" value={username} onChange={e=>setUsername(e.target.value.toLowerCase())} className="block w-full mt-2 bg-zinc-950 border border-zinc-700 rounded-lg p-3"/></label>
  <label className="block text-sm">كلمة المرور الحالية للتأكيد<input type="password" autoComplete="current-password" required value={password} onChange={e=>setPassword(e.target.value)} className="block w-full mt-2 bg-zinc-950 border border-zinc-700 rounded-lg p-3"/></label>
  {error&&<p className="text-rose-400 text-sm" role="alert">{error}</p>}
  <button disabled={busy} className="rounded-lg bg-amber-500 text-zinc-950 px-5 py-3 font-bold disabled:opacity-50">{busy?'جاري الحفظ...':'حفظ اسم الدخول'}</button>
 </form>;
}

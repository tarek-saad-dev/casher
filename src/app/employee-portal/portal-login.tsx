'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function EmployeePortalLogin() {
  const router = useRouter();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setError('');
    try {
      const res = await fetch('/api/employee-portal/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      if (!res.ok) throw new Error('اسم المستخدم أو كلمة المرور غير صحيحة أو الحساب غير مفعّل');
      router.refresh();
    } catch (e) { setError(e instanceof Error ? e.message : 'تعذر تسجيل الدخول'); }
    finally { setBusy(false); }
  }
  return (
    <main dir="rtl" className="flex-1 bg-zinc-950 flex items-center justify-center p-5 text-white">
      <form onSubmit={submit} className="w-full max-w-sm rounded-3xl border border-zinc-800 bg-zinc-900 p-7 space-y-5">
        <div className="text-sm font-bold text-amber-400">CUT SALON · بوابة الموظفين</div>
        <h1 className="text-2xl font-bold">حسابك الشخصي</h1>
        <p className="text-zinc-400 text-sm">تابع مستحقاتك وعمولاتك والسلف والخصومات</p>
        <label className="block text-sm">اسم المستخدم<input required autoComplete="username" maxLength={100} value={username}
          onChange={e => setUsername(e.target.value)} className="mt-2 w-full rounded-xl bg-zinc-950 border border-zinc-700 p-3" /></label>
        <label className="block text-sm">كلمة المرور<input required type="password" autoComplete="current-password" value={password}
          onChange={e => setPassword(e.target.value)} className="mt-2 w-full rounded-xl bg-zinc-950 border border-zinc-700 p-3" /></label>
        {error && <p role="alert" className="text-sm text-rose-400">{error}</p>}
        <button disabled={busy} className="w-full rounded-xl bg-amber-500 py-3 text-zinc-950 font-bold disabled:opacity-50">
          {busy ? 'جاري التحقق...' : 'تسجيل الدخول'}
        </button>
      </form>
    </main>
  );
}

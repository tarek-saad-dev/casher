'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

type Branch = { id: number; name: string };
type Role = { id: string; key: string; name: string };
export default function CreateMemberForm({ branches, roles }: { branches: Branch[]; roles: Role[] }) {
  const router = useRouter();
  const [form, setForm] = useState({ userName: '', loginName: '', password: '', branchId: String(branches[0]?.id ?? ''), roleId: roles[0]?.id ?? '' });
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState('');
  const [created, setCreated] = useState(false);
  function change(field: keyof typeof form, value: string) {
    setForm(previous => ({ ...previous, [field]: value }));
    setConfirmed(false); setResult('');
  }
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!confirmed || busy || created) return;
    setBusy(true); setResult('');
    try {
      const response = await fetch('/api/drvo/tenant/members', {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', 'x-drvo-member-intent': '1' },
        body: JSON.stringify({ ...form, branchId: Number(form.branchId) }),
      });
      const payload = await response.json() as { error?: string };
      if (!response.ok) { setResult('فشل إنشاء المستخدم: ' + (payload.error ?? response.status)); return; }
      setCreated(true);
      setForm(previous => ({ ...previous, password: '' }));
      setResult('تم إنشاء الموظف وربطه بالفرع والدور بنجاح. يمكنك تحديث الصفحة لرؤيته.');
      router.refresh();
    } catch { setResult('تعذر التأكد من النتيجة. راجع قائمة المستخدمين قبل إعادة الإنشاء.'); }
    finally { setBusy(false); }
  }
  return <form onSubmit={submit} className="mt-6 rounded-2xl border border-cyan-300/20 bg-[#101a2c] p-6">
    <h2 className="text-lg font-bold">إضافة موظف جديد</h2>
    <p className="mt-2 text-xs leading-6 text-slate-400">سيُنشأ حساب مستقل داخل شركتك فقط. صلاحيات DRVO تتحدد بالدور، والوصول التشغيلي القديم غير مفعل تلقائيًا.</p>
    <div className="mt-5 grid gap-4 sm:grid-cols-2">
      <label className="text-sm">اسم الموظف<input required maxLength={50} value={form.userName} disabled={busy||created} onChange={e=>change('userName',e.target.value)} className="mt-2 w-full rounded-xl border border-white/15 bg-[#0b1424] px-4 py-3" /></label>
      <label className="text-sm">اسم الدخول (إنجليزي، 4 أحرف على الأقل)<input required minLength={4} maxLength={49} pattern="[A-Za-z][A-Za-z0-9_.-]{3,48}" autoComplete="off" value={form.loginName} disabled={busy||created} onChange={e=>change('loginName',e.target.value)} className="mt-2 w-full rounded-xl border border-white/15 bg-[#0b1424] px-4 py-3" /></label>
      <label className="text-sm">كلمة مرور مبدئية (12 حرفًا على الأقل)<input required type="password" minLength={12} maxLength={100} autoComplete="new-password" value={form.password} disabled={busy||created} onChange={e=>change('password',e.target.value)} className="mt-2 w-full rounded-xl border border-white/15 bg-[#0b1424] px-4 py-3" /></label>
      <label className="text-sm">الفرع<select required value={form.branchId} disabled={busy||created} onChange={e=>change('branchId',e.target.value)} className="mt-2 w-full rounded-xl border border-white/15 bg-[#0b1424] px-4 py-3">{branches.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}</select></label>
      <label className="text-sm">دور DRVO<select required value={form.roleId} disabled={busy||created} onChange={e=>change('roleId',e.target.value)} className="mt-2 w-full rounded-xl border border-white/15 bg-[#0b1424] px-4 py-3">{roles.map(r=><option key={r.id} value={r.id}>{r.name} ({r.key})</option>)}</select></label>
    </div>
    <label className="mt-5 flex items-center gap-2 text-sm text-amber-200"><input type="checkbox" checked={confirmed} disabled={busy||created} onChange={e=>setConfirmed(e.target.checked)} /> أؤكد إنشاء حساب جديد وربطه بالفرع والدور المحددين</label>
    {result&&<p role="status" className="mt-4 text-sm text-slate-200">{result}</p>}
    <button type="submit" disabled={!confirmed||!form.roleId||!form.branchId||busy||created} className="mt-5 rounded-xl bg-cyan-300 px-5 py-3 text-sm font-bold text-slate-950 disabled:opacity-40">{busy?'جارٍ الإنشاء…':created?'تم الإنشاء':'إنشاء الموظف'}</button>
  </form>;
}

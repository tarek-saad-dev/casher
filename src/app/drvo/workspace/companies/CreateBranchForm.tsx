'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function CreateBranchForm() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState(false);
  const [message, setMessage] = useState('');
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!confirmed || busy || created) return;
    setBusy(true); setMessage('');
    try {
      const response = await fetch('/api/drvo/tenant/branches', {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', 'x-drvo-branch-intent': '1' },
        body: JSON.stringify({ branchCode: code.trim().toUpperCase(), branchName: name.trim() }),
      });
      const data = await response.json() as { error?: string };
      if (!response.ok) { setMessage('تعذر إنشاء الفرع: ' + (data.error ?? response.status)); return; }
      setCreated(true);
      setMessage('تم إنشاء الفرع في وضع الإعداد SETUP. لم يتم فتح التشغيل أو الحجوزات العامة.');
      router.refresh();
    } catch { setMessage('تعذر التحقق من النتيجة. راجع قائمة الفروع قبل إعادة الإنشاء.'); }
    finally { setBusy(false); }
  }
  return <form onSubmit={submit} className="mt-6 rounded-2xl border border-cyan-300/20 bg-[#101a2c] p-6">
    <h2 className="text-lg font-bold">إضافة فرع</h2>
    <p className="mt-2 text-sm text-slate-400">الفرع الجديد يبدأ في حالة الإعداد فقط، والتشغيل والحجوزات والإشعارات تظل مغلقة حتى مرحلة التفعيل.</p>
    <div className="mt-5 grid gap-4 sm:grid-cols-2">
      <label className="text-sm">اسم الفرع<input required maxLength={100} value={name} disabled={busy||created} onChange={e=>{setName(e.target.value);setConfirmed(false);}} className="mt-2 w-full rounded-xl border border-white/15 bg-[#0b1424] px-4 py-3" /></label>
      <label className="text-sm">كود الفرع بالإنجليزي<input required minLength={3} maxLength={30} pattern="[A-Za-z][A-Za-z0-9_]{2,29}" value={code} disabled={busy||created} onChange={e=>{setCode(e.target.value);setConfirmed(false);}} className="mt-2 w-full rounded-xl border border-white/15 bg-[#0b1424] px-4 py-3" /></label>
    </div>
    <label className="mt-5 flex items-center gap-2 text-sm text-amber-200"><input type="checkbox" checked={confirmed} disabled={busy||created} onChange={e=>setConfirmed(e.target.checked)}/>أؤكد إضافة الفرع بحالة إعداد غير نشطة</label>
    {message&&<p role="status" className="mt-4 text-sm text-slate-200">{message}</p>}
    <button type="submit" disabled={!confirmed||!name.trim()||!code.trim()||busy||created} className="mt-5 rounded-xl bg-cyan-300 px-5 py-3 text-sm font-bold text-slate-950 disabled:opacity-40">{busy?'جارٍ الإنشاء…':created?'تم الإنشاء':'إنشاء الفرع'}</button>
  </form>;
}

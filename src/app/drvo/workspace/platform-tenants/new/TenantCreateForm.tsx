'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

const initial = { tenantDisplayName: '', tenantCode: '', industryPackCode: 'salon', firstBranchName: '', firstBranchCode: '', ownerUserName: '', ownerLoginName: '', ownerPassword: '' };
type FormState = typeof initial;

export default function TenantCreateForm() {
  const router = useRouter();
  const [form, setForm] = useState<FormState>(initial);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState('');
  const [created, setCreated] = useState(false);
  function change(key: keyof FormState, value: string) {
    setForm(previous => ({ ...previous, [key]: value }));
    setConfirm(false);
    setResult('');
  }
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!confirm || busy || created) return;
    setBusy(true);
    setResult('');
    try {
      const response = await fetch('/api/drvo/platform/tenants', {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', 'x-drvo-tenant-intent': '1' },
        body: JSON.stringify(form),
      });
      const payload = await response.json() as { error?: string; tenantCode?: string; readiness?: string };
      if (!response.ok) {
        setResult('فشل الإنشاء: ' + (payload.error ?? response.status));
        return;
      }
      setCreated(true);
      setResult('تم إنشاء الشركة ' + (payload.tenantCode ?? '') + ' بنجاح. فحص الجاهزية: ' + (payload.readiness ?? 'غير متاح'));
      setForm(previous => ({ ...previous, ownerPassword: '' }));
      router.refresh();
    } catch {
      setResult('تعذر التأكد من نتيجة الطلب. لا تعيد الإنشاء قبل مراجعة دليل الشركات لتجنب التكرار.');
    } finally {
      setBusy(false);
    }
  }
  const fields: { key: keyof FormState; label: string; placeholder: string; type?: string }[] = [
    { key: 'tenantDisplayName', label: 'اسم الشركة', placeholder: 'اسم النشاط التجاري' },
    { key: 'tenantCode', label: 'كود الشركة (فريد)', placeholder: 'EXAMPLE_COMPANY' },
    { key: 'firstBranchName', label: 'اسم الفرع الأول', placeholder: 'الفرع الرئيسي' },
    { key: 'firstBranchCode', label: 'كود الفرع (فريد)', placeholder: 'EXAMPLE_MAIN' },
    { key: 'ownerUserName', label: 'اسم مالك الشركة', placeholder: 'الاسم المعروض' },
    { key: 'ownerLoginName', label: 'اسم الدخول (فريد)', placeholder: 'company_owner' },
    { key: 'ownerPassword', label: 'كلمة مرور المالك (12 حرفًا على الأقل)', placeholder: 'كلمة مرور قوية', type: 'password' },
  ];
  return (
    <form onSubmit={submit} className="mt-8 rounded-2xl border border-white/10 bg-[#101a2c] p-5 sm:p-8">
      <p className="mb-6 text-sm leading-7 text-slate-400">إنشاء شركة ومالك وفرع أول باشتراك تجريبي. العملية تكتب بيانات جديدة على قاعدة Staging فقط.</p>
      <div className="grid gap-5 sm:grid-cols-2">
        {fields.map(field => <label key={field.key} className="block text-sm font-medium">
          {field.label}
          <input required disabled={busy || created} type={field.type ?? 'text'} autoComplete={field.type === 'password' ? 'new-password' : 'off'}
            minLength={field.type === 'password' ? 12 : undefined} maxLength={field.type === 'password' ? 50 : 100}
            value={form[field.key]} onChange={event => change(field.key, event.target.value)} placeholder={field.placeholder}
            className="mt-2 block w-full rounded-xl border border-white/15 bg-[#0b1424] px-4 py-3 text-sm text-white placeholder:text-slate-600 focus:border-cyan-300 focus:outline-none" />
        </label>)}
        <label className="block text-sm font-medium">نوع النشاط
          <select disabled={busy || created} value={form.industryPackCode} onChange={event => change('industryPackCode', event.target.value)}
            className="mt-2 block w-full rounded-xl border border-white/15 bg-[#0b1424] px-4 py-3 text-sm text-white">
            <option value="salon">صالون</option>
            <option value="clinic">عيادة</option>
            <option value="supermarket">سوبر ماركت</option>
          </select>
        </label>
      </div>
      <label className="mt-7 flex items-start gap-3 rounded-xl border border-amber-300/20 p-4 text-sm leading-7">
        <input type="checkbox" checked={confirm} disabled={busy || created} onChange={event => setConfirm(event.target.checked)} className="mt-1.5" />
        <span>أؤكد إنشاء شركة جديدة على قاعدة Staging مع مالك وفرع واشتراك تجريبي. لن يتم تعديل CASHER_BOOT.</span>
      </label>
      {result && <p role="status" className="mt-5 rounded-xl border border-white/10 p-4 text-sm">{result}</p>}
      <button type="submit" disabled={!confirm || busy || created} className="mt-6 rounded-xl bg-cyan-300 px-6 py-3 font-bold text-slate-950 disabled:opacity-40">{busy ? 'جارٍ الإنشاء…' : created ? 'تم الإنشاء' : 'إنشاء الشركة'}</button>
    </form>
  );
}

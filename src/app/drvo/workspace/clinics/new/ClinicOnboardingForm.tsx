'use client';

import { useState, type FormEvent } from 'react';
import Link from 'next/link';

type Fields = {
  tenantCode: string;
  tenantDisplayName: string;
  ownerUserName: string;
  ownerLoginName: string;
  ownerPassword: string;
  firstBranchCode: string;
  firstBranchName: string;
};
const initial: Fields = {
  tenantCode: '', tenantDisplayName: '', ownerUserName: '',
  ownerLoginName: '', ownerPassword: '', firstBranchCode: '', firstBranchName: '',
};
const labels: Record<keyof Fields, string> = {
  tenantDisplayName: 'اسم العيادة / المركز',
  tenantCode: 'كود الشركة (إنجليزي)',
  firstBranchName: 'اسم الفرع الأول',
  firstBranchCode: 'كود الفرع (إنجليزي)',
  ownerUserName: 'اسم مدير العيادة',
  ownerLoginName: 'اسم مستخدم المدير',
  ownerPassword: 'كلمة مرور المدير',
};

export default function ClinicOnboardingForm() {
  const [values, setValues] = useState<Fields>(initial);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ tenantId: string; tenantCode: string; branchCode: string; ownerLoginName: string; readiness: string } | null>(null);
  const [error, setError] = useState('');
  const update = (field: keyof Fields, value: string) => {
    setValues(previous => ({ ...previous, [field]: value }));
    setError('');
  };

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true); setError('');
    try {
      const response = await fetch('/api/drvo/platform/tenants', {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', 'x-drvo-tenant-intent': '1' },
        body: JSON.stringify({
          ...values,
          tenantCode: values.tenantCode.trim().toUpperCase(),
          firstBranchCode: values.firstBranchCode.trim().toUpperCase(),
          industryPackCode: 'clinic',
        }),
      });
      const body = await response.json();
      if (!response.ok) {
        setError(typeof body.error === 'string' ? body.error : 'تعذر إنشاء العيادة');
        return;
      }
      setResult(body);
      setValues(previous => ({ ...previous, ownerPassword: '' }));
    } catch {
      setError('تعذر الاتصال بالسيرفر. تأكد من الاتصال ثم حاول مرة أخرى.');
    } finally {
      setBusy(false);
    }
  }

  if (result) return (
    <section role="status" className="rounded-3xl border border-emerald-400/25 bg-[#101a2c] p-7 sm:p-9">
      <p className="text-sm font-bold text-emerald-300">تم إنشاء العيادة على Staging</p>
      <h2 className="mt-3 text-2xl font-black">{result.tenantCode}</h2>
      <dl className="mt-6 grid gap-4 text-sm sm:grid-cols-2">
        <div><dt className="text-slate-400">كود الفرع</dt><dd className="mt-1 font-bold">{result.branchCode}</dd></div>
        <div><dt className="text-slate-400">حساب المدير</dt><dd className="mt-1 font-bold" dir="ltr">{result.ownerLoginName}</dd></div>
        <div className="sm:col-span-2"><dt className="text-slate-400">معرّف الشركة</dt><dd className="mt-1 break-all font-mono text-xs">{result.tenantId}</dd></div>
        <div><dt className="text-slate-400">حالة الجاهزية الأولية</dt><dd className="mt-1 font-bold">{result.readiness}</dd></div>
      </dl>
      <p className="mt-6 text-sm leading-7 text-amber-200">تم إنشاء الهيكل الإداري، لكن تشغيل المواعيد والملفات الطبية والفوترة يحتاج تفعيل الوحدات والتحقق من صلاحياتها. لا تستخدم بيانات مرضى حقيقية بعد.</p>
      <div className="mt-6 flex flex-wrap gap-3">
        <button type="button" onClick={() => setResult(null)} className="rounded-xl bg-cyan-300 px-5 py-3 text-sm font-bold text-slate-950">إضافة عيادة أخرى</button>
        <Link href="/drvo/workspace" className="rounded-xl border border-white/15 px-5 py-3 text-sm">العودة للوحة التحكم</Link>
      </div>
    </section>
  );

  return (
    <form onSubmit={submit} className="space-y-6 rounded-3xl border border-white/10 bg-[#101a2c] p-6 sm:p-9">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-black">بيانات العيادة الجديدة</h2>
        <span className="rounded-full border border-cyan-300/20 bg-cyan-300/10 px-3 py-1.5 text-xs text-cyan-200">Clinic Pack · Trial</span>
      </div>
      <div className="grid gap-5 sm:grid-cols-2">
        {(Object.keys(labels) as (keyof Fields)[]).map(field => (
          <label key={field} className="block space-y-2 text-sm">
            <span className="font-semibold">{labels[field]}</span>
            <input
              type={field === 'ownerPassword' ? 'password' : 'text'}
              autoComplete={field === 'ownerPassword' ? 'new-password' : 'off'}
              required
              minLength={field === 'ownerPassword' ? 12 : undefined}
              maxLength={field === 'ownerPassword' ? 50 : 100}
              pattern={field === 'tenantCode' ? '[A-Za-z][A-Za-z0-9_]{2,62}' : field === 'firstBranchCode' ? '[A-Za-z][A-Za-z0-9_]{2,29}' : undefined}
              value={values[field]}
              onChange={e => update(field, e.target.value)}
              dir={field === 'tenantCode' || field === 'firstBranchCode' || field === 'ownerLoginName' || field === 'ownerPassword' ? 'ltr' : 'auto'}
              className="w-full rounded-xl border border-white/15 bg-[#080e1a] px-4 py-3 text-sm text-white outline-none focus:border-cyan-300"
              placeholder={field === 'tenantCode' ? 'CLINIC_001' : field === 'firstBranchCode' ? 'CLINIC_001_MAIN' : undefined}
            />
          </label>
        ))}
      </div>
      <p className="text-xs leading-6 text-slate-400">كل كود واسم دخول لازم يكون فريدًا. كلمة المرور 12 حرفًا على الأقل، ولا يتم عرضها بعد الإنشاء.</p>
      {error && <p role="alert" className="rounded-xl border border-rose-400/30 bg-rose-400/10 p-4 text-sm text-rose-200">تعذر إنشاء العيادة: {error}</p>}
      <button type="submit" disabled={busy} className="w-full rounded-xl bg-cyan-300 px-5 py-3.5 text-sm font-black text-slate-950 disabled:cursor-not-allowed disabled:opacity-50">
        {busy ? 'جاري إنشاء العيادة…' : 'إنشاء العيادة والفرع وحساب المدير'}
      </button>
    </form>
  );
}

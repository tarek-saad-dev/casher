'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { platformFetch } from '@/components/platform/platformFetch';
import type { IndustryPackDefinition } from '@/platform/packs/types';
import type { SaaSPlanRecord } from '@/platform/commercial/types';
import type { ProvisionTenantResult } from '@/platform/onboarding/types';

type CatalogApp = { appCode: string; displayName: string; requires: string[] };

const EMPTY = {
  tenantCode: '',
  tenantDisplayName: '',
  defaultTimezone: 'Africa/Cairo',
  ownerUserName: '',
  ownerLoginName: '',
  ownerPassword: '',
  firstBranchCode: '',
  firstBranchName: '',
  branchAddress: '',
  branchPhone: '',
  planCode: '',
  subscriptionStatus: 'trial' as 'trial' | 'active',
  logoUrl: '',
  brandPhone: '',
  primaryColor: '',
  receiptFooter: '',
};

type FormState = typeof EMPTY;

function Field({
  label,
  value,
  onChange,
  type = 'text',
  dir,
  hint,
  required,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  dir?: 'ltr';
  hint?: string;
  required?: boolean;
}) {
  return (
    <label className="space-y-1 text-sm">
      <span className="text-muted-foreground">
        {label}
        {required && <span className="text-rose-500"> *</span>}
      </span>
      <input
        type={type}
        dir={dir}
        required={required}
        className="w-full rounded-lg border border-border bg-background px-3 py-2"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      {hint && <span className="block text-xs text-muted-foreground">{hint}</span>}
    </label>
  );
}

export default function NewTenantPage() {
  const [packs, setPacks] = useState<IndustryPackDefinition[]>([]);
  const [plans, setPlans] = useState<SaaSPlanRecord[]>([]);
  const [catalog, setCatalog] = useState<CatalogApp[]>([]);
  const [packCode, setPackCode] = useState('');
  const [add, setAdd] = useState<string[]>([]);
  const [remove, setRemove] = useState<string[]>([]);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ProvisionTenantResult | null>(null);

  useEffect(() => {
    Promise.all([
      platformFetch<{ packs: IndustryPackDefinition[] }>('/api/admin/platform/packs'),
      platformFetch<{ plans: SaaSPlanRecord[] }>('/api/admin/platform/plans'),
      platformFetch<{ apps: CatalogApp[] }>('/api/admin/platform/apps'),
    ])
      .then(([p, pl, a]) => {
        setPacks(p.packs);
        setPlans(pl.plans.filter((x) => x.isActive));
        setCatalog(a.apps);
      })
      .catch((e: Error) => setError(e.message));
  }, []);

  const pack = packs.find((p) => p.packCode === packCode) ?? null;
  const finalApps = useMemo(() => {
    if (!pack) return [];
    const set = new Set<string>([...pack.required, ...pack.recommended]);
    add.forEach((a) => set.add(a));
    remove.forEach((r) => set.delete(r));
    pack.required.forEach((r) => set.add(r));
    return [...set].sort();
  }, [pack, add, remove]);

  const set = (key: keyof FormState) => (v: string) => setForm((f) => ({ ...f, [key]: v }));

  const toggleApp = (code: string) => {
    if (!pack || pack.required.includes(code)) return;
    const isDefault = pack.recommended.includes(code);
    const installed = finalApps.includes(code);
    if (isDefault) {
      setRemove((r) => (installed ? [...r, code] : r.filter((x) => x !== code)));
    } else {
      setAdd((a) => (installed ? a.filter((x) => x !== code) : [...a, code]));
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!packCode) {
      setError('اختر حزمة الصناعة');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const brand = {
        logoUrl: form.logoUrl || null,
        phone: form.brandPhone || null,
        primaryColor: form.primaryColor || null,
        receiptFooter: form.receiptFooter || null,
      };
      const res = await platformFetch<ProvisionTenantResult>('/api/admin/platform/tenants', {
        method: 'POST',
        body: JSON.stringify({
          tenantCode: form.tenantCode,
          tenantDisplayName: form.tenantDisplayName,
          defaultTimezone: form.defaultTimezone,
          ownerUserName: form.ownerUserName,
          ownerLoginName: form.ownerLoginName,
          ownerPassword: form.ownerPassword,
          firstBranchCode: form.firstBranchCode,
          firstBranchName: form.firstBranchName,
          branchAddress: form.branchAddress || null,
          branchPhone: form.branchPhone || null,
          industryPackCode: packCode,
          appCustomizations: { add, remove },
          planCode: form.planCode || undefined,
          subscriptionStatus: form.subscriptionStatus,
          brand,
        }),
      });
      setResult(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر إنشاء المنشأة');
    } finally {
      setBusy(false);
    }
  };

  if (result) {
    return (
      <section className="space-y-3 rounded-xl border border-emerald-500/40 p-4">
        <h2 className="text-lg font-semibold text-emerald-500">تم إنشاء المنشأة {result.tenantCode}</h2>
        <ul className="space-y-1 text-sm">
          <li>الفرع الأول: {result.branchCode} (جاهز للتشغيل)</li>
          <li>
            المالك: <span className="font-mono">{result.ownerLoginName}</span> — دور {result.ownerRole}
          </li>
          <li>الحزمة: {result.industryPackCode} — التطبيقات: {result.apps.join('، ')}</li>
          <li>
            الخطة: {result.planCode} — {result.subscriptionStatus}
            {result.trialEndsAt ? ` حتى ${new Date(result.trialEndsAt).toLocaleDateString('ar-EG')}` : ''}
          </li>
          <li>الجاهزية: {result.readiness.overall}</li>
        </ul>
        <Link href={`/platform/tenants/${result.tenantId}`} className="text-primary hover:underline">
          فتح تفاصيل المنشأة
        </Link>
      </section>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-5">
      <h2 className="text-lg font-semibold">إنشاء منشأة جديدة</h2>

      <fieldset className="grid gap-3 rounded-xl border border-border p-4 sm:grid-cols-2">
        <legend className="px-1 text-sm font-semibold">المنشأة</legend>
        <Field label="كود المنشأة" value={form.tenantCode} onChange={set('tenantCode')} dir="ltr" required
          hint="حروف إنجليزية كبيرة وأرقام و _ — يبدأ بحرف" />
        <Field label="اسم المنشأة" value={form.tenantDisplayName} onChange={set('tenantDisplayName')} required />
        <Field label="المنطقة الزمنية" value={form.defaultTimezone} onChange={set('defaultTimezone')} dir="ltr" required />
        <label className="space-y-1 text-sm">
          <span className="text-muted-foreground">حزمة الصناعة <span className="text-rose-500">*</span></span>
          <select
            required
            className="w-full rounded-lg border border-border bg-background px-3 py-2"
            value={packCode}
            onChange={(e) => {
              setPackCode(e.target.value);
              setAdd([]);
              setRemove([]);
            }}
          >
            <option value="">— اختر —</option>
            {packs.map((p) => (
              <option key={p.packCode} value={p.packCode}>
                {p.displayName} ({p.packCode})
              </option>
            ))}
          </select>
        </label>
      </fieldset>

      {pack && (
        <fieldset className="rounded-xl border border-border p-4">
          <legend className="px-1 text-sm font-semibold">التطبيقات المثبتة</legend>
          <div className="flex flex-wrap gap-2">
            {catalog.map((app) => {
              const required = pack.required.includes(app.appCode);
              const on = finalApps.includes(app.appCode);
              return (
                <button
                  type="button"
                  key={app.appCode}
                  onClick={() => toggleApp(app.appCode)}
                  disabled={required}
                  className={`rounded-full border px-3 py-1 text-xs ${
                    on ? 'border-primary bg-primary/15 text-primary' : 'border-border text-muted-foreground'
                  } ${required ? 'opacity-80' : ''}`}
                  title={required ? 'مطلوب في هذه الحزمة' : app.requires.length ? `يتطلب: ${app.requires.join(', ')}` : ''}
                >
                  {app.displayName}
                  {required ? ' (مطلوب)' : ''}
                </button>
              );
            })}
          </div>
        </fieldset>
      )}

      <fieldset className="grid gap-3 rounded-xl border border-border p-4 sm:grid-cols-2">
        <legend className="px-1 text-sm font-semibold">الاشتراك</legend>
        <label className="space-y-1 text-sm">
          <span className="text-muted-foreground">الخطة</span>
          <select
            className="w-full rounded-lg border border-border bg-background px-3 py-2"
            value={form.planCode}
            onChange={(e) => set('planCode')(e.target.value)}
          >
            <option value="">الافتراضية (starter)</option>
            {plans.map((p) => (
              <option key={p.planCode} value={p.planCode}>
                {p.displayName} — فروع {p.maxBranches ?? '∞'} / مستخدمون {p.maxUsers ?? '∞'}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1 text-sm">
          <span className="text-muted-foreground">الحالة الابتدائية</span>
          <select
            className="w-full rounded-lg border border-border bg-background px-3 py-2"
            value={form.subscriptionStatus}
            onChange={(e) => set('subscriptionStatus')(e.target.value)}
          >
            <option value="trial">تجريبي</option>
            <option value="active">نشط</option>
          </select>
        </label>
      </fieldset>

      <fieldset className="grid gap-3 rounded-xl border border-border p-4 sm:grid-cols-2">
        <legend className="px-1 text-sm font-semibold">المالك (دور مدير المنشأة)</legend>
        <Field label="اسم المالك" value={form.ownerUserName} onChange={set('ownerUserName')} required />
        <Field label="اسم الدخول" value={form.ownerLoginName} onChange={set('ownerLoginName')} dir="ltr" required />
        <Field label="كلمة المرور" value={form.ownerPassword} onChange={set('ownerPassword')} type="password" dir="ltr" required />
      </fieldset>

      <fieldset className="grid gap-3 rounded-xl border border-border p-4 sm:grid-cols-2">
        <legend className="px-1 text-sm font-semibold">الفرع الأول</legend>
        <Field label="كود الفرع" value={form.firstBranchCode} onChange={set('firstBranchCode')} dir="ltr" required />
        <Field label="اسم الفرع" value={form.firstBranchName} onChange={set('firstBranchName')} required />
        <Field label="العنوان" value={form.branchAddress} onChange={set('branchAddress')} />
        <Field label="الهاتف" value={form.branchPhone} onChange={set('branchPhone')} dir="ltr" />
      </fieldset>

      <fieldset className="grid gap-3 rounded-xl border border-border p-4 sm:grid-cols-2">
        <legend className="px-1 text-sm font-semibold">الهوية (اختياري)</legend>
        <Field label="رابط الشعار" value={form.logoUrl} onChange={set('logoUrl')} dir="ltr" hint="/path أو https://" />
        <Field label="هاتف الإيصالات" value={form.brandPhone} onChange={set('brandPhone')} dir="ltr" />
        <Field label="اللون الأساسي" value={form.primaryColor} onChange={set('primaryColor')} dir="ltr" hint="#RRGGBB" />
        <Field label="تذييل الإيصال" value={form.receiptFooter} onChange={set('receiptFooter')} />
      </fieldset>

      {error && <p className="text-sm text-rose-500">{error}</p>}
      <button
        type="submit"
        disabled={busy}
        className="rounded-lg bg-primary px-5 py-2 text-sm text-primary-foreground disabled:opacity-50"
      >
        {busy ? 'جاري الإنشاء…' : 'إنشاء المنشأة'}
      </button>
    </form>
  );
}

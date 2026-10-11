'use client';

import { useState } from 'react';
import {
  BOOKING_DEFAULT_MODES,
  BOOKING_MAX_DAYS_AHEAD_RANGE,
  BOOKING_MIN_NOTICE_OPTIONS,
  BOOKING_SLOT_INTERVAL_OPTIONS,
} from '@/lib/booking/bookingSettingsValidation';
import { EMPLOYMENT_TYPES, PAYROLL_METHODS } from '@/lib/hr/employee-hr-model';
import { formatEgp, getPlanPricing } from '@/platform/commercial/pricingCatalog';
import type { SaaSPlanRecord } from '@/platform/commercial/types';
import {
  addBranch,
  emptyEmployee,
  emptyService,
  emptyUser,
  removeBranch,
  setBusinessName,
  setIndustryPack,
  setTenantCode,
  toggleApp,
  type OnboardingDraft,
} from '@/platform/onboarding/wizard/draft';
import {
  JOB_OPTIONS,
  MIN_PASSWORD_LENGTH,
  ONBOARDING_USER_ROLES,
  conversationPackForIndustry,
  defaultAcceptsBookings,
  generateStrongPassword,
  packAppGroups,
  usesServiceCatalog,
} from '@/platform/onboarding/wizard/plan';
import type { OnboardingIssue } from '@/platform/onboarding/wizard/types';
import type { IndustryPackDefinition } from '@/platform/packs/types';
import {
  Advanced,
  Card,
  Field,
  SelectField,
  SmallButton,
  Toggle,
  copyText,
  fieldError,
  inputClass,
} from './wizardUi';

export type StepProps = {
  draft: OnboardingDraft;
  update: (fn: (d: OnboardingDraft) => OnboardingDraft) => void;
  /** Issues to show inline (empty until the operator tries to continue). */
  issues: OnboardingIssue[];
  pack: IndustryPackDefinition | null;
  apps: string[];
  appNames: Map<string, string>;
};

const EMPLOYMENT_LABELS: Record<string, string> = { full_time: 'دوام كامل', part_time: 'دوام جزئي', freelance: 'فري لانس' };
const PAYROLL_LABELS: Record<string, string> = { hourly: 'بالساعة', daily: 'يومي', monthly: 'شهري' };
const MODE_LABELS: Record<string, string> = { nearest: 'أقرب موظف متاح', specific: 'اختيار موظف محدد' };

const num = (v: string) => (v === '' ? Number.NaN : Number(v));
const opt = (v: string) => (v.trim() ? v : null);
const shown = (n: number) => (Number.isFinite(n) ? n : '');

function branchOptions(draft: OnboardingDraft) {
  return draft.branches.map((b, i) => ({ value: String(i), label: b.branchName.trim() || `الفرع ${i + 1}` }));
}

function replaceAt<T>(list: T[], index: number, patch: Partial<T>): T[] {
  return list.map((item, i) => (i === index ? { ...item, ...patch } : item));
}

export function BusinessStep({ draft, update, issues, packs }: StepProps & { packs: IndustryPackDefinition[] }) {
  const b = draft.business;
  const err = (f: string) => fieldError(issues, f);
  const setBiz = (patch: Partial<typeof b>) => update((d) => ({ ...d, business: { ...d.business, ...patch } }));
  return (
    <div className="space-y-4">
      <Card title="بيانات المنشأة" subtitle="الاسم ونوع النشاط يحددان التطبيقات والخطوات التالية">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field
            label="اسم المنشأة"
            required
            autoFocus
            value={b.businessName}
            error={err('businessName')}
            onChange={(v) => update((d) => setBusinessName(d, v))}
          />
          <div className="space-y-1 text-sm">
            <span className="text-muted-foreground">
              نوع النشاط <span className="text-rose-500">*</span>
            </span>
            <div className="flex flex-wrap gap-2">
              {packs.map((p) => (
                <button
                  key={p.packCode}
                  type="button"
                  aria-pressed={b.industryPackCode === p.packCode}
                  onClick={() => update((d) => setIndustryPack(d, p.packCode))}
                  className={`rounded-lg border px-3 py-2 text-sm ${
                    b.industryPackCode === p.packCode
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'border-border hover:bg-muted'
                  }`}
                >
                  {p.displayName}
                </button>
              ))}
            </div>
            {err('industryPackCode') && <span className="block text-xs text-rose-500">{err('industryPackCode')}</span>}
          </div>
          <Field label="هاتف المنشأة" dir="ltr" value={b.businessPhone ?? ''} onChange={(v) => setBiz({ businessPhone: opt(v) })} />
          <Field label="تذييل الإيصال" value={b.receiptFooter ?? ''} onChange={(v) => setBiz({ receiptFooter: opt(v) })} />
        </div>
      </Card>
      <Card title="الهوية (اختياري)">
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="رابط الشعار" dir="ltr" hint="https://… أو /…" value={b.logoUrl ?? ''} error={err('logoUrl')} onChange={(v) => setBiz({ logoUrl: opt(v) })} />
          <Field label="اللون الأساسي" dir="ltr" placeholder="#0F766E" value={b.primaryColor ?? ''} error={err('primaryColor')} onChange={(v) => setBiz({ primaryColor: opt(v) })} />
          <Field label="لون التمييز" dir="ltr" placeholder="#F59E0B" value={b.accentColor ?? ''} error={err('accentColor')} onChange={(v) => setBiz({ accentColor: opt(v) })} />
        </div>
      </Card>
      <Advanced>
        <Field
          label="كود المنشأة"
          dir="ltr"
          hint="يُنشأ تلقائياً من الاسم — حروف إنجليزية كبيرة وأرقام و _"
          value={b.tenantCode}
          error={err('tenantCode')}
          onChange={(v) => update((d) => setTenantCode(d, v))}
        />
        <Field label="المنطقة الزمنية" dir="ltr" value={b.timezone} error={err('timezone')} onChange={(v) => setBiz({ timezone: v })} />
        <Field label="العملة" dir="ltr" value={b.currency} error={err('currency')} onChange={(v) => setBiz({ currency: v.toUpperCase() })} />
      </Advanced>
    </div>
  );
}

export function BranchesStep({ draft, update, issues, plan }: StepProps & { plan: SaaSPlanRecord | null }) {
  const err = (f: string) => fieldError(issues, f);
  const atLimit = plan?.maxBranches != null && draft.branches.length >= plan.maxBranches;
  const setBranch = (i: number, patch: Partial<OnboardingDraft['branches'][number]>) =>
    update((d) => ({ ...d, branches: replaceAt(d.branches, i, patch) }));
  return (
    <div className="space-y-4">
      {draft.branches.map((br, i) => (
        <Card
          key={i}
          title={i === 0 ? 'الفرع الرئيسي' : `فرع ${i + 1}`}
          subtitle={i === 0 ? 'يعمل فور الإنشاء' : 'يُنشأ في وضع التجهيز ويُفعّل من إعداد الفروع'}
          actions={i > 0 && <SmallButton tone="danger" onClick={() => update((d) => removeBranch(d, i))}>حذف</SmallButton>}
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="اسم الفرع" required value={br.branchName} error={err(`branches.${i}.branchName`)} onChange={(v) => setBranch(i, { branchName: v })} />
            <Field label="العنوان" value={br.address ?? ''} onChange={(v) => setBranch(i, { address: opt(v) })} />
            <Field label="هاتف الفرع" dir="ltr" value={br.phone ?? ''} onChange={(v) => setBranch(i, { phone: opt(v) })} />
            <div className="grid grid-cols-2 gap-2">
              <Field label="يفتح" type="time" dir="ltr" value={br.defaultOpenTime ?? ''} error={err(`branches.${i}.hours`)} onChange={(v) => setBranch(i, { defaultOpenTime: opt(v) })} />
              <Field label="يغلق" type="time" dir="ltr" value={br.defaultCloseTime ?? ''} onChange={(v) => setBranch(i, { defaultCloseTime: opt(v) })} />
            </div>
          </div>
          <Advanced>
            <Field label="كود الفرع" dir="ltr" value={br.branchCode} error={err(`branches.${i}.branchCode`)} onChange={(v) => setBranch(i, { branchCode: v.toUpperCase() })} />
            <Field label="اسم مختصر" value={br.shortName ?? ''} error={err(`branches.${i}.shortName`)} onChange={(v) => setBranch(i, { shortName: opt(v) })} />
            <Field label="المنطقة الزمنية" dir="ltr" placeholder={draft.business.timezone} value={br.timezone ?? ''} error={err(`branches.${i}.timezone`)} onChange={(v) => setBranch(i, { timezone: opt(v) })} />
          </Advanced>
        </Card>
      ))}
      <div className="flex flex-wrap items-center gap-3">
        <SmallButton tone="primary" disabled={atLimit} onClick={() => update(addBranch)}>+ إضافة فرع</SmallButton>
        {plan?.maxBranches != null && (
          <span className="text-xs text-muted-foreground">
            خطة {plan.displayName}: حتى {plan.maxBranches} فرع
          </span>
        )}
      </div>
    </div>
  );
}

export function ServicesStep({ draft, update, issues, pack }: StepProps) {
  const err = (f: string) => fieldError(issues, f);
  if (!usesServiceCatalog(pack?.packCode)) {
    return (
      <Card title="إعداد الكتالوج" subtitle={pack?.displayName}>
        <p className="text-sm text-muted-foreground">
          يتم إعداد الأصناف والأسعار والمخزون بعد إنشاء المنشأة من شاشات الأصناف والمخزون. لا حاجة لإدخال أي شيء الآن.
        </p>
      </Card>
    );
  }
  const setService = (i: number, patch: Partial<OnboardingDraft['services'][number]>) =>
    update((d) => ({ ...d, services: replaceAt(d.services, i, patch) }));
  return (
    <Card
      title="الخدمات والأسعار"
      subtitle="خدمات خاصة بهذه المنشأة — يمكن التعديل لاحقاً"
      actions={<SmallButton tone="primary" onClick={() => update((d) => ({ ...d, services: [...d.services, emptyService()] }))}>+ خدمة</SmallButton>}
    >
      {draft.services.length === 0 && (
        <p className="text-sm text-muted-foreground">لا توجد خدمات بعد. أضف الخدمات الأساسية الآن أو لاحقاً من شاشة الخدمات.</p>
      )}
      <div className="space-y-2">
        {draft.services.map((s, i) => (
          <div key={i} className="grid items-start gap-2 rounded-lg border border-border p-2 sm:grid-cols-[2fr_1fr_1fr_1fr_auto]">
            <Field label="اسم الخدمة" required value={s.name} error={err(`services.${i}.name`)} onChange={(v) => setService(i, { name: v })} />
            <Field label="السعر" type="number" min={0} step={1} dir="ltr" value={shown(s.price)} error={err(`services.${i}.price`)} onChange={(v) => setService(i, { price: num(v) })} />
            <Field label="المدة (دقيقة)" type="number" min={5} step={5} dir="ltr" value={shown(s.durationMinutes)} error={err(`services.${i}.durationMinutes`)} onChange={(v) => setService(i, { durationMinutes: num(v) })} />
            <Field label="التصنيف" value={s.categoryName ?? ''} onChange={(v) => setService(i, { categoryName: opt(v) })} />
            <div className="flex flex-wrap items-center gap-1 pt-6">
              <Toggle label="مفعّلة" checked={s.active} onChange={(v) => setService(i, { active: v })} />
              <SmallButton title="تكرار" onClick={() => update((d) => ({ ...d, services: [...d.services.slice(0, i + 1), { ...s, name: `${s.name} (نسخة)` }, ...d.services.slice(i + 1)] }))}>تكرار</SmallButton>
              <SmallButton tone="danger" onClick={() => update((d) => ({ ...d, services: d.services.filter((_, j) => j !== i) }))}>حذف</SmallButton>
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

export function TeamStep({ draft, update, issues, apps }: StepProps) {
  const err = (f: string) => fieldError(issues, f);
  const bookingOn = apps.includes('booking');
  const payrollOn = apps.includes('payroll') || apps.includes('attendance');
  const setEmp = (i: number, patch: Partial<OnboardingDraft['employees'][number]>) =>
    update((d) => ({ ...d, employees: replaceAt(d.employees, i, patch) }));
  return (
    <Card
      title="فريق العمل"
      subtitle="اختياري — يمكن إضافة الموظفين لاحقاً"
      actions={<SmallButton tone="primary" onClick={() => update((d) => ({ ...d, employees: [...d.employees, emptyEmployee()] }))}>+ موظف</SmallButton>}
    >
      {draft.employees.length === 0 && <p className="text-sm text-muted-foreground">لم تتم إضافة موظفين.</p>}
      <div className="space-y-2">
        {draft.employees.map((e, i) => (
          <div key={i} className="space-y-2 rounded-lg border border-border p-3">
            <div className="grid items-start gap-2 sm:grid-cols-3">
              <Field label="الاسم" required value={e.name} error={err(`employees.${i}.name`)} onChange={(v) => setEmp(i, { name: v })} />
              <SelectField label="الوظيفة" required placeholder="— اختر —" value={e.job} error={err(`employees.${i}.job`)} options={JOB_OPTIONS.map((j) => ({ value: j, label: j }))} onChange={(v) => setEmp(i, { job: v })} />
              <SelectField label="الفرع الأساسي" required value={String(e.branchIndex)} error={err(`employees.${i}.primaryBranchCode`)} options={branchOptions(draft)} onChange={(v) => setEmp(i, { branchIndex: Number(v) })} />
            </div>
            <div className="flex flex-wrap items-center gap-4">
              <Toggle label="نشط" checked={e.active} onChange={(v) => setEmp(i, { active: v })} />
              {bookingOn && (
                <Toggle label="يستقبل حجوزات" checked={e.acceptsBookings ?? defaultAcceptsBookings(e.job)} onChange={(v) => setEmp(i, { acceptsBookings: v })} />
              )}
              <span className="text-xs text-muted-foreground">مواعيد العمل: نفس مواعيد الفرع</span>
              <SmallButton tone="danger" onClick={() => update((d) => ({ ...d, employees: d.employees.filter((_, j) => j !== i) }))}>حذف</SmallButton>
            </div>
            {payrollOn && (
              <Advanced label="بيانات الراتب (اختياري)">
                <SelectField label="نوع التوظيف" placeholder="— بدون —" value={e.employmentType ?? ''} options={EMPLOYMENT_TYPES.map((t) => ({ value: t, label: EMPLOYMENT_LABELS[t] ?? t }))} error={err(`employees.${i}.employmentType`)} onChange={(v) => setEmp(i, { employmentType: opt(v) })} />
                <SelectField label="طريقة الحساب" placeholder="— اختر —" value={e.payrollMethod ?? ''} options={PAYROLL_METHODS.map((m) => ({ value: m, label: PAYROLL_LABELS[m] ?? m }))} error={err(`employees.${i}.payrollMethod`)} onChange={(v) => setEmp(i, { payrollMethod: opt(v) })} />
                <Field label="قيمة الأجر" type="number" min={0} dir="ltr" value={e.payRate ?? ''} error={err(`employees.${i}.payRate`)} onChange={(v) => setEmp(i, { payRate: v === '' ? null : Number(v) })} />
              </Advanced>
            )}
          </div>
        ))}
      </div>
    </Card>
  );
}

function PasswordField({
  label,
  value,
  onChange,
  error,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  error?: string;
}) {
  const [visible, setVisible] = useState(false);
  const [copied, setCopied] = useState(false);
  return (
    <div className="space-y-1 text-sm">
      <span className="text-muted-foreground">
        {label} <span className="text-rose-500">*</span>
      </span>
      <div className="flex gap-1">
        <input
          type={visible ? 'text' : 'password'}
          dir="ltr"
          autoComplete="new-password"
          className={`${inputClass} ${error ? 'border-rose-500' : ''}`}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
        <SmallButton onClick={() => setVisible((v) => !v)}>{visible ? 'إخفاء' : 'إظهار'}</SmallButton>
        <SmallButton
          onClick={() => {
            onChange(generateStrongPassword());
            setVisible(true);
          }}
        >
          توليد
        </SmallButton>
        <SmallButton
          disabled={!value}
          onClick={() => void copyText(value).then((ok) => { setCopied(ok); setTimeout(() => setCopied(false), 1500); })}
        >
          {copied ? 'تم' : 'نسخ'}
        </SmallButton>
      </div>
      {error ? (
        <span className="block text-xs text-rose-500">{error}</span>
      ) : (
        <span className="block text-xs text-muted-foreground">{MIN_PASSWORD_LENGTH} أحرف على الأقل</span>
      )}
    </div>
  );
}

export function UsersStep({ draft, update, issues, plan }: StepProps & { plan: SaaSPlanRecord | null }) {
  const err = (f: string) => fieldError(issues, f);
  const atLimit = plan?.maxUsers != null && 1 + draft.users.length >= plan.maxUsers;
  const setOwner = (patch: Partial<OnboardingDraft['owner']>) => update((d) => ({ ...d, owner: { ...d.owner, ...patch } }));
  const setUser = (i: number, patch: Partial<OnboardingDraft['users'][number]>) =>
    update((d) => ({ ...d, users: replaceAt(d.users, i, patch) }));
  return (
    <div className="space-y-4">
      <Card title="المالك" subtitle="صلاحيات كاملة على المنشأة وكل فروعها">
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="الاسم" required value={draft.owner.displayName} error={err('owner.displayName')} onChange={(v) => setOwner({ displayName: v })} />
          <Field label="اسم الدخول" required dir="ltr" value={draft.owner.loginName} error={err('owner.loginName')} onChange={(v) => setOwner({ loginName: v.trim() })} />
          <PasswordField label="كلمة المرور" value={draft.owner.password} error={err('owner.password')} onChange={(v) => setOwner({ password: v })} />
        </div>
      </Card>
      <Card
        title="مستخدمون إضافيون"
        subtitle={plan?.maxUsers != null ? `خطة ${plan.displayName}: حتى ${plan.maxUsers} مستخدم بما فيهم المالك` : 'اختياري'}
        actions={
          <SmallButton tone="primary" disabled={atLimit} onClick={() => update((d) => ({ ...d, users: [...d.users, emptyUser()] }))}>
            + مستخدم
          </SmallButton>
        }
      >
        {draft.users.length === 0 && <p className="text-sm text-muted-foreground">لا يوجد مستخدمون إضافيون.</p>}
        {draft.users.map((u, i) => (
          <div key={i} className="grid items-start gap-2 rounded-lg border border-border p-3 sm:grid-cols-2 lg:grid-cols-3">
            <Field label="الاسم" required value={u.displayName} error={err(`users.${i}.displayName`)} onChange={(v) => setUser(i, { displayName: v })} />
            <Field label="اسم الدخول" required dir="ltr" value={u.loginName} error={err(`users.${i}.loginName`)} onChange={(v) => setUser(i, { loginName: v.trim() })} />
            <PasswordField label="كلمة المرور" value={u.password} error={err(`users.${i}.password`)} onChange={(v) => setUser(i, { password: v })} />
            <SelectField label="الدور" required placeholder="— اختر —" value={u.roleKey} error={err(`users.${i}.roleKey`)} options={ONBOARDING_USER_ROLES.map((r) => ({ value: r.roleKey, label: `${r.label} — ${r.hint}` }))} onChange={(v) => setUser(i, { roleKey: v })} />
            <SelectField label="الفرع الافتراضي" required value={String(u.branchIndex)} error={err(`users.${i}.defaultBranchCode`)} options={branchOptions(draft)} onChange={(v) => setUser(i, { branchIndex: Number(v) })} />
            <div className="pt-6">
              <SmallButton tone="danger" onClick={() => update((d) => ({ ...d, users: d.users.filter((_, j) => j !== i) }))}>حذف</SmallButton>
            </div>
          </div>
        ))}
      </Card>
    </div>
  );
}

export function AppsStep({ update, issues, pack, apps, appNames }: StepProps) {
  if (!pack) return <p className="text-sm text-muted-foreground">اختر نوع النشاط أولاً.</p>;
  const groups = packAppGroups(pack);
  const installed = new Set(apps);
  const section = (title: string, codes: string[], locked: boolean) =>
    codes.length > 0 && (
      <Card title={title}>
        <div className="grid gap-2 sm:grid-cols-2">
          {codes.map((code) => (
            <Toggle
              key={code}
              label={appNames.get(code) ?? code}
              checked={locked || installed.has(code)}
              disabled={locked}
              hint={locked ? 'مطلوب لهذا النشاط' : undefined}
              onChange={(on) => update((d) => toggleApp(d, pack, code, on))}
            />
          ))}
        </div>
      </Card>
    );
  return (
    <div className="space-y-4">
      {section('مطلوب', groups.required, true)}
      {section('موصى به', groups.recommended, false)}
      {section('اختياري', groups.optional, false)}
      {issues.filter((i) => i.severity === 'error').map((i, n) => (
        <p key={n} className="text-xs text-rose-500">{i.message}</p>
      ))}
      <p className="text-xs text-muted-foreground">التطبيقات المرتبطة تُضاف تلقائياً عند الحاجة. الإجمالي: {apps.length}</p>
    </div>
  );
}

export function PlanStep({ draft, update, issues, plans }: StepProps & { plans: SaaSPlanRecord[] }) {
  const plan = plans.find((p) => p.planCode === draft.subscription.planCode) ?? null;
  const setSub = (patch: Partial<OnboardingDraft['subscription']>) =>
    update((d) => ({ ...d, subscription: { ...d.subscription, ...patch } }));
  return (
    <div className="space-y-4">
      <Card title="الخطة">
        <div className="grid gap-2 sm:grid-cols-2">
          {plans.map((p) => (
            <button
              key={p.planCode}
              type="button"
              aria-pressed={p.planCode === draft.subscription.planCode}
              onClick={() => setSub({ planCode: p.planCode })}
              className={`rounded-lg border p-3 text-start text-sm ${
                p.planCode === draft.subscription.planCode ? 'border-primary bg-primary/10' : 'border-border hover:bg-muted'
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="font-semibold">{p.displayName}</div>
                {getPlanPricing(p.planCode)?.recommended && (
                  <span className="rounded-full bg-primary px-2 py-0.5 text-[10px] text-primary-foreground">
                    موصى بها
                  </span>
                )}
              </div>
              {getPlanPricing(p.planCode) && (
                <div className="mt-1 font-semibold text-primary">
                  {formatEgp(getPlanPricing(p.planCode)!.monthlyPrice)} / شهر
                </div>
              )}
              <div className="text-xs text-muted-foreground">
                فروع: {p.maxBranches ?? 'بلا حد'} · مستخدمون: {p.maxUsers ?? 'بلا حد'} · تجربة {p.trialDays} يوم
              </div>
              {getPlanPricing(p.planCode) && (
                <div className="mt-1 text-[11px] text-muted-foreground">
                  سنوي: {formatEgp(getPlanPricing(p.planCode)!.annualPrice)} (شهران مجاناً)
                </div>
              )}
            </button>
          ))}
        </div>
        {fieldError(issues, 'planCode') && <p className="text-xs text-rose-500">{fieldError(issues, 'planCode')}</p>}
      </Card>
      <Card title="حالة الاشتراك">
        <div className="flex flex-wrap gap-4">
          <label className="flex items-center gap-2 text-sm">
            <input type="radio" checked={draft.subscription.status === 'trial'} onChange={() => setSub({ status: 'trial' })} />
            تجريبي{plan ? ` (${plan.trialDays} يوم)` : ''}
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="radio" checked={draft.subscription.status === 'active'} onChange={() => setSub({ status: 'active' })} />
            نشط
          </label>
        </div>
        <p className="text-xs text-muted-foreground">لا يتم تحصيل أي مدفوعات من هنا. الخطة لا تغيّر التطبيقات المختارة.</p>
      </Card>
    </div>
  );
}

export function BookingStep({ draft, update, issues }: StepProps) {
  const err = (f: string) => fieldError(issues, f);
  const setRow = (i: number, patch: Partial<OnboardingDraft['booking'][number]>) =>
    update((d) => ({ ...d, booking: replaceAt(d.booking, i, patch) }));
  return (
    <div className="space-y-4">
      <p className="rounded-lg border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
        الحجز الإلكتروني للعملاء يبقى مغلقاً بعد الإنشاء ويُفتح لاحقاً من إعدادات الحجز عند الجاهزية.
      </p>
      {draft.branches.map((br, i) => {
        const s = draft.booking[i];
        if (!s) return null;
        return (
          <Card key={i} title={br.branchName.trim() || `الفرع ${i + 1}`} subtitle={`العملة ${draft.business.currency} · ${br.timezone || draft.business.timezone}`}>
            <div className="grid gap-3 sm:grid-cols-3">
              <SelectField label="طريقة الحجز الافتراضية" value={s.defaultMode} options={BOOKING_DEFAULT_MODES.map((m) => ({ value: m, label: MODE_LABELS[m] ?? m }))} onChange={(v) => setRow(i, { defaultMode: v })} />
              <SelectField label="فاصل المواعيد (دقيقة)" value={String(s.slotIntervalMinutes)} options={BOOKING_SLOT_INTERVAL_OPTIONS.map((m) => ({ value: String(m), label: String(m) }))} onChange={(v) => setRow(i, { slotIntervalMinutes: Number(v) })} />
              <SelectField label="أقل مهلة قبل الحجز (دقيقة)" value={String(s.minNoticeMinutes)} options={BOOKING_MIN_NOTICE_OPTIONS.map((m) => ({ value: String(m), label: String(m) }))} onChange={(v) => setRow(i, { minNoticeMinutes: Number(v) })} />
              <Field label="الحجز مقدماً حتى (يوم)" type="number" dir="ltr" min={BOOKING_MAX_DAYS_AHEAD_RANGE.min} value={shown(s.maxBookingDaysAhead)} onChange={(v) => setRow(i, { maxBookingDaysAhead: num(v) })} />
              <Field label="مدة الخدمة الافتراضية (دقيقة)" type="number" dir="ltr" min={5} value={shown(s.defaultServiceDurationMinutes)} error={err(`booking.${i}.defaultServiceDurationMinutes`)} onChange={(v) => setRow(i, { defaultServiceDurationMinutes: num(v) })} />
              <div className="space-y-2 pt-5">
                <Toggle label="السماح باختيار موظف محدد" checked={s.allowSpecificBarber} onChange={(v) => setRow(i, { allowSpecificBarber: v })} />
                <Toggle label="السماح بأقرب موظف متاح" checked={s.allowNearestBarber} onChange={(v) => setRow(i, { allowNearestBarber: v })} />
              </div>
            </div>
            {(err(`booking.${i}`) || err(`booking.${i}.allow`)) && (
              <p className="text-xs text-rose-500">{err(`booking.${i}`) ?? err(`booking.${i}.allow`)}</p>
            )}
          </Card>
        );
      })}
    </div>
  );
}

export function AiStep({ draft, update, issues, apps, pack }: StepProps) {
  const err = (f: string) => fieldError(issues, f);
  const messagingOn = apps.includes('messaging');
  const aiOn = apps.includes('ai-receptionist');
  const setAi = (patch: Partial<OnboardingDraft['ai']>) => update((d) => ({ ...d, ai: { ...d.ai, ...patch } }));
  return (
    <div className="space-y-4">
      {(messagingOn || aiOn) && (
        <Card title="واتساب" subtitle="غير متصل بعد">
          <p className="text-sm text-muted-foreground">
            رقم واتساب الخاص بالمنشأة يُربط بعد الإنشاء من فريق التشغيل. لا يتم الربط تلقائياً ولا تُرسل أي رسائل قبل الربط.
          </p>
        </Card>
      )}
      {aiOn && (
        <Card title="موظف الاستقبال الذكي" subtitle="يُحفظ الملف الآن ويبقى متوقفاً حتى ربط واتساب">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="اسم المنشأة للمساعد" required value={draft.ai.businessName} error={err('ai.businessName')} onChange={(v) => setAi({ businessName: v })} />
            <Field label="اللغة" dir="ltr" value={draft.ai.locale} error={err('ai.locale')} onChange={(v) => setAi({ locale: v })} />
            <Field label="الموقع الإلكتروني" dir="ltr" placeholder="https://" value={draft.ai.websiteUrl ?? ''} error={err('ai.websiteUrl')} onChange={(v) => setAi({ websiteUrl: opt(v) })} />
            <Field label="رابط الحجز" dir="ltr" placeholder="https://" value={draft.ai.bookingUrl ?? ''} error={err('ai.bookingUrl')} onChange={(v) => setAi({ bookingUrl: opt(v) })} />
          </div>
          <label className="block space-y-1 text-sm">
            <span className="text-muted-foreground">شخصية المساعد</span>
            <textarea
              rows={2}
              className={inputClass}
              placeholder={`موظف استقبال ${draft.ai.businessName || draft.business.businessName}`}
              value={draft.ai.assistantPersona ?? ''}
              onChange={(e) => setAi({ assistantPersona: opt(e.target.value) })}
            />
            {err('ai.assistantPersona') && <span className="block text-xs text-rose-500">{err('ai.assistantPersona')}</span>}
          </label>
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">السياسات</span>
              <SmallButton tone="primary" onClick={() => setAi({ policies: [...draft.ai.policies, ''] })}>+ سياسة</SmallButton>
            </div>
            {draft.ai.policies.map((p, i) => (
              <div key={i} className="flex gap-1">
                <input
                  className={inputClass}
                  value={p}
                  placeholder="مثال: يرجى الحضور قبل الموعد بـ 5 دقائق"
                  onChange={(e) => setAi({ policies: draft.ai.policies.map((x, j) => (j === i ? e.target.value : x)) })}
                />
                <SmallButton tone="danger" onClick={() => setAi({ policies: draft.ai.policies.filter((_, j) => j !== i) })}>حذف</SmallButton>
              </div>
            ))}
          </div>
          {conversationPackForIndustry(pack?.packCode) && (
            <Toggle
              label="استخدام سيناريو محادثة الصالون"
              hint="ردود جاهزة للحجز والأسعار ومواعيد العمل"
              checked={draft.ai.useSalonConciergePack}
              onChange={(v) => setAi({ useSalonConciergePack: v })}
            />
          )}
        </Card>
      )}
    </div>
  );
}

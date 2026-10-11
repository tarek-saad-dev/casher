'use client';

import Link from 'next/link';
import { useState } from 'react';
import { SUBSCRIPTION_STATUS_LABELS } from '@/components/platform/platformFetch';
import type { SaaSPlanRecord } from '@/platform/commercial/types';
import type { OnboardingDraft } from '@/platform/onboarding/wizard/draft';
import { onboardingRoleFor, usesServiceCatalog, wizardStepStatus } from '@/platform/onboarding/wizard/plan';
import type {
  OnboardingIssue,
  OnboardingRequest,
  OnboardingResult,
  OnboardingStageKey,
  WizardStepKey,
} from '@/platform/onboarding/wizard/types';
import { Card, SmallButton, StatusBadge, copyText } from './wizardUi';

export const STEP_LABELS: Record<WizardStepKey, string> = {
  business: 'المنشأة',
  branches: 'الفروع',
  services: 'الخدمات',
  team: 'الفريق',
  users: 'المستخدمون',
  apps: 'التطبيقات',
  plan: 'الاشتراك',
  booking: 'الحجز',
  ai: 'واتساب والمساعد',
  review: 'المراجعة',
};

const STAGE_LABELS: Record<OnboardingStageKey, string> = {
  branches: 'الفروع الإضافية',
  services: 'الخدمات',
  team: 'الموظفون',
  users: 'المستخدمون',
  booking: 'إعدادات الحجز',
  ai: 'ملف المساعد الذكي',
};

export function ReviewStep({
  steps,
  request,
  draft,
  apps,
  appNames,
  plan,
  issues,
  checking,
  onEdit,
}: {
  steps: WizardStepKey[];
  request: OnboardingRequest;
  draft: OnboardingDraft;
  apps: string[];
  appNames: Map<string, string>;
  plan: SaaSPlanRecord | null;
  issues: OnboardingIssue[];
  checking: boolean;
  onEdit: (step: WizardStepKey) => void;
}) {
  const catalog = usesServiceCatalog(request.business.industryPackCode);
  const lines: Partial<Record<WizardStepKey, string[]>> = {
    business: [request.business.businessName, `${request.business.timezone} · ${request.business.currency}`],
    branches: request.branches.map((b, i) => `${b.branchName}${i === 0 ? ' (رئيسي)' : ' (يُفعّل لاحقاً)'}`),
    services: catalog
      ? [`${request.services.length} خدمة`, ...request.services.slice(0, 4).map((s) => `${s.name} — ${s.price}`)]
      : ['الكتالوج يُعد بعد الإنشاء'],
    team: [`${request.employees.length} موظف`],
    users: [
      `المالك: ${request.owner.loginName}`,
      ...draft.users.map((u) => `${u.displayName} — ${onboardingRoleFor(u.roleKey)?.label ?? ''}`),
    ],
    apps: [apps.map((a) => appNames.get(a) ?? a).join('، ')],
    plan: [
      `${plan?.displayName ?? request.subscription.planCode} · ${SUBSCRIPTION_STATUS_LABELS[request.subscription.status]}`,
      ...(request.subscription.status === 'trial' && plan ? [`تجربة ${plan.trialDays} يوم`] : []),
    ],
    booking: [`${request.booking.length} فرع · الحجز الإلكتروني مغلق حتى التفعيل`],
    ai: [
      'واتساب غير متصل بعد',
      ...(request.ai ? ['ملف المساعد يُحفظ ويبقى متوقفاً حتى الربط'] : []),
    ],
  };
  return (
    <div className="space-y-3">
      {checking && <p className="text-xs text-muted-foreground">جاري التحقق من توفر الأكواد وأسماء الدخول…</p>}
      <div className="grid gap-3 sm:grid-cols-2">
        {steps
          .filter((s) => s !== 'review')
          .map((step) => {
            const stepIssues = issues.filter((i) => i.step === step);
            return (
              <Card
                key={step}
                title={STEP_LABELS[step]}
                actions={
                  <>
                    <StatusBadge status={wizardStepStatus(step, issues, request)} />
                    <SmallButton onClick={() => onEdit(step)}>تعديل</SmallButton>
                  </>
                }
              >
                <ul className="space-y-0.5 text-sm">
                  {(lines[step] ?? []).map((l, i) => (
                    <li key={i}>{l}</li>
                  ))}
                </ul>
                {stepIssues.length > 0 && (
                  <ul className="space-y-0.5 text-xs">
                    {stepIssues.map((i, n) => (
                      <li key={n} className={i.severity === 'error' ? 'text-rose-500' : 'text-amber-600'}>
                        {i.message}
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            );
          })}
      </div>
    </div>
  );
}

export function SuccessView({
  result,
  request,
  businessName,
  appNames,
  retrying,
  retryError,
  onRetry,
  onCreateAnother,
}: {
  result: OnboardingResult;
  request: OnboardingRequest;
  businessName: string;
  appNames: Map<string, string>;
  retrying: boolean;
  retryError: string | null;
  onRetry: () => void;
  onCreateAnother: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const { core } = result;
  const loginUrl = typeof window === 'undefined' ? '/login' : `${window.location.origin}/login`;
  const credentials = [
    `المنشأة: ${businessName}`,
    `رابط الدخول: ${loginUrl}`,
    `اسم الدخول: ${request.owner.loginName}`,
    `كلمة المرور: ${request.owner.password}`,
  ].join('\n');
  const failed = result.stages.filter((s) => s.status === 'failed' || s.status === 'blocked');
  const applied = result.stages.filter((s) => s.status === 'done');

  return (
    <div className="space-y-4">
      <section
        className={`rounded-xl border p-5 ${result.complete ? 'border-emerald-500/40 bg-emerald-500/5' : 'border-amber-500/40 bg-amber-500/5'}`}
      >
        <h2 className={`text-xl font-semibold ${result.complete ? 'text-emerald-600' : 'text-amber-600'}`}>
          {result.complete ? 'المنشأة جاهزة' : 'تم إنشاء المنشأة — الإعداد يحتاج متابعة'}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {businessName} · {core.tenantCode} · {SUBSCRIPTION_STATUS_LABELS[core.subscriptionStatus] ?? core.subscriptionStatus}
          {core.trialEndsAt ? ` حتى ${new Date(core.trialEndsAt).toLocaleDateString('ar-EG')}` : ''}
        </p>
      </section>

      <div className="grid gap-3 sm:grid-cols-2">
        <Card title="ملخص">
          <ul className="space-y-0.5 text-sm">
            <li>الفروع: {request.branches.length}</li>
            {usesServiceCatalog(core.industryPackCode) && <li>الخدمات: {request.services.length}</li>}
            <li>الموظفون: {request.employees.length}</li>
            <li>المستخدمون: {1 + request.users.length}</li>
            <li>التطبيقات: {core.apps.map((a) => appNames.get(a) ?? a).join('، ')}</li>
            <li>الجاهزية: {result.readiness?.overall === 'PASS' ? 'جاهزة للتشغيل' : 'تحتاج استكمال من تفاصيل المنشأة'}</li>
          </ul>
        </Card>
        <Card
          title="بيانات دخول المالك"
          subtitle="تظهر الآن فقط — لا يتم حفظ كلمة المرور"
          actions={
            <SmallButton
              tone="primary"
              onClick={() => void copyText(credentials).then((ok) => { setCopied(ok); setTimeout(() => setCopied(false), 1500); })}
            >
              {copied ? 'تم النسخ' : 'نسخ بيانات الدخول'}
            </SmallButton>
          }
        >
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
            <dt className="text-muted-foreground">اسم الدخول</dt>
            <dd dir="ltr" className="font-mono">{request.owner.loginName}</dd>
            <dt className="text-muted-foreground">كلمة المرور</dt>
            <dd dir="ltr" className="font-mono">{request.owner.password}</dd>
          </dl>
        </Card>
      </div>

      <Card title="مراحل الإعداد">
        <ul className="space-y-1 text-sm">
          {result.stages
            .filter((s) => s.status !== 'skipped')
            .map((s) => (
              <li key={s.stage} className="flex flex-wrap items-center gap-2">
                <span className={s.status === 'done' ? 'text-emerald-600' : 'text-rose-500'}>
                  {s.status === 'done' ? '✓' : '✕'}
                </span>
                <span>{STAGE_LABELS[s.stage]}</span>
                {s.status === 'done' && (
                  <span className="text-xs text-muted-foreground">
                    {s.created} جديد{s.existing ? ` · ${s.existing} موجود مسبقاً` : ''}
                  </span>
                )}
                {s.status === 'blocked' && <span className="text-xs text-muted-foreground">بانتظار الفروع</span>}
                {s.status === 'failed' && s.message && <span className="text-xs text-rose-500">{s.message}</span>}
              </li>
            ))}
          {applied.length === 0 && failed.length === 0 && <li className="text-muted-foreground">لا توجد مراحل إضافية.</li>}
        </ul>
        {failed.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <SmallButton tone="primary" disabled={retrying} onClick={onRetry}>
              {retrying ? 'جاري إعادة المحاولة…' : 'إعادة محاولة الإعداد'}
            </SmallButton>
            <span className="text-xs text-muted-foreground">لن يتم إنشاء منشأة جديدة — تُستكمل المراحل الناقصة فقط.</span>
          </div>
        )}
        {retryError && <p className="text-xs text-rose-500">{retryError}</p>}
      </Card>

      <div className="flex flex-wrap gap-2">
        <a href="/login" target="_blank" rel="noreferrer" className="rounded-lg bg-primary px-4 py-2 text-sm text-primary-foreground">
          فتح المنشأة
        </a>
        <Link href={`/platform/tenants/${core.tenantId}#go-live`} className="rounded-lg border border-primary/40 px-4 py-2 text-sm font-medium text-primary hover:bg-primary/5">
          بدء التشغيل الفعلي
        </Link>
        <button type="button" onClick={onCreateAnother} className="rounded-lg border border-border px-4 py-2 text-sm hover:bg-muted">
          إنشاء منشأة أخرى
        </button>
      </div>
    </div>
  );
}

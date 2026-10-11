'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { SUBSCRIPTION_STATUS_LABELS, platformFetch } from '@/components/platform/platformFetch';
import type { SaaSPlanRecord } from '@/platform/commercial/types';
import { buildOnboardingRequest, initialDraft, type OnboardingDraft } from '@/platform/onboarding/wizard/draft';
import {
  hasBlockingIssues,
  summarizeOnboarding,
  usesServiceCatalog,
  validateOnboardingRequest,
  visibleWizardSteps,
} from '@/platform/onboarding/wizard/plan';
import type {
  OnboardingIssue,
  OnboardingRequest,
  OnboardingResult,
  WizardStepKey,
} from '@/platform/onboarding/wizard/types';
import type { IndustryPackDefinition } from '@/platform/packs/types';
import {
  AiStep,
  AppsStep,
  BookingStep,
  BranchesStep,
  BusinessStep,
  PlanStep,
  ServicesStep,
  TeamStep,
  UsersStep,
  type StepProps,
} from './OnboardingSteps';
import { ReviewStep, STEP_LABELS, SuccessView } from './OnboardingResultViews';
import { StepIssues } from './wizardUi';

type CatalogApp = { appCode: string; displayName: string };

/** Issues not tied to a single input (shown above the step instead of inline). */
const STEP_LEVEL_FIELDS = new Set(['branches', 'services', 'users', 'booking', 'ai', 'status']);
type ApiBody = { error?: string; details?: { issues?: OnboardingIssue[] } } & Record<string, unknown>;

/** POST returning the parsed body; validation details are kept so they can be shown per step. */
async function postJson<T>(url: string, body: unknown): Promise<{ ok: true; data: T } | { ok: false; error: string; issues: OnboardingIssue[] }> {
  const res = await fetch(url, {
    method: 'POST',
    credentials: 'include',
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as ApiBody;
  if (!res.ok) {
    return {
      ok: false,
      error: typeof data.error === 'string' ? data.error : `HTTP ${res.status}`,
      issues: Array.isArray(data.details?.issues) ? data.details.issues : [],
    };
  }
  return { ok: true, data: data as T };
}

export function OnboardingWizard() {
  const [packs, setPacks] = useState<IndustryPackDefinition[]>([]);
  const [plans, setPlans] = useState<SaaSPlanRecord[]>([]);
  const [appNames, setAppNames] = useState<Map<string, string>>(new Map());
  const [loadError, setLoadError] = useState<string | null>(null);

  const [draft, setDraft] = useState<OnboardingDraft>(() => initialDraft());
  const [step, setStep] = useState<WizardStepKey>('business');
  const [attempted, setAttempted] = useState<Set<WizardStepKey>>(new Set());
  const [serverIssues, setServerIssues] = useState<OnboardingIssue[]>([]);
  const [checking, setChecking] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  /** Request that created the business; kept in memory only so Retry Setup can resend it. */
  const [created, setCreated] = useState<{ request: OnboardingRequest; result: OnboardingResult } | null>(null);
  const [retrying, setRetrying] = useState(false);
  const [retryError, setRetryError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      platformFetch<{ packs: IndustryPackDefinition[] }>('/api/admin/platform/packs'),
      platformFetch<{ plans: SaaSPlanRecord[] }>('/api/admin/platform/plans'),
      platformFetch<{ apps: CatalogApp[] }>('/api/admin/platform/apps'),
    ])
      .then(([p, pl, a]) => {
        const active = pl.plans.filter((x) => x.isActive && x.isPublic);
        setPacks(p.packs);
        setPlans(active);
        setAppNames(new Map(a.apps.map((x) => [x.appCode, x.displayName])));
        setDraft((d) =>
          active.some((x) => x.planCode === d.subscription.planCode) || !active.length
            ? d
            : { ...d, subscription: { ...d.subscription, planCode: active[0]!.planCode } },
        );
      })
      .catch((e: Error) => setLoadError(e.message));
  }, []);

  const pack = packs.find((p) => p.packCode === draft.business.industryPackCode) ?? null;
  const plan = plans.find((p) => p.planCode === draft.subscription.planCode) ?? null;
  const { request, apps } = useMemo(() => buildOnboardingRequest(draft, pack), [draft, pack]);
  const localIssues = useMemo(() => validateOnboardingRequest(request, { pack, plan }), [request, pack, plan]);
  const allIssues = useMemo(() => [...localIssues, ...serverIssues], [localIssues, serverIssues]);
  const steps = visibleWizardSteps(pack, apps);
  if (!steps.includes(step)) setStep('business');
  const stepIndex = Math.max(0, steps.indexOf(step));
  const summary = summarizeOnboarding(request, apps);

  const update = useCallback((fn: (d: OnboardingDraft) => OnboardingDraft) => {
    setDraft(fn);
    setServerIssues([]);
    setCreateError(null);
  }, []);

  const runPreflight = useCallback(async (req: OnboardingRequest) => {
    setChecking(true);
    const res = await postJson<{ issues: OnboardingIssue[] }>('/api/admin/platform/tenants/onboarding/preflight', req);
    setChecking(false);
    if (res.ok) {
      const local = new Set(validateOnboardingRequest(req, { pack, plan }).map((i) => `${i.step}|${i.field}|${i.message}`));
      setServerIssues(res.data.issues.filter((i) => !local.has(`${i.step}|${i.field}|${i.message}`)));
    } else {
      setServerIssues(res.issues);
      if (!res.issues.length) setCreateError(res.error);
    }
  }, [pack, plan]);

  const goTo = (target: WizardStepKey) => {
    setStep(target);
    if (target === 'review') {
      setAttempted(new Set(steps));
      void runPreflight(request);
    }
    if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const next = () => {
    const current = steps[stepIndex]!;
    if (localIssues.some((i) => i.step === current && i.severity === 'error')) {
      setAttempted((a) => new Set(a).add(current));
      return;
    }
    const target = steps[stepIndex + 1];
    if (target) goTo(target);
  };

  const back = () => {
    const target = steps[stepIndex - 1];
    if (target) goTo(target);
  };

  const create = async () => {
    if (hasBlockingIssues(allIssues) || creating) return;
    setCreating(true);
    setCreateError(null);
    const res = await postJson<OnboardingResult>('/api/admin/platform/tenants/onboarding', request);
    setCreating(false);
    if (res.ok) {
      setCreated({ request, result: res.data });
    } else {
      setServerIssues(res.issues);
      setCreateError(res.error);
    }
  };

  const retry = async () => {
    if (!created) return;
    setRetrying(true);
    setRetryError(null);
    const res = await postJson<OnboardingResult>(
      `/api/admin/platform/tenants/${created.result.core.tenantId}/onboarding-setup`,
      created.request,
    );
    setRetrying(false);
    if (res.ok) setCreated({ request: created.request, result: res.data });
    else setRetryError(res.issues[0]?.message ?? res.error);
  };

  const reset = () => {
    setDraft(initialDraft(plans[0]?.planCode));
    setStep('business');
    setAttempted(new Set());
    setServerIssues([]);
    setCreated(null);
    setCreateError(null);
    setRetryError(null);
  };

  if (created) {
    return (
      <div className="mx-auto max-w-4xl">
        <SuccessView
          result={created.result}
          request={created.request}
          businessName={created.request.business.businessName}
          appNames={appNames}
          retrying={retrying}
          retryError={retryError}
          onRetry={() => void retry()}
          onCreateAnother={reset}
        />
      </div>
    );
  }

  const shownIssues = attempted.has(step) ? allIssues : [];
  const stepProps: StepProps = { draft, update, issues: shownIssues, pack, apps: apps ?? [], appNames };
  const currentStepIssues = shownIssues.filter((i) => i.step === step);

  return (
    <div className="mx-auto max-w-5xl space-y-4 pb-24">
      <header className="space-y-1">
        <h2 className="text-lg font-semibold">إنشاء منشأة جديدة</h2>
        {loadError && <p className="text-sm text-rose-500">{loadError}</p>}
      </header>

      <nav aria-label="خطوات الإنشاء" className="overflow-x-auto">
        <ol className="flex min-w-max gap-1">
          {steps.map((s, i) => {
            const active = s === step;
            const reachable = i <= stepIndex || attempted.has(s);
            return (
              <li key={s}>
                <button
                  type="button"
                  disabled={!reachable}
                  aria-current={active ? 'step' : undefined}
                  onClick={() => goTo(s)}
                  className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs ${
                    active
                      ? 'border-primary bg-primary text-primary-foreground'
                      : i < stepIndex
                        ? 'border-primary/40 text-primary'
                        : 'border-border text-muted-foreground'
                  } disabled:opacity-50`}
                >
                  <span className="font-mono">{i + 1}</span>
                  <span>{s === 'services' && pack && !usesServiceCatalog(pack) ? 'الكتالوج' : STEP_LABELS[s]}</span>
                </button>
              </li>
            );
          })}
        </ol>
      </nav>

      <div className="grid gap-4 lg:grid-cols-[1fr_240px]">
        <main className="min-w-0 space-y-4">
          {step !== 'review' && (
            <StepIssues issues={currentStepIssues.filter((i) => !i.field || STEP_LEVEL_FIELDS.has(i.field))} />
          )}
          {step === 'business' && <BusinessStep {...stepProps} packs={packs} />}
          {step === 'branches' && <BranchesStep {...stepProps} plan={plan} />}
          {step === 'services' && <ServicesStep {...stepProps} />}
          {step === 'team' && <TeamStep {...stepProps} />}
          {step === 'users' && <UsersStep {...stepProps} plan={plan} />}
          {step === 'apps' && <AppsStep {...stepProps} />}
          {step === 'plan' && <PlanStep {...stepProps} plans={plans} />}
          {step === 'booking' && <BookingStep {...stepProps} />}
          {step === 'ai' && <AiStep {...stepProps} />}
          {step === 'review' && (
            <ReviewStep
              steps={steps}
              request={request}
              draft={draft}
              apps={apps ?? []}
              appNames={appNames}
              plan={plan}
              issues={allIssues}
              checking={checking}
              onEdit={goTo}
            />
          )}
          {createError && <p className="text-sm text-rose-500">{createError}</p>}
        </main>

        <aside className="h-fit space-y-2 rounded-xl border border-border p-4 text-sm lg:sticky lg:top-4">
          <h3 className="font-semibold">{draft.business.businessName.trim() || 'منشأة جديدة'}</h3>
          {pack && <p className="text-xs text-muted-foreground">{pack.displayName}</p>}
          <ul className="space-y-0.5 text-xs text-muted-foreground">
            <li>{summary.branches} فرع</li>
            {usesServiceCatalog(pack) && <li>{summary.services} خدمة</li>}
            <li>{summary.employees} موظف</li>
            <li>{summary.users} مستخدم</li>
            <li>{summary.apps} تطبيق</li>
            <li>
              {plan?.displayName ?? summary.planCode} · {SUBSCRIPTION_STATUS_LABELS[summary.status]}
            </li>
          </ul>
        </aside>
      </div>

      <footer className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-background/95 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-2 px-4 py-3">
          <button
            type="button"
            onClick={back}
            disabled={stepIndex === 0}
            className="rounded-lg border border-border px-4 py-2 text-sm disabled:opacity-40"
          >
            السابق
          </button>
          <span className="text-xs text-muted-foreground">
            {stepIndex + 1} / {steps.length}
          </span>
          {step === 'review' ? (
            <button
              type="button"
              onClick={() => void create()}
              disabled={creating || checking || hasBlockingIssues(allIssues)}
              className="rounded-lg bg-primary px-5 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50"
            >
              {creating ? 'جاري الإنشاء والتجهيز…' : 'إنشاء وتجهيز المنشأة'}
            </button>
          ) : (
            <button
              type="button"
              onClick={next}
              className="rounded-lg bg-primary px-5 py-2 text-sm text-primary-foreground"
            >
              التالي
            </button>
          )}
        </div>
      </footer>
    </div>
  );
}

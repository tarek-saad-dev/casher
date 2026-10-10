'use client';

import { use, useCallback, useEffect, useState } from 'react';
import BrandProfileForm from '@/components/tenant/BrandProfileForm';
import { platformFetch, SUBSCRIPTION_STATUS_LABELS } from '@/components/platform/platformFetch';
import type { TenantBrandProfile } from '@/platform/branding/brandProfile';
import type { TenantAppState, TenantPackState } from '@/platform/apps/tenantApps';
import type {
  CommercialAccessReport,
  SaaSPlanRecord,
} from '@/platform/commercial/types';
import type { TenantReadinessReport } from '@/platform/onboarding/types';
import type { IndustryPackDefinition } from '@/platform/packs/types';

type SubscriptionJson = {
  planCode: string;
  status: string;
  trialEndsAt: string | null;
  currentPeriodEndsAt: string | null;
  pastDueSince: string | null;
  suspendedAt: string | null;
  cancelledAt: string | null;
  revision: number;
};

type TenantDetail = {
  tenant: { tenantId: string; code: string; name: string; status: string; defaultTimezone: string; createdAt: string };
  branches: Array<{
    locationId: string;
    legacyBranchId: number;
    branchCode: string;
    branchName: string | null;
    lifecycleStatus: string | null;
    isActive: boolean;
  }>;
  members: Array<{ userId: number; userName: string; loginName: string; userLevel: string; roles: string[] }>;
  pack: TenantPackState | null;
  apps: TenantAppState[];
  installed: string[];
  subscription: SubscriptionJson | null;
  access: CommercialAccessReport;
  brand: TenantBrandProfile | null;
};

type CatalogApp = { appCode: string; displayName: string; requires: string[] };

const ACTIONS: Array<{ action: string; label: string; tone: string }> = [
  { action: 'activate', label: 'تفعيل', tone: 'bg-emerald-600' },
  { action: 'mark_past_due', label: 'متأخر السداد', tone: 'bg-amber-600' },
  { action: 'suspend', label: 'إيقاف', tone: 'bg-rose-600' },
  { action: 'cancel', label: 'إلغاء', tone: 'bg-zinc-600' },
  { action: 'reactivate', label: 'إعادة تفعيل', tone: 'bg-sky-600' },
];

function fmt(d: string | null | undefined): string {
  return d ? new Date(d).toLocaleString('ar-EG') : '—';
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3 rounded-xl border border-border p-4">
      <h3 className="font-semibold">{title}</h3>
      {children}
    </section>
  );
}

export default function TenantDetailPage({ params }: { params: Promise<{ tenantId: string }> }) {
  const { tenantId } = use(params);
  const base = `/api/admin/platform/tenants/${tenantId}`;

  const [detail, setDetail] = useState<TenantDetail | null>(null);
  const [readiness, setReadiness] = useState<TenantReadinessReport | null>(null);
  const [plans, setPlans] = useState<SaaSPlanRecord[]>([]);
  const [packs, setPacks] = useState<IndustryPackDefinition[]>([]);
  const [catalog, setCatalog] = useState<CatalogApp[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [planCode, setPlanCode] = useState('');
  const [applyPackCode, setApplyPackCode] = useState('');

  const reload = useCallback(async () => {
    const [d, r] = await Promise.all([
      platformFetch<TenantDetail>(base),
      platformFetch<TenantReadinessReport>(`${base}/readiness`),
    ]);
    setDetail(d);
    setReadiness(r);
    setPlanCode(d.subscription?.planCode ?? '');
    setApplyPackCode(d.pack?.packCode ?? '');
  }, [base]);

  useEffect(() => {
    reload().catch((e: Error) => setError(e.message));
    Promise.all([
      platformFetch<{ plans: SaaSPlanRecord[] }>('/api/admin/platform/plans'),
      platformFetch<{ packs: IndustryPackDefinition[] }>('/api/admin/platform/packs'),
      platformFetch<{ apps: CatalogApp[] }>('/api/admin/platform/apps'),
    ])
      .then(([pl, pk, a]) => {
        setPlans(pl.plans.filter((p) => p.isActive));
        setPacks(pk.packs);
        setCatalog(a.apps);
      })
      .catch((e: Error) => setError(e.message));
  }, [reload]);

  const run = async (label: string, fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await fn();
      await reload();
      setNotice(`${label}: تم`);
    } catch (err) {
      setError(`${label}: ${err instanceof Error ? err.message : 'فشل'}`);
    } finally {
      setBusy(false);
    }
  };

  const patchSubscription = (body: Record<string, unknown>) =>
    platformFetch(`${base}/subscription`, {
      method: 'PATCH',
      body: JSON.stringify({ ...body, expectedRevision: detail?.subscription?.revision }),
    });

  if (error && !detail) return <p className="text-sm text-rose-500">{error}</p>;
  if (!detail) return <p className="text-sm text-muted-foreground">جاري التحميل…</p>;

  const isBoot = detail.tenant.code === 'CASHER_BOOT';
  const sub = detail.subscription;
  const evalSub = detail.access.subscription;
  const appStatus = new Map(detail.apps.map((a) => [a.appCode, a]));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="text-lg font-bold">
            {detail.tenant.name} <span className="font-mono text-sm text-muted-foreground">{detail.tenant.code}</span>
          </h2>
          <p className="text-xs text-muted-foreground">
            {detail.tenant.tenantId} — أنشئت {fmt(detail.tenant.createdAt)} — {detail.tenant.defaultTimezone}
          </p>
        </div>
        {isBoot && (
          <span className="rounded-full bg-amber-500/15 px-3 py-1 text-xs text-amber-500">
            منشأة التشغيل الأصلية — الاشتراك والتطبيقات محمية
          </span>
        )}
      </div>

      {error && <p className="text-sm text-rose-500">{error}</p>}
      {notice && <p className="text-sm text-emerald-500">{notice}</p>}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="الاشتراك">
          {sub ? (
            <div className="space-y-1 text-sm">
              <div>
                الحالة: <b>{SUBSCRIPTION_STATUS_LABELS[sub.status] ?? sub.status}</b> — الخطة <b>{sub.planCode}</b>
              </div>
              <div className={evalSub.allowed ? 'text-emerald-500' : 'text-rose-500'}>
                الوصول: {evalSub.allowed ? 'مسموح' : 'محجوب'} ({evalSub.reason})
                {evalSub.accessEndsAt ? ` حتى ${fmt(evalSub.accessEndsAt)}` : ''}
              </div>
              <div className="text-muted-foreground">
                التجربة حتى {fmt(sub.trialEndsAt)} — نهاية الفترة {fmt(sub.currentPeriodEndsAt)}
              </div>
              <div className="text-muted-foreground">
                الفروع {detail.access.branches.usage}/{detail.access.branches.limit ?? '∞'} — المستخدمون{' '}
                {detail.access.users.usage}/{detail.access.users.limit ?? '∞'}
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">لا يوجد اشتراك</p>
          )}
          <div className="flex flex-wrap gap-2">
            {ACTIONS.map((a) => (
              <button
                key={a.action}
                disabled={busy || isBoot || !sub}
                onClick={() => {
                  if (a.action === 'suspend' || a.action === 'cancel') {
                    if (!window.confirm(`تأكيد "${a.label}" للمنشأة ${detail.tenant.code}؟`)) return;
                  }
                  void run(a.label, () => patchSubscription({ action: a.action }));
                }}
                className={`rounded-lg px-3 py-1.5 text-xs text-white disabled:opacity-40 ${a.tone}`}
              >
                {a.label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <select
              className="rounded-lg border border-border bg-background px-2 py-1.5 text-sm"
              value={planCode}
              disabled={busy || isBoot}
              onChange={(e) => setPlanCode(e.target.value)}
            >
              {plans.map((p) => (
                <option key={p.planCode} value={p.planCode}>
                  {p.displayName} ({p.maxBranches ?? '∞'} فروع / {p.maxUsers ?? '∞'} مستخدمين)
                </option>
              ))}
            </select>
            <button
              disabled={busy || isBoot || !sub || planCode === sub?.planCode}
              onClick={() => void run('تغيير الخطة', () => patchSubscription({ planCode }))}
              className="rounded-lg border border-border px-3 py-1.5 text-xs disabled:opacity-40"
            >
              تغيير الخطة
            </button>
          </div>
        </Card>

        <Card title={`الجاهزية — ${readiness?.overall ?? '…'}`}>
          <ul className="max-h-64 space-y-1 overflow-y-auto text-xs">
            {readiness?.checks.map((c) => (
              <li key={c.id} className={c.pass ? 'text-emerald-500' : 'text-rose-500'}>
                {c.pass ? '✓' : '✗'} <span className="font-mono">{c.id}</span> — {c.detail}
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <Card title={`التطبيقات — الحزمة ${detail.pack ? `${detail.pack.packCode} v${detail.pack.packVersion}` : '—'}`}>
        <div className="flex flex-wrap gap-2">
          {catalog.map((app) => {
            const st = appStatus.get(app.appCode);
            const installed = st?.status === 'installed';
            return (
              <div
                key={app.appCode}
                className={`flex items-center gap-2 rounded-lg border px-2 py-1 text-xs ${
                  installed ? 'border-primary/50 bg-primary/10' : 'border-border'
                }`}
              >
                <span>{app.displayName}</span>
                <span className="text-muted-foreground">{installed ? st?.source : st?.status ?? 'غير مثبت'}</span>
                <button
                  disabled={busy || isBoot}
                  onClick={() =>
                    void run(installed ? `إزالة ${app.appCode}` : `تثبيت ${app.appCode}`, () =>
                      platformFetch(`${base}/apps/${installed ? 'uninstall' : 'install'}`, {
                        method: 'POST',
                        body: JSON.stringify({ appCode: app.appCode }),
                      }),
                    )
                  }
                  className="rounded border border-border px-1.5 disabled:opacity-40"
                >
                  {installed ? 'إزالة' : 'تثبيت'}
                </button>
              </div>
            );
          })}
        </div>
        <div className="flex items-center gap-2">
          <select
            className="rounded-lg border border-border bg-background px-2 py-1.5 text-sm"
            value={applyPackCode}
            disabled={busy || isBoot}
            onChange={(e) => setApplyPackCode(e.target.value)}
          >
            <option value="">— اختر حزمة —</option>
            {packs.map((p) => (
              <option key={p.packCode} value={p.packCode}>
                {p.displayName}
              </option>
            ))}
          </select>
          <button
            disabled={busy || isBoot || !applyPackCode}
            onClick={() => {
              if (!window.confirm('تطبيق الحزمة يعيد ضبط التطبيقات المثبتة إلى افتراضيات الحزمة. متابعة؟')) return;
              void run('تطبيق الحزمة', () =>
                platformFetch(`${base}/apps/apply-pack`, {
                  method: 'POST',
                  body: JSON.stringify({ industryPackCode: applyPackCode, appCustomizations: {} }),
                }),
              );
            }}
            className="rounded-lg border border-border px-3 py-1.5 text-xs disabled:opacity-40"
          >
            تطبيق الحزمة
          </button>
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title={`الفروع (${detail.branches.length})`}>
          <ul className="space-y-1 text-sm">
            {detail.branches.map((b) => (
              <li key={b.locationId}>
                <span className="font-mono">{b.branchCode}</span> — {b.branchName ?? '—'} —{' '}
                <span className={b.isActive ? 'text-emerald-500' : 'text-amber-500'}>
                  {b.lifecycleStatus ?? '—'}
                </span>
              </li>
            ))}
          </ul>
        </Card>
        <Card title={`المستخدمون (${detail.members.length})`}>
          <ul className="max-h-48 space-y-1 overflow-y-auto text-sm">
            {detail.members.map((m) => (
              <li key={m.userId}>
                {m.userName} <span className="font-mono text-muted-foreground">({m.loginName})</span> —{' '}
                {m.roles.join('، ') || m.userLevel}
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <Card title="هوية المنشأة">
        {detail.brand ? (
          <BrandProfileForm
            brand={detail.brand}
            save={async (payload) => {
              const r = await platformFetch<{ brand: TenantBrandProfile }>(`${base}/brand`, {
                method: 'PUT',
                body: JSON.stringify(payload),
              });
              return r.brand;
            }}
          />
        ) : (
          <p className="text-sm text-muted-foreground">لا توجد هوية</p>
        )}
      </Card>
    </div>
  );
}

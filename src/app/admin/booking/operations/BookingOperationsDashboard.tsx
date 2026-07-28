'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  Activity,
  AlertTriangle,
  Calendar,
  Loader2,
  PauseCircle,
  PlayCircle,
  RefreshCw,
  Scissors,
  Settings,
  Users,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

type Timing = { count: number; p50: number | null; p95: number | null };

type HealthSummary = {
  windowHours: number;
  generatedAt: string;
  contractMode: string | null;
  create: {
    success: number;
    failure: number;
    idempotentReplay: number;
    byErrorCode: Record<string, number>;
    planTokenErrors: number;
    mutationOutcomeUnknown: number;
  };
  cancel: {
    success: number;
    failure: number;
    idempotentReplay: number;
    byErrorCode: Record<string, number>;
    mutationOutcomeUnknown: number;
  };
  rateLimitEvents: number;
  timingsMs: Record<string, Timing>;
  notes?: string[];
};

type BranchStatus = {
  branchId: number;
  branchCode: string;
  branchName: string;
  lifecycleStatus: string;
  isActive: boolean;
  publicBookingEnabled: boolean;
  bookingEnabled: boolean;
  publiclyDiscoverable: boolean;
  canPauseResume: boolean;
  publicEnableForbidden: boolean;
};

type SampleRow = {
  createdAtUtc: string;
  routeFamily: string;
  routeKey: string;
  outcome: string;
  errorCode: string | null;
  durationMs: number;
  httpStatus: number;
};

function topCodes(
  a: Record<string, number>,
  b: Record<string, number>,
  limit = 8,
): Array<{ code: string; count: number }> {
  const merged: Record<string, number> = { ...a };
  for (const [k, v] of Object.entries(b)) merged[k] = (merged[k] || 0) + v;
  return Object.entries(merged)
    .map(([code, count]) => ({ code, count }))
    .sort((x, y) => y.count - x.count)
    .slice(0, limit);
}

function fmtMs(n: number | null | undefined): string {
  if (n == null) return '—';
  return `${n} ms`;
}

export default function BookingOperationsDashboard() {
  const [health, setHealth] = useState<HealthSummary | null>(null);
  const [branches, setBranches] = useState<BranchStatus[]>([]);
  const [samples, setSamples] = useState<SampleRow[]>([]);
  const [monitoringWarning, setMonitoringWarning] = useState<string | null>(null);
  const [contractMode, setContractMode] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [actionError, setActionError] = useState('');
  const [actionLoading, setActionLoading] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmTarget, setConfirmTarget] = useState<BranchStatus | null>(null);
  const [confirmEnable, setConfirmEnable] = useState(false);
  const [reason, setReason] = useState('');

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    else setRefreshing(true);
    setError('');
    try {
      const [healthRes, opsRes] = await Promise.all([
        fetch('/api/admin/public-booking/health', { cache: 'no-store' }),
        fetch('/api/admin/public-booking/operations', { cache: 'no-store' }),
      ]);

      if (healthRes.status === 401 || opsRes.status === 401) {
        setError('يلزم تسجيل الدخول');
        return;
      }
      if (healthRes.status === 403 || opsRes.status === 403) {
        setError('غير مصرح — صلاحية مدير مطلوبة');
        return;
      }

      const healthJson = await healthRes.json().catch(() => ({}));
      const opsJson = await opsRes.json().catch(() => ({}));

      if (!healthRes.ok || !healthJson.ok) {
        setError(healthJson.message || 'تعذر تحميل تقرير الصحة');
      } else {
        setHealth(healthJson.summary as HealthSummary);
        setContractMode(
          (healthJson.summary as HealthSummary)?.contractMode ?? null,
        );
      }

      if (!opsRes.ok || !opsJson.ok) {
        if (!healthRes.ok) {
          /* already set */
        } else {
          setError(opsJson.message || 'تعذر تحميل حالة الفروع');
        }
      } else {
        setBranches((opsJson.branches as BranchStatus[]) || []);
        setSamples((opsJson.recentSamples as SampleRow[]) || []);
        setMonitoringWarning(
          (opsJson.monitoring?.warning as string | null) || null,
        );
        if (opsJson.contractMode) setContractMode(String(opsJson.contractMode));
      }
    } catch {
      setError('خطأ في الاتصال بالخادم');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const errorCodes = useMemo(() => {
    if (!health) return [];
    return topCodes(health.create.byErrorCode, health.cancel.byErrorCode);
  }, [health]);

  const samplesEmpty =
    !samples.length &&
    (!health ||
      Object.values(health.timingsMs || {}).every((t) => (t?.count || 0) === 0));

  const openConfirm = (branch: BranchStatus, enable: boolean) => {
    setConfirmTarget(branch);
    setConfirmEnable(enable);
    setReason('');
    setActionError('');
    setConfirmOpen(true);
  };

  const submitToggle = async () => {
    if (!confirmTarget) return;
    setActionLoading(true);
    setActionError('');
    try {
      const res = await fetch('/api/admin/public-booking/booking-enabled', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          branchCode: confirmTarget.branchCode,
          bookingEnabled: confirmEnable,
          reason: reason.trim(),
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.ok) {
        setActionError(json.message || 'فشل تنفيذ الإجراء');
        return;
      }
      setConfirmOpen(false);
      await load(true);
    } catch {
      setActionError('خطأ في الاتصال بالخادم');
    } finally {
      setActionLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[50vh] gap-3">
        <Loader2 className="w-8 h-8 text-amber-500 animate-spin" />
        <p className="text-zinc-500 text-sm">جاري تحميل تشغيل الحجز العام...</p>
      </div>
    );
  }

  if (error && !health && !branches.length) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[50vh] gap-4">
        <p className="text-rose-400 text-sm">{error}</p>
        <Button onClick={() => load()} variant="outline" className="border-zinc-700">
          إعادة المحاولة
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-6xl mx-auto" dir="rtl">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-zinc-100 flex items-center gap-2">
            <Activity className="w-6 h-6 text-amber-500" />
            تشغيل الحجز العام
          </h1>
          <p className="text-zinc-500 text-sm mt-1">
            مراقبة الصحة وإيقاف/تشغيل الحجز لموقع Cutsaloon — بدون بيانات عملاء
          </p>
        </div>
        <Button
          variant="outline"
          className="border-zinc-700"
          onClick={() => load(true)}
          disabled={refreshing}
        >
          {refreshing ? (
            <Loader2 className="w-4 h-4 animate-spin ml-2" />
          ) : (
            <RefreshCw className="w-4 h-4 ml-2" />
          )}
          تحديث
        </Button>
      </div>

      {/* Contract mode */}
      <section className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-5">
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-zinc-400 text-sm">وضع العقد</span>
          <Badge
            className={cn(
              'text-sm',
              contractMode === 'enforce'
                ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
                : 'bg-amber-500/15 text-amber-400 border-amber-500/30',
            )}
          >
            {contractMode || 'غير معروف'}
          </Badge>
          {contractMode === 'enforce' ? (
            <span className="text-zinc-500 text-xs">
              الإنتاج يعمل بوضع enforce — لا يمكن تغييره من هذه الشاشة
            </span>
          ) : (
            <span className="text-amber-500/80 text-xs">
              الوضع الحالي ليس enforce (قد يكون بيئة محلية)
            </span>
          )}
        </div>
      </section>

      {(monitoringWarning || samplesEmpty) && (
        <section className="rounded-2xl border border-amber-500/30 bg-amber-500/5 p-4 flex gap-3">
          <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
          <div className="text-sm text-amber-100/90 space-y-1">
            <p className="font-medium">تحذير مراقبة</p>
            <p className="text-amber-200/70">
              {monitoringWarning ||
                'عينات الصحة الزمنية غير مملوءة بعد. نجاح/فشل الإنشاء والإلغاء من جداول idempotency متاح؛ التوقيتات ومعدل الحد وإعادة التشغيل تظهر بعد نشر Phase 8D.'}
            </p>
          </div>
        </section>
      )}

      {/* Branches */}
      <section className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-5 space-y-4">
        <h2 className="text-lg font-semibold text-zinc-100">حالة الفروع</h2>
        <div className="space-y-3">
          {branches.map((b) => (
            <div
              key={b.branchId}
              className="rounded-xl border border-zinc-800 bg-zinc-950/50 p-4 flex flex-wrap items-center justify-between gap-3"
            >
              <div className="space-y-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-semibold text-zinc-100">
                    {b.branchName || b.branchCode}
                  </span>
                  <Badge variant="outline" className="border-zinc-700 text-zinc-400">
                    {b.branchCode}
                  </Badge>
                  <Badge
                    className={
                      b.publiclyDiscoverable
                        ? 'bg-emerald-500/15 text-emerald-400'
                        : 'bg-zinc-700/40 text-zinc-400'
                    }
                  >
                    {b.publiclyDiscoverable ? 'ظاهر للعامة' : 'غير ظاهر للعامة'}
                  </Badge>
                </div>
                <div className="text-xs text-zinc-500 flex flex-wrap gap-x-4 gap-y-1">
                  <span>Lifecycle: {b.lifecycleStatus}</span>
                  <span>PublicBookingEnabled: {b.publicBookingEnabled ? '1' : '0'}</span>
                  <span>BookingEnabled: {b.bookingEnabled ? '1' : '0'}</span>
                  <span>IsActive: {b.isActive ? '1' : '0'}</span>
                </div>
                {b.branchCode === 'CAMP_CAESAR' && (
                  <p className="text-xs text-rose-400/90 mt-1">
                    كامب شيزار محمي — لا يمكن تفعيله للعامة من هذه الشاشة
                  </p>
                )}
              </div>
              {b.canPauseResume ? (
                <Button
                  variant={b.bookingEnabled ? 'destructive' : 'default'}
                  className={
                    b.bookingEnabled
                      ? ''
                      : 'bg-emerald-600 hover:bg-emerald-500 text-white'
                  }
                  onClick={() => openConfirm(b, !b.bookingEnabled)}
                >
                  {b.bookingEnabled ? (
                    <>
                      <PauseCircle className="w-4 h-4 ml-2" />
                      إيقاف الحجز العام
                    </>
                  ) : (
                    <>
                      <PlayCircle className="w-4 h-4 ml-2" />
                      استئناف الحجز العام
                    </>
                  )}
                </Button>
              ) : (
                <Badge variant="outline" className="border-zinc-700 text-zinc-500">
                  قراءة فقط
                </Badge>
              )}
            </div>
          ))}
          {!branches.length && (
            <p className="text-zinc-500 text-sm">لا توجد فروع للعرض</p>
          )}
        </div>
      </section>

      {/* 24h health */}
      {health && (
        <section className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-5 space-y-4">
          <div className="flex flex-wrap justify-between gap-2">
            <h2 className="text-lg font-semibold text-zinc-100">آخر ٢٤ ساعة</h2>
            <span className="text-xs text-zinc-500">
              {health.generatedAt
                ? new Date(health.generatedAt).toLocaleString('ar-EG')
                : ''}
            </span>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Kpi label="إنشاء ناجح" value={health.create.success} tone="good" />
            <Kpi label="إنشاء فاشل" value={health.create.failure} tone="bad" />
            <Kpi label="إلغاء ناجح" value={health.cancel.success} tone="good" />
            <Kpi label="إلغاء فاشل" value={health.cancel.failure} tone="bad" />
            <Kpi
              label="إعادة تشغيل (create)"
              value={health.create.idempotentReplay}
            />
            <Kpi
              label="إعادة تشغيل (cancel)"
              value={health.cancel.idempotentReplay}
            />
            <Kpi label="Rate limit" value={health.rateLimitEvents} />
            <Kpi label="PLAN_TOKEN أخطاء" value={health.create.planTokenErrors} />
            <Kpi
              label="mutation_outcome_unknown"
              value={
                health.create.mutationOutcomeUnknown +
                health.cancel.mutationOutcomeUnknown
              }
              tone={
                health.create.mutationOutcomeUnknown +
                  health.cancel.mutationOutcomeUnknown >
                0
                  ? 'bad'
                  : 'neutral'
              }
            />
          </div>

          <div>
            <h3 className="text-sm text-zinc-400 mb-2">أهم أكواد الخطأ</h3>
            {errorCodes.length ? (
              <div className="flex flex-wrap gap-2">
                {errorCodes.map((e) => (
                  <Badge
                    key={e.code}
                    variant="outline"
                    className="border-zinc-700 text-zinc-300 font-mono text-xs"
                  >
                    {e.code} · {e.count}
                  </Badge>
                ))}
              </div>
            ) : (
              <p className="text-zinc-600 text-sm">لا أخطاء مسجّلة</p>
            )}
          </div>

          <div>
            <h3 className="text-sm text-zinc-400 mb-2">التوقيتات (p50 / p95)</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-zinc-300">
                <thead>
                  <tr className="text-zinc-500 text-right border-b border-zinc-800">
                    <th className="py-2 font-medium">المسار</th>
                    <th className="py-2 font-medium">العدد</th>
                    <th className="py-2 font-medium">p50</th>
                    <th className="py-2 font-medium">p95</th>
                  </tr>
                </thead>
                <tbody>
                  {['availability', 'plan', 'create', 'cancel'].map((key) => {
                    const t = health.timingsMs?.[key] || {
                      count: 0,
                      p50: null,
                      p95: null,
                    };
                    return (
                      <tr key={key} className="border-b border-zinc-900">
                        <td className="py-2">{key}</td>
                        <td className="py-2">{t.count}</td>
                        <td className="py-2">{fmtMs(t.p50)}</td>
                        <td className="py-2">{fmtMs(t.p95)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      )}

      {/* Recent samples */}
      <section className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-5 space-y-3">
        <h2 className="text-lg font-semibold text-zinc-100">
          عينات صحة حديثة (مجهولة)
        </h2>
        {samples.length ? (
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-zinc-300">
              <thead>
                <tr className="text-zinc-500 border-b border-zinc-800 text-right">
                  <th className="py-2">الوقت</th>
                  <th className="py-2">العائلة</th>
                  <th className="py-2">المسار</th>
                  <th className="py-2">النتيجة</th>
                  <th className="py-2">الكود</th>
                  <th className="py-2">ms</th>
                  <th className="py-2">HTTP</th>
                </tr>
              </thead>
              <tbody>
                {samples.map((s, i) => (
                  <tr key={`${s.createdAtUtc}-${i}`} className="border-b border-zinc-900">
                    <td className="py-1.5 whitespace-nowrap">
                      {s.createdAtUtc
                        ? new Date(s.createdAtUtc).toLocaleString('ar-EG')
                        : '—'}
                    </td>
                    <td className="py-1.5">{s.routeFamily}</td>
                    <td className="py-1.5 font-mono">{s.routeKey}</td>
                    <td className="py-1.5">{s.outcome}</td>
                    <td className="py-1.5 font-mono">{s.errorCode || '—'}</td>
                    <td className="py-1.5">{s.durationMs}</td>
                    <td className="py-1.5">{s.httpStatus}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-zinc-600 text-sm">لا عينات بعد</p>
        )}
      </section>

      {/* Links */}
      <section className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-5">
        <h2 className="text-lg font-semibold text-zinc-100 mb-3">روابط سريعة</h2>
        <div className="flex flex-wrap gap-2">
          <QuickLink href="/admin/services" icon={Scissors} label="الخدمات" />
          <QuickLink href="/admin/hr" icon={Users} label="الحلاقون / HR" />
          <QuickLink href="/bookings/calendar" icon={Calendar} label="الجداول / التقويم" />
          <QuickLink
            href="/admin/queue-booking-settings"
            icon={Settings}
            label="إعدادات الحجز والطابور"
          />
        </div>
      </section>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent className="sm:max-w-md bg-zinc-950 border-zinc-800" dir="rtl">
          <DialogHeader>
            <DialogTitle className="text-zinc-100">
              {confirmEnable ? 'تأكيد استئناف الحجز العام' : 'تأكيد إيقاف الحجز العام'}
            </DialogTitle>
            <DialogDescription className="text-zinc-400">
              الفرع: {confirmTarget?.branchCode}. يتم تغيير BookingEnabled فقط —
              لن يتغير PublicBookingEnabled أو LifecycleStatus.
            </DialogDescription>
          </DialogHeader>
          <label className="block text-sm text-zinc-400 space-y-2">
            <span>سبب الإجراء (إلزامي)</span>
            <textarea
              className="w-full rounded-lg border border-zinc-700 bg-zinc-900 text-zinc-100 p-3 text-sm min-h-[88px]"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="مثال: صيانة مجدولة / استئناف بعد الصيانة"
            />
          </label>
          {actionError && <p className="text-rose-400 text-sm">{actionError}</p>}
          <DialogFooter className="gap-2 sm:gap-2">
            <Button
              variant="outline"
              className="border-zinc-700"
              onClick={() => setConfirmOpen(false)}
              disabled={actionLoading}
            >
              إلغاء
            </Button>
            <Button
              onClick={() => void submitToggle()}
              disabled={actionLoading || reason.trim().length < 3}
              className={
                confirmEnable
                  ? 'bg-emerald-600 hover:bg-emerald-500'
                  : 'bg-rose-600 hover:bg-rose-500'
              }
            >
              {actionLoading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : confirmEnable ? (
                'استئناف'
              ) : (
                'إيقاف'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Kpi({
  label,
  value,
  tone = 'neutral',
}: {
  label: string;
  value: number;
  tone?: 'good' | 'bad' | 'neutral';
}) {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-3">
      <div className="text-xs text-zinc-500 mb-1">{label}</div>
      <div
        className={cn(
          'text-xl font-semibold',
          tone === 'good' && 'text-emerald-400',
          tone === 'bad' && 'text-rose-400',
          tone === 'neutral' && 'text-zinc-100',
        )}
      >
        {value}
      </div>
    </div>
  );
}

function QuickLink({
  href,
  icon: Icon,
  label,
}: {
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
}) {
  return (
    <Link
      href={href}
      className="inline-flex items-center gap-2 rounded-xl border border-zinc-800 bg-zinc-950/50 px-3 py-2 text-sm text-zinc-300 hover:border-amber-500/40 hover:text-amber-200 transition-colors"
    >
      <Icon className="w-4 h-4 text-amber-500" />
      {label}
    </Link>
  );
}

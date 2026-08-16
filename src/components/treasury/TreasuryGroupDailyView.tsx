'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  Building2,
  CalendarDays,
  ChevronDown,
  ChevronUp,
  Loader2,
  RefreshCw,
  TrendingDown,
  TrendingUp,
  Wallet,
} from 'lucide-react';
import type { GroupDailyTreasuryResult } from '@/lib/types/treasury-group-daily';

function formatMoney(amount: number): string {
  return (
    new Intl.NumberFormat('ar-EG', {
      style: 'decimal',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount) + ' ج.م'
  );
}

function todayCairoFallback(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Cairo' });
}

function dayStatusLabel(status: 'open' | 'closed' | 'missing'): string {
  if (status === 'open') return 'يوم مفتوح';
  if (status === 'closed') return 'يوم مقفول';
  return 'لا يوجد يوم';
}

function dayStatusClass(status: 'open' | 'closed' | 'missing'): string {
  if (status === 'open') return 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30';
  if (status === 'closed') return 'bg-zinc-500/15 text-zinc-300 border-zinc-500/30';
  return 'bg-amber-500/15 text-amber-200 border-amber-500/30';
}

export default function TreasuryGroupDailyView() {
  const [day, setDay] = useState(todayCairoFallback);
  const [data, setData] = useState<GroupDailyTreasuryResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Record<number, boolean>>({});

  const load = useCallback(async (selectedDay: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/treasury/group-daily?day=${encodeURIComponent(selectedDay)}`);
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || 'فشل تحميل البيانات');
      setData(json as GroupDailyTreasuryResult);
    } catch (e) {
      setData(null);
      setError(e instanceof Error ? e.message : 'حدث خطأ غير متوقع');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(day);
  }, [day, load]);

  const summary = data?.groupSummary;

  return (
    <div className="space-y-6" dir="rtl">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">خزنة كل الفروع</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            ملخص ذكي وشامل لحسابات جميع الفروع في يوم واحد — لمدير النظام فقط
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-2 rounded-xl border border-border bg-surface-muted px-3 py-2 text-sm">
            <CalendarDays className="h-4 w-4 text-muted-foreground" />
            <input
              type="date"
              value={day}
              onChange={(e) => setDay(e.target.value)}
              className="bg-transparent text-foreground outline-none"
            />
          </label>
          <button
            type="button"
            onClick={() => void load(day)}
            disabled={loading}
            className="inline-flex items-center gap-2 rounded-xl border border-border bg-surface px-3 py-2 text-sm text-foreground hover:bg-surface-muted disabled:opacity-50"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            تحديث
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {loading && !data ? (
        <div className="flex items-center justify-center gap-2 py-20 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
          جاري تحميل ملخص كل الفروع…
        </div>
      ) : summary ? (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Kpi
              label="صافي كل الفروع"
              value={formatMoney(summary.grandNet)}
              icon={Wallet}
              tone={summary.grandNet >= 0 ? 'good' : 'bad'}
            />
            <Kpi
              label="إجمالي الوارد"
              value={formatMoney(summary.totalInflow)}
              icon={TrendingUp}
              tone="good"
            />
            <Kpi
              label="إجمالي الصادر"
              value={formatMoney(summary.totalOutflow)}
              icon={TrendingDown}
              tone="bad"
            />
            <Kpi
              label="المعاملات / الفروع النشطة"
              value={`${summary.transactionCount} / ${summary.branchesWithActivity}`}
              icon={Activity}
              tone="neutral"
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 text-sm">
            <MetaCard label="مبيعات" value={formatMoney(summary.salesInflow)} />
            <MetaCard label="إيرادات أخرى" value={formatMoney(summary.incomeInflow)} />
            <MetaCard label="مصروفات" value={formatMoney(summary.expenseOutflow)} />
            <MetaCard label="صافي النقدي" value={formatMoney(summary.cashNet)} />
          </div>

          <div className="flex flex-wrap gap-2 text-xs">
            <span className="rounded-full border border-border px-3 py-1 text-muted-foreground">
              فروع: {summary.branchCount}
            </span>
            <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-emerald-300">
              أيام مفتوحة: {summary.openDayCount}
            </span>
            <span className="rounded-full border border-zinc-500/30 bg-zinc-500/10 px-3 py-1 text-zinc-300">
              أيام مقفولة: {summary.closedDayCount}
            </span>
            <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-3 py-1 text-amber-200">
              بدون يوم: {summary.missingDayCount}
            </span>
            {summary.topPaymentMethod ? (
              <span className="rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-primary">
                أعلى طريقة دفع: {summary.topPaymentMethod}
              </span>
            ) : null}
          </div>

          {(data?.alerts.length ?? 0) > 0 && (
            <div className="space-y-2 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4">
              <div className="flex items-center gap-2 text-sm font-medium text-amber-100">
                <AlertTriangle className="h-4 w-4" />
                تنبيهات سلامة للفروع في هذا اليوم
              </div>
              {data!.alerts.map((a) => (
                <p key={a.code} className="text-sm text-amber-100/90">
                  {a.message}: <strong>{a.count}</strong>
                </p>
              ))}
            </div>
          )}

          <section className="space-y-3">
            <h2 className="flex items-center gap-2 text-lg font-semibold text-foreground">
              <Building2 className="h-5 w-5" />
              حسب الفرع
            </h2>
            <div className="space-y-3">
              {data!.branches.map((b) => {
                const open = !!expanded[b.branchId];
                return (
                  <div
                    key={b.branchId}
                    className="overflow-hidden rounded-2xl border border-border bg-surface"
                  >
                    <button
                      type="button"
                      onClick={() =>
                        setExpanded((prev) => ({ ...prev, [b.branchId]: !prev[b.branchId] }))
                      }
                      className="flex w-full items-center justify-between gap-3 px-4 py-3 text-right hover:bg-surface-muted/60"
                    >
                      <div className="min-w-0 space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-semibold text-foreground">{b.branchName}</span>
                          <span className="text-xs text-muted-foreground">{b.branchCode}</span>
                          <span
                            className={`rounded-full border px-2 py-0.5 text-[11px] ${dayStatusClass(b.dayStatus)}`}
                          >
                            {dayStatusLabel(b.dayStatus)}
                          </span>
                        </div>
                        <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
                          <span>وارد {formatMoney(b.totalInflow)}</span>
                          <span>صادر {formatMoney(b.totalOutflow)}</span>
                          <span>معاملات {b.transactionCount}</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-3 shrink-0">
                        <span
                          className={`text-base font-bold ${
                            b.grandNet >= 0 ? 'text-emerald-400' : 'text-destructive'
                          }`}
                        >
                          {formatMoney(b.grandNet)}
                        </span>
                        {open ? (
                          <ChevronUp className="h-4 w-4 text-muted-foreground" />
                        ) : (
                          <ChevronDown className="h-4 w-4 text-muted-foreground" />
                        )}
                      </div>
                    </button>

                    {open && (
                      <div className="border-t border-border px-4 py-3 space-y-4 bg-surface-muted/20">
                        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4 text-sm">
                          <MetaCard label="مبيعات" value={formatMoney(b.salesInflow)} />
                          <MetaCard label="إيرادات" value={formatMoney(b.incomeInflow)} />
                          <MetaCard label="مصروفات" value={formatMoney(b.expenseOutflow)} />
                          <MetaCard label="نقدي" value={formatMoney(b.cashNet)} />
                        </div>

                        <div>
                          <h3 className="mb-2 text-sm font-medium text-foreground">طرق الدفع</h3>
                          {b.paymentMethods.length === 0 ? (
                            <p className="text-xs text-muted-foreground">لا توجد حركات في هذا الفرع.</p>
                          ) : (
                            <div className="overflow-x-auto rounded-xl border border-border">
                              <table className="min-w-full text-sm">
                                <thead className="bg-surface-muted/50 text-muted-foreground">
                                  <tr>
                                    <th className="px-3 py-2 text-right font-medium">الطريقة</th>
                                    <th className="px-3 py-2 text-right font-medium">وارد</th>
                                    <th className="px-3 py-2 text-right font-medium">صادر</th>
                                    <th className="px-3 py-2 text-right font-medium">صافي</th>
                                    <th className="px-3 py-2 text-right font-medium">عدد</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {b.paymentMethods.map((pm) => (
                                    <tr key={pm.paymentMethodKey} className="border-t border-border/70">
                                      <td className="px-3 py-2">{pm.paymentMethodName}</td>
                                      <td className="px-3 py-2 text-emerald-400">{formatMoney(pm.inflow)}</td>
                                      <td className="px-3 py-2 text-destructive">{formatMoney(pm.outflow)}</td>
                                      <td className="px-3 py-2 font-medium">{formatMoney(pm.net)}</td>
                                      <td className="px-3 py-2">{pm.transactionCount}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          )}
                        </div>

                        {b.topUsers.length > 0 && (
                          <div>
                            <h3 className="mb-2 text-sm font-medium text-foreground">
                              أعلى مستخدمين على الوردية
                            </h3>
                            <div className="flex flex-wrap gap-2">
                              {b.topUsers.map((u) => (
                                <span
                                  key={u.userId}
                                  className="rounded-lg border border-border bg-surface px-3 py-1.5 text-xs"
                                >
                                  {u.userName}:{' '}
                                  <strong className={u.net >= 0 ? 'text-emerald-400' : 'text-destructive'}>
                                    {formatMoney(u.net)}
                                  </strong>{' '}
                                  <span className="text-muted-foreground">({u.transactionCount})</span>
                                </span>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-semibold text-foreground">طرق الدفع — إجمالي المجموعة</h2>
            {data!.paymentMethods.length === 0 ? (
              <p className="text-sm text-muted-foreground">لا توجد حركات في هذا اليوم.</p>
            ) : (
              <div className="overflow-x-auto rounded-2xl border border-border">
                <table className="min-w-full text-sm">
                  <thead className="bg-surface-muted/50 text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2.5 text-right font-medium">الطريقة</th>
                      <th className="px-3 py-2.5 text-right font-medium">وارد</th>
                      <th className="px-3 py-2.5 text-right font-medium">صادر</th>
                      <th className="px-3 py-2.5 text-right font-medium">صافي</th>
                      <th className="px-3 py-2.5 text-right font-medium">مبيعات</th>
                      <th className="px-3 py-2.5 text-right font-medium">%</th>
                      <th className="px-3 py-2.5 text-right font-medium">عدد</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data!.paymentMethods.map((pm) => (
                      <tr key={pm.paymentMethodKey} className="border-t border-border/70">
                        <td className="px-3 py-2.5">{pm.paymentMethodName}</td>
                        <td className="px-3 py-2.5 text-emerald-400">{formatMoney(pm.inflow)}</td>
                        <td className="px-3 py-2.5 text-destructive">{formatMoney(pm.outflow)}</td>
                        <td className="px-3 py-2.5 font-medium">{formatMoney(pm.net)}</td>
                        <td className="px-3 py-2.5">{formatMoney(pm.salesInflow)}</td>
                        <td className="px-3 py-2.5">{pm.percentageOfTotal.toFixed(1)}%</td>
                        <td className="px-3 py-2.5">{pm.transactionCount}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      ) : null}
    </div>
  );
}

function Kpi({
  label,
  value,
  icon: Icon,
  tone,
}: {
  label: string;
  value: string;
  icon: typeof Wallet;
  tone: 'good' | 'bad' | 'neutral';
}) {
  const toneClass =
    tone === 'good'
      ? 'border-emerald-500/20 bg-emerald-500/5'
      : tone === 'bad'
        ? 'border-destructive/20 bg-destructive/5'
        : 'border-border bg-surface';
  const iconClass =
    tone === 'good' ? 'text-emerald-400' : tone === 'bad' ? 'text-destructive' : 'text-muted-foreground';
  return (
    <div className={`rounded-2xl border px-4 py-3 ${toneClass}`}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-muted-foreground">{label}</span>
        <Icon className={`h-4 w-4 ${iconClass}`} />
      </div>
      <p className="mt-2 text-lg font-bold text-foreground">{value}</p>
    </div>
  );
}

function MetaCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border bg-surface px-3 py-2">
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className="mt-0.5 font-semibold text-foreground">{value}</p>
    </div>
  );
}

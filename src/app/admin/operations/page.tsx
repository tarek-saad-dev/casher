'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  Activity, RefreshCw, Loader2, Clock, CalendarDays,
  Users, TrendingUp, History
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import DayControlCard from '@/components/operations/DayControlCard';
import ShiftControlCard from '@/components/operations/ShiftControlCard';
import TreasurySnapshotCard from '@/components/operations/TreasurySnapshotCard';
import AlertsCard from '@/components/operations/AlertsCard';
import type { OperationsStatus } from '@/lib/types/operations';

const fmt = (n: number) =>
  new Intl.NumberFormat('ar-EG', { minimumFractionDigits: 0 }).format(n);

export default function OperationsCenterPage() {
  const [status, setStatus] = useState<OperationsStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    else setRefreshing(true);
    setError('');
    try {
      const res = await fetch('/api/operations/status');
      if (!res.ok) {
        const d = await res.json();
        setError(d.error || 'خطأ في جلب البيانات');
        return;
      }
      const data: OperationsStatus = await res.json();
      setStatus(data);
      setLastRefresh(new Date());
    } catch {
      setError('خطأ في الاتصال بالخادم');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Auto-refresh every 30s
  useEffect(() => {
    const id = setInterval(() => load(true), 30_000);
    return () => clearInterval(id);
  }, [load]);

  const isAdmin = status?.user?.UserLevel === 'admin';
  const hasActiveDay = !!status?.day;
  const hasActiveShift = !!status?.shift;

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
        <div className="w-14 h-14 rounded-2xl bg-zinc-800/60 flex items-center justify-center">
          <Activity className="w-7 h-7 text-amber-500 animate-pulse" />
        </div>
        <p className="text-zinc-500 text-sm">جاري تحميل مركز التشغيل...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
        <p className="text-rose-400 text-sm">{error}</p>
        <Button onClick={() => load()} variant="outline" className="border-zinc-700">إعادة المحاولة</Button>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-8">

      {/* ── Page Header ────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-2xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center">
            <Activity className="w-6 h-6 text-amber-400" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-white">مركز التشغيل</h1>
            <p className="text-sm text-zinc-500 mt-0.5">إدارة اليوم والورديات والمتابعة اللحظية</p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {/* Status pills */}
          <div className="flex items-center gap-2">
            <span className={cn(
              'flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-full border',
              hasActiveDay
                ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                : 'bg-zinc-800 text-zinc-500 border-zinc-700'
            )}>
              <span className={cn('w-1.5 h-1.5 rounded-full', hasActiveDay ? 'bg-emerald-400 animate-pulse' : 'bg-zinc-600')} />
              {hasActiveDay ? 'يوم نشط' : 'بدون يوم'}
            </span>
            <span className={cn(
              'flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-full border',
              hasActiveShift
                ? 'bg-blue-500/10 text-blue-400 border-blue-500/30'
                : 'bg-zinc-800 text-zinc-500 border-zinc-700'
            )}>
              <span className={cn('w-1.5 h-1.5 rounded-full', hasActiveShift ? 'bg-blue-400 animate-pulse' : 'bg-zinc-600')} />
              {hasActiveShift ? 'وردية نشطة' : 'بدون وردية'}
            </span>
          </div>

          <Button
            variant="outline"
            size="sm"
            onClick={() => load(true)}
            disabled={refreshing}
            className="border-zinc-700 gap-2"
          >
            <RefreshCw className={cn('w-3.5 h-3.5', refreshing && 'animate-spin')} />
            تحديث
          </Button>
        </div>
      </div>

      {/* ── Quick Stats Bar ─────────────────────────────────── */}
      {status && (hasActiveDay || hasActiveShift) && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <QuickStat
            icon={<TrendingUp className="w-4 h-4 text-emerald-400" />}
            label="مبيعات اليوم"
            value={fmt(status.daySummary?.totalRevenue || 0)}
            sub="ج.م"
          />
          <QuickStat
            icon={<Clock className="w-4 h-4 text-blue-400" />}
            label="فواتير الوردية"
            value={`${status.shiftSummary?.salesCount || 0}`}
            sub="فاتورة"
          />
          <QuickStat
            icon={<Users className="w-4 h-4 text-amber-400" />}
            label="ورديات مفتوحة"
            value={`${status.allOpenShifts.length}`}
            sub="وردية"
            warn={status.allOpenShifts.length > 2}
          />
          <QuickStat
            icon={<CalendarDays className="w-4 h-4 text-zinc-400" />}
            label="تاريخ اليوم"
            value={status.day ? new Date(status.day.NewDay).toLocaleDateString('ar-EG', { day: '2-digit', month: '2-digit' }) : '—'}
            sub={status.day ? new Date(status.day.NewDay).toLocaleDateString('ar-EG', { weekday: 'long' }) : 'لا يوجد'}
          />
        </div>
      )}

      {/* ── Main 4-Card Grid ────────────────────────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <DayControlCard
          day={status?.day || null}
          daySummary={status?.daySummary || null}
          allOpenShifts={status?.allOpenShifts || []}
          canOpen={isAdmin}
          canClose={isAdmin}
          onRefresh={() => load(true)}
        />
        <ShiftControlCard
          day={status?.day || null}
          shift={status?.shift || null}
          shiftSummary={status?.shiftSummary || null}
          userDefaultShift={status?.userDefaultShift || null}
          canOpen={true}
          canClose={true}
          onRefresh={() => load(true)}
        />
        <TreasurySnapshotCard
          shiftSummary={status?.shiftSummary || null}
          hasActiveShift={hasActiveShift}
        />
        <AlertsCard alerts={status?.alerts || []} />
      </div>

      {/* ── Open Shifts Section (admin) ──────────────────────── */}
      {isAdmin && status?.allOpenShifts && status.allOpenShifts.length > 0 && (
        <section className="space-y-3">
          <div className="flex items-center gap-2">
            <h2 className="text-base font-semibold text-zinc-300">الورديات المفتوحة الآن</h2>
            <Badge className="bg-blue-500/15 text-blue-400 border border-blue-500/30 text-xs">
              {status.allOpenShifts.length}
            </Badge>
          </div>
          <div className="rounded-xl border border-zinc-800/50 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-zinc-900/80 border-b border-zinc-800">
                  <th className="px-4 py-3 text-right text-xs text-zinc-500 font-medium">المستخدم</th>
                  <th className="px-4 py-3 text-right text-xs text-zinc-500 font-medium">الوردية</th>
                  <th className="px-4 py-3 text-right text-xs text-zinc-500 font-medium">وقت البدء</th>
                  <th className="px-4 py-3 text-center text-xs text-zinc-500 font-medium">الحالة</th>
                </tr>
              </thead>
              <tbody>
                {status.allOpenShifts.map(s => (
                  <tr key={s.ID} className="border-t border-zinc-800/40 hover:bg-zinc-800/20 transition-colors">
                    <td className="px-4 py-3 font-medium text-white">{s.UserName}</td>
                    <td className="px-4 py-3 text-zinc-300">{s.ShiftName}</td>
                    <td className="px-4 py-3 text-zinc-400 font-mono text-xs" dir="ltr">{s.StartTime}</td>
                    <td className="px-4 py-3 text-center">
                      <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-blue-500/15 text-blue-400 border border-blue-500/20">
                        <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
                        نشطة
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* ── Recent Shift History ────────────────────────────── */}
      <RecentShiftHistory />

      {/* Last refresh indicator */}
      {lastRefresh && (
        <p className="text-xs text-zinc-700 text-center">
          آخر تحديث: {lastRefresh.toLocaleTimeString('ar-EG')}
        </p>
      )}
    </div>
  );
}

// ── Quick Stat Component ──────────────────────────────────────
function QuickStat({
  icon, label, value, sub, warn
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub: string;
  warn?: boolean;
}) {
  return (
    <div className={cn(
      'rounded-xl border p-4 flex items-center gap-3',
      warn ? 'bg-amber-950/20 border-amber-800/30' : 'bg-zinc-900/50 border-zinc-800/40'
    )}>
      <div className={cn(
        'w-9 h-9 rounded-lg flex items-center justify-center',
        warn ? 'bg-amber-500/10' : 'bg-zinc-800/60'
      )}>
        {icon}
      </div>
      <div>
        <p className="text-xs text-zinc-500">{label}</p>
        <div className="flex items-baseline gap-1 mt-0.5">
          <span className="text-lg font-bold text-white tabular-nums">{value}</span>
          <span className="text-xs text-zinc-600">{sub}</span>
        </div>
      </div>
    </div>
  );
}

// ── Recent Shift History Component ───────────────────────────
function RecentShiftHistory() {
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(false);

  interface HistoryRow {
    ID: number;
    NewDay: string;
    UserName: string;
    ShiftName: string;
    StartTime: string;
    EndTime: string | null;
    Status: boolean;
    salesCount: number;
    totalRevenue: number;
  }

  useEffect(() => {
    fetch('/api/shift/history')
      .then(r => r.json())
      .then(d => { if (Array.isArray(d)) setHistory(d); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const visible = expanded ? history : history.slice(0, 5);

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h2 className="text-base font-semibold text-zinc-300">سجل الورديات الأخيرة</h2>
          <History className="w-4 h-4 text-zinc-600" />
        </div>
        {history.length > 5 && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setExpanded(p => !p)}
            className="text-xs text-zinc-500 hover:text-zinc-300"
          >
            {expanded ? 'عرض أقل' : `عرض الكل (${history.length})`}
          </Button>
        )}
      </div>

      {loading ? (
        <div className="flex justify-center py-6">
          <Loader2 className="w-5 h-5 animate-spin text-zinc-600" />
        </div>
      ) : history.length === 0 ? (
        <div className="text-center py-6 text-sm text-zinc-600">لا يوجد سجل ورديات</div>
      ) : (
        <div className="rounded-xl border border-zinc-800/50 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-zinc-900/80 border-b border-zinc-800">
                <th className="px-4 py-3 text-right text-xs text-zinc-500 font-medium">المستخدم</th>
                <th className="px-4 py-3 text-right text-xs text-zinc-500 font-medium">الوردية</th>
                <th className="px-4 py-3 text-right text-xs text-zinc-500 font-medium">التاريخ</th>
                <th className="px-4 py-3 text-right text-xs text-zinc-500 font-medium hidden sm:table-cell">البداية</th>
                <th className="px-4 py-3 text-right text-xs text-zinc-500 font-medium hidden sm:table-cell">النهاية</th>
                <th className="px-4 py-3 text-left text-xs text-zinc-500 font-medium">المبيعات</th>
                <th className="px-4 py-3 text-center text-xs text-zinc-500 font-medium">الحالة</th>
              </tr>
            </thead>
            <tbody>
              {visible.map(row => (
                <tr key={row.ID} className="border-t border-zinc-800/40 hover:bg-zinc-800/20 transition-colors">
                  <td className="px-4 py-3 font-medium text-zinc-200">{row.UserName}</td>
                  <td className="px-4 py-3 text-zinc-400">{row.ShiftName}</td>
                  <td className="px-4 py-3 text-zinc-500 text-xs">
                    {new Date(row.NewDay).toLocaleDateString('ar-EG')}
                  </td>
                  <td className="px-4 py-3 text-zinc-500 text-xs font-mono hidden sm:table-cell" dir="ltr">
                    {row.StartTime?.trim() || '—'}
                  </td>
                  <td className="px-4 py-3 text-zinc-500 text-xs font-mono hidden sm:table-cell" dir="ltr">
                    {row.EndTime?.trim() || '—'}
                  </td>
                  <td className="px-4 py-3 text-left">
                    <span className="text-emerald-400 font-mono text-xs">{fmt(row.totalRevenue)}</span>
                    <span className="text-zinc-600 text-xs mr-1">({row.salesCount})</span>
                  </td>
                  <td className="px-4 py-3 text-center">
                    {row.Status ? (
                      <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-400 border border-blue-500/20">
                        <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
                        نشطة
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-zinc-800 text-zinc-500 border border-zinc-700">
                        مغلقة
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

'use client';

import { useEffect, useState } from 'react';
import { Loader2, Wallet, Users, PiggyBank } from 'lucide-react';

interface HoldBreakdown {
  treasuryTotal: number;
  employeeEntitlements: number;
  employeeAdvancesReceivable: number;
  netProfit: number;
}

const fmt = (n: number) =>
  new Intl.NumberFormat('ar-EG', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);

export interface TreasuryHoldBreakdownFilters {
  newDay: string | null;
  dateFrom: string | null;
  dateTo: string | null;
  shiftMoveId: number | null;
  userId: number | null;
}

export default function TreasuryHoldBreakdown({
  filters,
  reloadSignal = 0,
}: {
  filters: TreasuryHoldBreakdownFilters;
  reloadSignal?: number;
}) {
  const [data, setData] = useState<HoldBreakdown | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const params = new URLSearchParams();
  if (filters.newDay !== null) params.append('newDay', filters.newDay);
  if (filters.dateFrom) params.append('dateFrom', filters.dateFrom);
  if (filters.dateTo) params.append('dateTo', filters.dateTo);
  if (filters.shiftMoveId !== null) params.append('shiftMoveId', String(filters.shiftMoveId));
  if (filters.userId !== null) params.append('userId', String(filters.userId));
  const queryStr = params.toString();

  useEffect(() => {
    let active = true;
    setLoading(true);
    (async () => {
      try {
        const res = await fetch(`/api/treasury/hold-breakdown?${queryStr}`);
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || 'فشل تحميل توزيع رصيد الخزنة');
        if (active) {
          setData(json);
          setError('');
        }
      } catch (e) {
        if (active) setError(e instanceof Error ? e.message : 'حدث خطأ غير متوقع');
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [queryStr, reloadSignal]);

  return (
    <div className="rounded-xl sm:rounded-2xl border border-border bg-card p-3 sm:p-5">
      <div className="flex items-center justify-between gap-2 mb-3 sm:mb-4">
        <div>
          <h2 className="text-sm sm:text-base font-bold text-foreground">توزيع رصيد الخزنة</h2>
          <p className="text-[10px] sm:text-xs text-muted-foreground mt-0.5">
            صافي الخزنة للفترة المحددة وكم منه محتجز لاستحقاقات الموظفين وكم صافي ربح فعلي
          </p>
        </div>
        {loading && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground shrink-0" />}
      </div>

      {error ? (
        <p className="text-destructive text-sm">{error}</p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="rounded-xl border border-border bg-muted p-3 sm:p-4">
            <div className="flex items-center gap-2 mb-1.5">
              <span className="p-1.5 rounded-lg bg-info-soft">
                <Wallet className="w-4 h-4 text-info" />
              </span>
              <span className="text-xs sm:text-sm text-muted-foreground">صافي الخزنة (الفترة)</span>
            </div>
            <p className="text-lg sm:text-2xl font-bold text-info tabular-nums">
              {data ? fmt(data.treasuryTotal) : '—'}
              <span className="text-xs font-normal mr-1">ج.م</span>
            </p>
          </div>

          <div className="rounded-xl border border-warning/25 bg-warning-soft p-3 sm:p-4">
            <div className="flex items-center gap-2 mb-1.5">
              <span className="p-1.5 rounded-lg bg-warning-soft">
                <Users className="w-4 h-4 text-warning" />
              </span>
              <span className="text-xs sm:text-sm text-muted-foreground">محتجز لاستحقاقات الموظفين</span>
            </div>
            <p className="text-lg sm:text-2xl font-bold text-warning tabular-nums">
              {data ? fmt(data.employeeEntitlements) : '—'}
              <span className="text-xs font-normal mr-1">ج.م</span>
            </p>
            {data && data.employeeAdvancesReceivable > 0 && (
              <p className="text-[10px] sm:text-xs text-muted-foreground mt-1">
                سلف مستحقة على الموظفين: {fmt(data.employeeAdvancesReceivable)} ج.م
              </p>
            )}
          </div>

          <div
            className={`rounded-xl border p-3 sm:p-4 ${
              data && data.netProfit < 0
                ? 'border-destructive/25 bg-destructive-soft'
                : 'border-success/25 bg-success-soft'
            }`}
          >
            <div className="flex items-center gap-2 mb-1.5">
              <span
                className={`p-1.5 rounded-lg ${
                  data && data.netProfit < 0 ? 'bg-destructive-soft' : 'bg-success-soft'
                }`}
              >
                <PiggyBank
                  className={`w-4 h-4 ${
                    data && data.netProfit < 0 ? 'text-destructive' : 'text-success'
                  }`}
                />
              </span>
              <span className="text-xs sm:text-sm text-muted-foreground">صافي الربح الفعلي</span>
            </div>
            <p
              className={`text-lg sm:text-2xl font-bold tabular-nums ${
                data && data.netProfit < 0 ? 'text-destructive' : 'text-success'
              }`}
            >
              {data ? fmt(data.netProfit) : '—'}
              <span className="text-xs font-normal mr-1">ج.م</span>
            </p>
            <p className="text-[10px] sm:text-xs text-muted-foreground mt-1">
              = إجمالي الخزنة − استحقاقات الموظفين
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

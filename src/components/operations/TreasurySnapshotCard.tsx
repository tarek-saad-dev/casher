'use client';

import { Coins, CreditCard, Wallet } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ShiftSummaryData } from '@/lib/types/operations';

interface Props {
  shiftSummary: ShiftSummaryData | null;
  hasActiveShift: boolean;
}

const fmt = (n: number) =>
  new Intl.NumberFormat('ar-EG', { minimumFractionDigits: 0 }).format(n);

const METHOD_ICONS: Record<string, React.ReactNode> = {
  كاش: <Coins className="w-4 h-4 text-success" />,
  نقدي: <Coins className="w-4 h-4 text-success" />,
  فيزا: <CreditCard className="w-4 h-4 text-info" />,
  'ماستر كارد': <CreditCard className="w-4 h-4 text-warning" />,
  إنستاباي: <CreditCard className="w-4 h-4 text-brand" />,
};

function getIcon(method: string) {
  for (const key of Object.keys(METHOD_ICONS)) {
    if (method?.includes(key)) return METHOD_ICONS[key];
  }
  return <Wallet className="w-4 h-4 text-muted-foreground" />;
}

export default function TreasurySnapshotCard({ shiftSummary, hasActiveShift }: Props) {
  const netCash = shiftSummary ? shiftSummary.cashIn - shiftSummary.cashOut : 0;

  return (
    <div className="rounded-2xl border border-border bg-card p-4 sm:p-6 flex flex-col gap-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="w-11 h-11 rounded-xl bg-warning-soft flex items-center justify-center">
          <Wallet className="w-5 h-5 text-warning" />
        </div>
        <div>
          <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider">الخزنة</p>
          <h3 className="text-base font-bold text-foreground mt-0.5">ملخص الوردية</h3>
        </div>
      </div>

      {!hasActiveShift || !shiftSummary ? (
        <div className="flex-1 flex items-center justify-center py-6">
          <p className="text-sm text-muted-foreground text-center">لا توجد وردية مفتوحة</p>
        </div>
      ) : (
        <div className="space-y-3 flex-1">
          {/* Total revenue */}
          <div className="bg-card rounded-xl p-4 border border-border">
            <p className="text-xs text-muted-foreground mb-1">إجمالي التحصيل</p>
            <p className="text-2xl font-bold text-warning">{fmt(shiftSummary.totalRevenue)}</p>
            <p className="text-xs text-muted-foreground mt-0.5">{shiftSummary.salesCount} فاتورة</p>
          </div>

          {/* Payment breakdown */}
          {shiftSummary.paymentBreakdown.length > 0 && (
            <div className="space-y-2">
              {shiftSummary.paymentBreakdown.map(p => (
                <div
                  key={p.method}
                  className="flex items-center justify-between bg-card rounded-lg px-3 py-2.5 border border-border"
                >
                  <div className="flex items-center gap-2">
                    {getIcon(p.method)}
                    <span className="text-sm text-foreground">{p.method}</span>
                    <span className="text-xs text-muted-foreground">({p.cnt} معاملة)</span>
                  </div>
                  <span className="text-sm font-semibold text-foreground font-mono">{fmt(p.total)}</span>
                </div>
              ))}
            </div>
          )}

          {/* Net cash movement */}
          <div className={cn(
            'flex items-center justify-between rounded-lg px-3 py-2.5 border text-sm',
            netCash >= 0
              ? 'bg-success-soft border-success/30'
              : 'bg-destructive-soft border-destructive/30'
          )}>
            <span className="text-muted-foreground">صافي النقدية</span>
            <span className={cn(
              'font-bold font-mono',
              netCash >= 0 ? 'text-success' : 'text-destructive'
            )}>
              {netCash >= 0 ? '+' : ''}{fmt(netCash)}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

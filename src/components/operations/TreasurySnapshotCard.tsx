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
  كاش: <Coins className="w-4 h-4 text-emerald-400" />,
  نقدي: <Coins className="w-4 h-4 text-emerald-400" />,
  فيزا: <CreditCard className="w-4 h-4 text-blue-400" />,
  'ماستر كارد': <CreditCard className="w-4 h-4 text-orange-400" />,
  إنستاباي: <CreditCard className="w-4 h-4 text-purple-400" />,
};

function getIcon(method: string) {
  for (const key of Object.keys(METHOD_ICONS)) {
    if (method?.includes(key)) return METHOD_ICONS[key];
  }
  return <Wallet className="w-4 h-4 text-zinc-400" />;
}

export default function TreasurySnapshotCard({ shiftSummary, hasActiveShift }: Props) {
  const netCash = shiftSummary ? shiftSummary.cashIn - shiftSummary.cashOut : 0;

  return (
    <div className="rounded-2xl border border-zinc-800/50 bg-zinc-900/60 p-6 flex flex-col gap-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="w-11 h-11 rounded-xl bg-amber-500/10 flex items-center justify-center">
          <Wallet className="w-5 h-5 text-amber-400" />
        </div>
        <div>
          <p className="text-xs text-zinc-500 font-medium uppercase tracking-wider">الخزنة</p>
          <h3 className="text-base font-bold text-white mt-0.5">ملخص الوردية</h3>
        </div>
      </div>

      {!hasActiveShift || !shiftSummary ? (
        <div className="flex-1 flex items-center justify-center py-6">
          <p className="text-sm text-zinc-600 text-center">لا توجد وردية مفتوحة</p>
        </div>
      ) : (
        <div className="space-y-3 flex-1">
          {/* Total revenue */}
          <div className="bg-zinc-950/50 rounded-xl p-4 border border-zinc-800/50">
            <p className="text-xs text-zinc-500 mb-1">إجمالي التحصيل</p>
            <p className="text-2xl font-bold text-amber-400">{fmt(shiftSummary.totalRevenue)}</p>
            <p className="text-xs text-zinc-600 mt-0.5">{shiftSummary.salesCount} فاتورة</p>
          </div>

          {/* Payment breakdown */}
          {shiftSummary.paymentBreakdown.length > 0 && (
            <div className="space-y-2">
              {shiftSummary.paymentBreakdown.map(p => (
                <div
                  key={p.method}
                  className="flex items-center justify-between bg-zinc-950/30 rounded-lg px-3 py-2.5 border border-zinc-800/40"
                >
                  <div className="flex items-center gap-2">
                    {getIcon(p.method)}
                    <span className="text-sm text-zinc-300">{p.method}</span>
                    <span className="text-xs text-zinc-600">({p.cnt} معاملة)</span>
                  </div>
                  <span className="text-sm font-semibold text-zinc-200 font-mono">{fmt(p.total)}</span>
                </div>
              ))}
            </div>
          )}

          {/* Net cash movement */}
          <div className={cn(
            'flex items-center justify-between rounded-lg px-3 py-2.5 border text-sm',
            netCash >= 0
              ? 'bg-emerald-950/20 border-emerald-800/30'
              : 'bg-rose-950/20 border-rose-800/30'
          )}>
            <span className="text-zinc-400">صافي النقدية</span>
            <span className={cn(
              'font-bold font-mono',
              netCash >= 0 ? 'text-emerald-400' : 'text-rose-400'
            )}>
              {netCash >= 0 ? '+' : ''}{fmt(netCash)}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

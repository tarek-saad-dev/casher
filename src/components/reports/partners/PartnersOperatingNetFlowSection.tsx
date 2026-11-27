'use client';

import type { PartnersMonthlyReportResponse } from '@/lib/types/partners-report';
import { calcRemainingAfterEmployees } from './PartnersEmployeeFlowSection';
import { formatPartnersCurrency, partnersEmployeePaidTotal } from './partnersReportUtils';

interface PartnersOperatingNetFlowSectionProps {
  totals: PartnersMonthlyReportResponse['employeeSummaryTotals'];
  filteredOperatingExpenses: number;
  /** Profit-affecting store income included in remaining after employees. */
  storeOtherBusinessIncome?: number;
  loading: boolean;
}

function FlowSkeleton() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-[1fr_auto_1fr_auto_1.2fr] gap-4 items-stretch animate-pulse">
      <div className="h-24 rounded-xl bg-muted" />
      <div className="hidden md:block w-8" />
      <div className="h-24 rounded-xl bg-muted" />
      <div className="hidden md:block w-8" />
      <div className="h-28 rounded-xl bg-muted" />
    </div>
  );
}

export function calcOperatingNet(
  remainingAfterEmployees: number,
  filteredOperatingExpenses: number
): number {
  const remaining = Number.isFinite(remainingAfterEmployees) ? remainingAfterEmployees : 0;
  const expenses = Number.isFinite(filteredOperatingExpenses) ? filteredOperatingExpenses : 0;
  return Math.round((remaining - expenses) * 100) / 100;
}

export default function PartnersOperatingNetFlowSection({
  totals,
  filteredOperatingExpenses,
  storeOtherBusinessIncome = 0,
  loading,
}: PartnersOperatingNetFlowSectionProps) {
  const remainingAfterEmployees = calcRemainingAfterEmployees(
    totals.totalShopRevenue,
    partnersEmployeePaidTotal(totals),
    storeOtherBusinessIncome,
  );
  const operatingNet = calcOperatingNet(remainingAfterEmployees, filteredOperatingExpenses);
  const isNegative = operatingNet < 0;
  const displayOperatingNet = Math.abs(operatingNet);

  return (
    <section className="w-full min-w-0 bg-card border border-border rounded-xl p-3 sm:p-4 md:p-6 print:break-inside-avoid print:bg-white print:border-zinc-300">
      <h2 className="text-base sm:text-lg font-bold text-foreground print:text-black mb-3 sm:mb-5">
        صافي التشغيل بعد المصروفات
      </h2>

      {loading &&
      remainingAfterEmployees === 0 &&
      filteredOperatingExpenses === 0 ? (
        <FlowSkeleton />
      ) : (
        <div className="operating-net-flow financial-flow flex flex-col md:flex-row md:items-center md:justify-center gap-3 sm:gap-4 md:gap-3 w-full min-w-0">
          <div className="revenue-card flex-1 min-w-0 rounded-xl border border-success/25 bg-success-soft px-3 py-3 sm:px-5 sm:py-4 text-center print:border-emerald-700 print:bg-emerald-50">
            <span className="block text-xs sm:text-sm text-muted-foreground print:text-zinc-600 mb-1.5 sm:mb-2">
              المتبقي بعد الرواتب والسلف
            </span>
            <strong className="text-lg sm:text-xl md:text-2xl font-bold text-success print:text-emerald-700 tabular-nums">
              {formatPartnersCurrency(remainingAfterEmployees)}
            </strong>
          </div>

          <div
            className="operator flex items-center justify-center text-xl sm:text-2xl font-bold text-muted-foreground print:text-zinc-700 md:px-1 shrink-0 py-0.5"
            aria-hidden
          >
            −
          </div>

          <div className="expenses-card flex-1 min-w-0 rounded-xl border border-destructive/25 bg-destructive-soft px-3 py-3 sm:px-5 sm:py-4 text-center print:border-rose-700 print:bg-rose-50">
            <span className="block text-xs sm:text-sm text-muted-foreground print:text-zinc-600 mb-1.5 sm:mb-2">
              مصروفات التشغيل الأخرى
            </span>
            <strong className="text-lg sm:text-xl md:text-2xl font-bold text-destructive print:text-rose-700 tabular-nums">
              {formatPartnersCurrency(filteredOperatingExpenses)}
            </strong>
          </div>

          <div
            className="operator flex items-center justify-center text-xl sm:text-2xl font-bold text-muted-foreground print:text-zinc-700 md:px-1 shrink-0 py-0.5"
            aria-hidden
          >
            =
          </div>

          <div
            className={`result-card flex-[1.2] min-w-0 rounded-xl border px-3 py-4 sm:px-5 sm:py-5 text-center print:border-zinc-400 ${
              isNegative
                ? 'border-destructive/30 bg-destructive-soft print:bg-rose-50'
                : 'border-success/35 bg-success-soft print:bg-emerald-50'
            }`}
          >
            <span className="block text-xs sm:text-sm text-muted-foreground print:text-zinc-600 mb-1.5 sm:mb-2">
              {isNegative
                ? 'عجز التشغيل بعد المصروفات'
                : 'صافي التشغيل بعد المصروفات'}
            </span>
            <strong
              className={`text-xl sm:text-2xl md:text-3xl font-bold tabular-nums ${
                isNegative
                  ? 'text-destructive print:text-rose-700'
                  : 'text-success print:text-emerald-700'
              }`}
            >
              {formatPartnersCurrency(displayOperatingNet)}
            </strong>
            <p className="mt-2 sm:mt-3 text-[11px] sm:text-xs leading-relaxed text-muted-foreground print:text-zinc-600">
              المبلغ المتبقي قبل أي توزيعات أو تسويات أخرى للشركاء
            </p>
          </div>
        </div>
      )}
    </section>
  );
}

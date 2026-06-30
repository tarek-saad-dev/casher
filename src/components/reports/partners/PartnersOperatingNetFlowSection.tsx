'use client';

import type { PartnersMonthlyReportResponse } from '@/lib/types/partners-report';
import { calcRemainingAfterEmployees } from './PartnersEmployeeFlowSection';
import { formatPartnersCurrency } from './partnersReportUtils';

interface PartnersOperatingNetFlowSectionProps {
  totals: PartnersMonthlyReportResponse['employeeSummaryTotals'];
  filteredOperatingExpenses: number;
  loading: boolean;
}

function FlowSkeleton() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-[1fr_auto_1fr_auto_1.2fr] gap-4 items-stretch animate-pulse">
      <div className="h-24 rounded-xl bg-zinc-800/40" />
      <div className="hidden md:block w-8" />
      <div className="h-24 rounded-xl bg-zinc-800/40" />
      <div className="hidden md:block w-8" />
      <div className="h-28 rounded-xl bg-zinc-800/40" />
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
  loading,
}: PartnersOperatingNetFlowSectionProps) {
  const remainingAfterEmployees = calcRemainingAfterEmployees(
    totals.totalShopRevenue,
    totals.totalPaidSalaryAndAdvances
  );
  const operatingNet = calcOperatingNet(remainingAfterEmployees, filteredOperatingExpenses);
  const isNegative = operatingNet < 0;
  const displayOperatingNet = Math.abs(operatingNet);

  return (
    <section className="bg-zinc-900/50 border border-zinc-800/50 rounded-xl p-6 print:break-inside-avoid print:bg-white print:border-zinc-300">
      <h2 className="text-lg font-bold text-white print:text-black mb-5">
        صافي التشغيل بعد المصروفات
      </h2>

      {loading &&
      remainingAfterEmployees === 0 &&
      filteredOperatingExpenses === 0 ? (
        <FlowSkeleton />
      ) : (
        <div className="operating-net-flow financial-flow flex flex-col md:flex-row md:items-center md:justify-center gap-4 md:gap-3">
          <div className="revenue-card flex-1 min-w-0 rounded-xl border border-emerald-500/25 bg-emerald-500/5 px-5 py-4 text-center print:border-emerald-700 print:bg-emerald-50">
            <span className="block text-xs text-zinc-400 print:text-zinc-600 mb-2">
              المتبقي بعد الرواتب والسلف
            </span>
            <strong className="text-xl md:text-2xl font-bold text-emerald-400 print:text-emerald-700">
              {formatPartnersCurrency(remainingAfterEmployees)}
            </strong>
          </div>

          <div
            className="operator flex items-center justify-center text-2xl font-bold text-zinc-500 print:text-zinc-700 md:px-1 shrink-0"
            aria-hidden
          >
            −
          </div>

          <div className="expenses-card flex-1 min-w-0 rounded-xl border border-rose-500/25 bg-rose-500/5 px-5 py-4 text-center print:border-rose-700 print:bg-rose-50">
            <span className="block text-xs text-zinc-400 print:text-zinc-600 mb-2">
              مصروفات التشغيل الأخرى
            </span>
            <strong className="text-xl md:text-2xl font-bold text-rose-400 print:text-rose-700">
              {formatPartnersCurrency(filteredOperatingExpenses)}
            </strong>
          </div>

          <div
            className="operator flex items-center justify-center text-2xl font-bold text-zinc-500 print:text-zinc-700 md:px-1 shrink-0"
            aria-hidden
          >
            =
          </div>

          <div
            className={`result-card flex-[1.2] min-w-0 rounded-xl border px-5 py-5 text-center print:border-zinc-400 ${
              isNegative
                ? 'border-rose-500/30 bg-rose-500/10 print:bg-rose-50'
                : 'border-emerald-500/35 bg-emerald-500/10 print:bg-emerald-50'
            }`}
          >
            <span className="block text-xs text-zinc-400 print:text-zinc-600 mb-2">
              {isNegative
                ? 'عجز التشغيل بعد المصروفات'
                : 'صافي التشغيل بعد المصروفات'}
            </span>
            <strong
              className={`text-2xl md:text-3xl font-bold ${
                isNegative
                  ? 'text-rose-400 print:text-rose-700'
                  : 'text-emerald-400 print:text-emerald-700'
              }`}
            >
              {formatPartnersCurrency(displayOperatingNet)}
            </strong>
            <p className="mt-3 text-[11px] leading-relaxed text-zinc-500 print:text-zinc-600">
              المبلغ المتبقي قبل أي توزيعات أو تسويات أخرى للشركاء
            </p>
          </div>
        </div>
      )}
    </section>
  );
}

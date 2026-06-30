'use client';

import type { PartnersMonthlyReportResponse } from '@/lib/types/partners-report';
import { formatPartnersCurrency } from './partnersReportUtils';

interface PartnersEmployeeFlowSectionProps {
  totals: PartnersMonthlyReportResponse['employeeSummaryTotals'];
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

export function calcRemainingAfterEmployees(
  totalEmployeeActualRevenue: number,
  totalPaidSalaryOrAdvance: number
): number {
  const revenue = Number.isFinite(totalEmployeeActualRevenue) ? totalEmployeeActualRevenue : 0;
  const paid = Number.isFinite(totalPaidSalaryOrAdvance) ? totalPaidSalaryOrAdvance : 0;
  return Math.round((revenue - paid) * 100) / 100;
}

export default function PartnersEmployeeFlowSection({
  totals,
  loading,
}: PartnersEmployeeFlowSectionProps) {
  const totalEmployeeActualRevenue = totals.totalShopRevenue;
  const totalPaidSalaryOrAdvance = totals.totalPaidSalaryAndAdvances;
  const remaining = calcRemainingAfterEmployees(
    totalEmployeeActualRevenue,
    totalPaidSalaryOrAdvance
  );
  const isNegative = remaining < 0;
  const displayRemaining = Math.abs(remaining);

  return (
    <section className="bg-zinc-900/50 border border-zinc-800/50 rounded-xl p-6 print:break-inside-avoid print:bg-white print:border-zinc-300">
      <h2 className="text-lg font-bold text-white print:text-black mb-5">
        صافي إيراد الصنايعية بعد الرواتب والسلف
      </h2>

      {loading && totalEmployeeActualRevenue === 0 && totalPaidSalaryOrAdvance === 0 ? (
        <FlowSkeleton />
      ) : (
        <div className="financial-flow flex flex-col md:flex-row md:items-center md:justify-center gap-4 md:gap-3">
          {/* Revenue */}
          <div className="flex-1 min-w-0 rounded-xl border border-emerald-500/25 bg-emerald-500/5 px-5 py-4 text-center print:border-emerald-700 print:bg-emerald-50">
            <span className="block text-xs text-zinc-400 print:text-zinc-600 mb-2">
              إيراد الصنايعية الفعلي
            </span>
            <strong className="text-xl md:text-2xl font-bold text-emerald-400 print:text-emerald-700">
              {formatPartnersCurrency(totalEmployeeActualRevenue)}
            </strong>
          </div>

          <div
            className="operator flex items-center justify-center text-2xl font-bold text-zinc-500 print:text-zinc-700 md:px-1 shrink-0"
            aria-hidden
          >
            −
          </div>

          {/* Payroll */}
          <div className="flex-1 min-w-0 rounded-xl border border-amber-500/25 bg-amber-500/5 px-5 py-4 text-center print:border-amber-700 print:bg-amber-50">
            <span className="block text-xs text-zinc-400 print:text-zinc-600 mb-2">
              الرواتب والسلف المدفوعة
            </span>
            <strong className="text-xl md:text-2xl font-bold text-amber-400 print:text-amber-700">
              {formatPartnersCurrency(totalPaidSalaryOrAdvance)}
            </strong>
          </div>

          <div
            className="operator flex items-center justify-center text-2xl font-bold text-zinc-500 print:text-zinc-700 md:px-1 shrink-0"
            aria-hidden
          >
            =
          </div>

          {/* Result */}
          <div
            className={`flex-[1.2] min-w-0 rounded-xl border px-5 py-5 text-center print:border-zinc-400 ${
              isNegative
                ? 'border-rose-500/30 bg-rose-500/10 print:bg-rose-50'
                : 'border-emerald-500/35 bg-emerald-500/10 print:bg-emerald-50'
            }`}
          >
            <span className="block text-xs text-zinc-400 print:text-zinc-600 mb-2">
              {isNegative ? 'عجز بعد الرواتب والسلف' : 'المتبقي بعد الرواتب والسلف'}
            </span>
            <strong
              className={`text-2xl md:text-3xl font-bold ${
                isNegative
                  ? 'text-rose-400 print:text-rose-700'
                  : 'text-emerald-400 print:text-emerald-700'
              }`}
            >
              {formatPartnersCurrency(displayRemaining)}
            </strong>
            <p className="mt-3 text-[11px] leading-relaxed text-zinc-500 print:text-zinc-600">
              المبلغ المتبقي قبل خصم باقي مصروفات التشغيل
            </p>
          </div>
        </div>
      )}
    </section>
  );
}

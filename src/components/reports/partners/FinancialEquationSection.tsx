'use client';

import type { PartnersMonthlyReportResponse } from '@/lib/types/partners-report';
import { formatPartnersCurrency } from './partnersReportUtils';

interface FinancialEquationSectionProps {
  summary: PartnersMonthlyReportResponse['summary'];
}

export default function FinancialEquationSection({ summary }: FinancialEquationSectionProps) {
  const netClass =
    summary.operatingNet > 0 ? 'text-emerald-400' :
    summary.operatingNet < 0 ? 'text-rose-400' :
    'text-zinc-300';

  return (
    <section className="bg-zinc-900/50 border border-zinc-800/50 rounded-xl p-6 print:break-inside-avoid print:bg-white print:border-zinc-300">
      <h2 className="text-lg font-bold text-white mb-6 print:text-black">المعادلة المالية الشهرية</h2>

      <div className="max-w-xl mx-auto space-y-4 font-mono text-sm">
        <div className="flex items-center justify-between gap-4 border-b border-zinc-800 pb-3 print:border-zinc-300">
          <span className="text-zinc-300 print:text-black">إجمالي الإيرادات</span>
          <span className="text-emerald-400 font-bold print:text-black">
            {formatPartnersCurrency(summary.totalRevenue)}
          </span>
        </div>

        <div className="flex items-center justify-between gap-4 border-b border-zinc-800 pb-3 print:border-zinc-300">
          <span className="text-zinc-300 print:text-black">− إجمالي المصروفات</span>
          <span className="text-rose-400 font-bold print:text-black">
            {formatPartnersCurrency(summary.totalExpenses)}
          </span>
        </div>

        {!summary.advancesIncludedInExpenses && (
          <div className="flex items-center justify-between gap-4 border-b border-zinc-800 pb-3 print:border-zinc-300">
            <span className="text-zinc-300 print:text-black">− سلف الموظفين</span>
            <span className="text-amber-400 font-bold print:text-black">
              {formatPartnersCurrency(summary.totalEmployeeAdvances)}
            </span>
          </div>
        )}

        {summary.advancesIncludedInExpenses && (
          <p className="text-xs text-zinc-500 print:text-zinc-600">
            السلف مدرجة بالفعل ضمن إجمالي المصروفات — لا تُخصم مرة أخرى
          </p>
        )}

        <div className="flex items-center justify-between gap-4 pt-2">
          <span className="text-white font-bold text-base print:text-black">= صافي التشغيل</span>
          <span className={`text-2xl font-bold ${netClass} print:text-black`}>
            {formatPartnersCurrency(summary.operatingNet)}
          </span>
        </div>
      </div>
    </section>
  );
}

'use client';

import type { PartnersMonthlyReportResponse } from '@/lib/types/partners-report';
import { formatPartnersCurrency } from './partnersReportUtils';

interface PartnersEmployeesSectionProps {
  rows: PartnersMonthlyReportResponse['employeeSummary'];
  totals: PartnersMonthlyReportResponse['employeeSummaryTotals'];
  loading: boolean;
}

function TableSkeleton() {
  return (
    <div className="space-y-3">
      {[...Array(5)].map((_, i) => (
        <div key={i} className="h-16 sm:h-10 bg-zinc-800/40 rounded animate-pulse" />
      ))}
    </div>
  );
}

function MobileValueRow({
  label,
  value,
  valueClassName = 'text-white',
}: {
  label: string;
  value: React.ReactNode;
  valueClassName?: string;
}) {
  return (
    <div className="flex items-start justify-between gap-3 min-w-0">
      <span className="text-sm text-zinc-400 shrink-0">{label}</span>
      <span className={`text-base font-medium tabular-nums text-left break-words ${valueClassName}`}>
        {value}
      </span>
    </div>
  );
}

function formatOrDash(n: number, className: string) {
  if (!(n > 0)) return <span className="text-zinc-500">—</span>;
  return <span className={className}>{formatPartnersCurrency(n)}</span>;
}

export default function PartnersEmployeesSection({
  rows,
  totals,
  loading,
}: PartnersEmployeesSectionProps) {
  return (
    <section className="w-full min-w-0 bg-zinc-900/50 border border-zinc-800/50 rounded-xl p-3 sm:p-4 md:p-6 print:break-inside-avoid">
      <h2 className="text-base sm:text-lg font-bold text-white mb-1 sm:mb-2">الموظفون</h2>
      <p className="text-xs text-zinc-500 mb-3 sm:mb-4">
        السلف = المسحوب نقدًا من الخزنة. التسوية = إعادة توزيع دفترية بين الفروع (بدون إيراد مبيعات).
        المديونية = ما تبقّى بعد الراتب والتارجت والتمويل والتسويات الواردة.
      </p>

      {loading && rows.length === 0 ? (
        <TableSkeleton />
      ) : rows.length === 0 ? (
        <div className="text-center py-8 sm:py-10 text-sm sm:text-base text-zinc-500 px-2">
          لا توجد بيانات موظفين في الشهر المحدد
        </div>
      ) : (
        <>
          <div className="md:hidden print:hidden space-y-3">
            {rows.map((row) => (
              <article
                key={row.employeeId}
                className="w-full min-w-0 rounded-lg border border-zinc-800/70 bg-zinc-950/40 p-3 sm:p-4 space-y-3"
              >
                <h3 className="text-base font-bold text-white break-words border-b border-zinc-800/60 pb-2">
                  {row.employeeName}
                </h3>
                <MobileValueRow
                  label="استلم راتب (راتب + تارجت)"
                  value={
                    <span className="flex flex-col items-end gap-0.5">
                      <span>{formatPartnersCurrency(row.salaryAndTarget)}</span>
                      <span className="text-[11px] font-normal text-zinc-500">
                        راتب {formatPartnersCurrency(row.ledgerSalary)} + تارجت{' '}
                        {formatPartnersCurrency(row.ledgerTarget)}
                      </span>
                    </span>
                  }
                  valueClassName="text-amber-400"
                />
                <MobileValueRow
                  label="سلف مسحوبة"
                  value={formatOrDash(row.advanceDebits, 'text-zinc-200')}
                />
                <MobileValueRow
                  label="تسوية واردة / صادرة"
                  value={
                    <span className="flex flex-col items-end gap-0.5 text-sm">
                      <span className="text-sky-300">
                        وارد {formatPartnersCurrency(row.settlementCredits)}
                      </span>
                      <span className="text-zinc-400">
                        صادر {formatPartnersCurrency(row.settlementDebits)}
                      </span>
                    </span>
                  }
                />
                <MobileValueRow
                  label="مديونية متبقية"
                  value={formatOrDash(row.advanceExcess, 'text-rose-400')}
                  valueClassName="text-rose-400"
                />
              </article>
            ))}

            <article className="w-full min-w-0 rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3 sm:p-4 space-y-3">
              <h3 className="text-base font-bold text-white">الإجمالي</h3>
              <MobileValueRow
                label="إجمالي استلم راتب (راتب + تارجت)"
                value={formatPartnersCurrency(totals.totalSalaryAndTarget ?? 0)}
                valueClassName="text-amber-400"
              />
              <MobileValueRow
                label="إجمالي المديونية المتبقية"
                value={formatPartnersCurrency(totals.totalAdvanceExcess ?? 0)}
                valueClassName="text-rose-400"
              />
            </article>
          </div>

          <div className="hidden md:block print:block overflow-x-auto">
            <table className="w-full text-sm min-w-[640px]">
              <thead>
                <tr className="border-b border-zinc-800 text-zinc-400 print:border-zinc-300 print:text-zinc-600">
                  <th className="text-right py-3 px-2 font-medium">الموظف</th>
                  <th className="text-right py-3 px-2 font-medium">استلم راتب (راتب + تارجت)</th>
                  <th className="text-right py-3 px-2 font-medium" title="سلف نقدية مسجّلة في الدفتر">
                    سلف مسحوبة
                  </th>
                  <th className="text-right py-3 px-2 font-medium" title="تسوية بين الفروع — دفترية وليست إيراد مبيعات">
                    تسوية واردة / صادرة
                  </th>
                  <th
                    className="text-right py-3 px-2 font-medium"
                    title="ما زاد عن الراتب + التارجت + التمويل + التسوية الواردة"
                  >
                    مديونية متبقية
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr
                    key={row.employeeId}
                    className="border-b border-zinc-800/60 hover:bg-zinc-800/30 print:break-inside-avoid print:border-zinc-300"
                  >
                    <td className="py-3 px-2 text-white font-medium break-words">
                      {row.employeeName}
                    </td>
                    <td className="py-3 px-2 tabular-nums">
                      <span className="block text-amber-400 font-medium">
                        {formatPartnersCurrency(row.salaryAndTarget)}
                      </span>
                      <span className="block text-[10px] text-zinc-500 font-normal print:text-zinc-600">
                        راتب {formatPartnersCurrency(row.ledgerSalary)} + تارجت{' '}
                        {formatPartnersCurrency(row.ledgerTarget)}
                      </span>
                    </td>
                    <td className="py-3 px-2 tabular-nums text-zinc-200">
                      {formatOrDash(row.advanceDebits, 'text-zinc-200 font-medium')}
                    </td>
                    <td className="py-3 px-2 tabular-nums text-sm">
                      <span className="block text-sky-300">
                        وارد {formatPartnersCurrency(row.settlementCredits)}
                      </span>
                      <span className="block text-zinc-500">
                        صادر {formatPartnersCurrency(row.settlementDebits)}
                      </span>
                    </td>
                    <td className="py-3 px-2 tabular-nums">
                      {row.advanceExcess > 0 ? (
                        <span className="text-rose-400 font-medium print:text-rose-700">
                          {formatPartnersCurrency(row.advanceExcess)}
                        </span>
                      ) : (
                        <span className="text-zinc-500">—</span>
                      )}
                    </td>
                  </tr>
                ))}
                <tr className="bg-zinc-800/40 font-bold print:break-inside-avoid print:bg-zinc-100">
                  <td className="py-3 px-2 text-white print:text-black">الإجمالي</td>
                  <td className="py-3 px-2 tabular-nums">
                    <span className="block text-[10px] text-zinc-500 font-normal print:text-zinc-600 mb-0.5">
                      إجمالي استلم راتب (راتب + تارجت)
                    </span>
                    <span className="text-amber-400 print:text-amber-700">
                      {formatPartnersCurrency(totals.totalSalaryAndTarget ?? 0)}
                    </span>
                  </td>
                  <td className="py-3 px-2 text-zinc-500">—</td>
                  <td className="py-3 px-2 text-zinc-500">—</td>
                  <td className="py-3 px-2 tabular-nums">
                    <span className="block text-[10px] text-zinc-500 font-normal print:text-zinc-600 mb-0.5">
                      إجمالي المديونية المتبقية
                    </span>
                    <span className="text-rose-400 print:text-rose-700">
                      {formatPartnersCurrency(totals.totalAdvanceExcess ?? 0)}
                    </span>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}

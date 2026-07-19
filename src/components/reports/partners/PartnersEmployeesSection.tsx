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

export default function PartnersEmployeesSection({
  rows,
  totals,
  loading,
}: PartnersEmployeesSectionProps) {
  return (
    <section className="w-full min-w-0 bg-zinc-900/50 border border-zinc-800/50 rounded-xl p-3 sm:p-4 md:p-6 print:break-inside-avoid">
      <h2 className="text-base sm:text-lg font-bold text-white mb-3 sm:mb-4">الموظفون</h2>

      {loading && rows.length === 0 ? (
        <TableSkeleton />
      ) : rows.length === 0 ? (
        <div className="text-center py-8 sm:py-10 text-sm sm:text-base text-zinc-500 px-2">
          لا توجد بيانات موظفين في الشهر المحدد
        </div>
      ) : (
        <>
          {/* Mobile: employee cards */}
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
                  label="دخل للمحل"
                  value={
                    row.shopRevenue == null ? (
                      <span className="text-zinc-500">—</span>
                    ) : (
                      formatPartnersCurrency(row.shopRevenue)
                    )
                  }
                />
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
                  label="سلف"
                  value={
                    row.advanceExcess > 0 ? (
                      formatPartnersCurrency(row.advanceExcess)
                    ) : (
                      <span className="text-zinc-500">—</span>
                    )
                  }
                  valueClassName="text-rose-400"
                />
              </article>
            ))}

            <article className="w-full min-w-0 rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3 sm:p-4 space-y-3">
              <h3 className="text-base font-bold text-white">الإجمالي</h3>
              <MobileValueRow
                label="إجمالي الإيراد الفعلي للصنايعية"
                value={formatPartnersCurrency(totals.totalShopRevenue)}
                valueClassName="text-emerald-400"
              />
              <MobileValueRow
                label="إجمالي استلم راتب (راتب + تارجت)"
                value={formatPartnersCurrency(totals.totalSalaryAndTarget ?? 0)}
                valueClassName="text-amber-400"
              />
              <MobileValueRow
                label="إجمالي السلف"
                value={formatPartnersCurrency(totals.totalAdvanceExcess ?? 0)}
                valueClassName="text-rose-400"
              />
            </article>
          </div>

          {/* Desktop + print: table */}
          <div className="hidden md:block print:block">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-800 text-zinc-400 print:border-zinc-300 print:text-zinc-600">
                  <th className="text-right py-3 px-2 font-medium">الموظف</th>
                  <th className="text-right py-3 px-2 font-medium">دخل للمحل</th>
                  <th className="text-right py-3 px-2 font-medium">استلم راتب (راتب + تارجت)</th>
                  <th className="text-right py-3 px-2 font-medium">سلف</th>
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
                      {row.shopRevenue == null ? (
                        <span className="text-zinc-500">—</span>
                      ) : (
                        <span className="text-white font-medium">
                          {formatPartnersCurrency(row.shopRevenue)}
                        </span>
                      )}
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
                      إجمالي الإيراد الفعلي للصنايعية
                    </span>
                    <span className="text-emerald-400 print:text-emerald-700">
                      {formatPartnersCurrency(totals.totalShopRevenue)}
                    </span>
                  </td>
                  <td className="py-3 px-2 tabular-nums">
                    <span className="block text-[10px] text-zinc-500 font-normal print:text-zinc-600 mb-0.5">
                      إجمالي استلم راتب (راتب + تارجت)
                    </span>
                    <span className="text-amber-400 print:text-amber-700">
                      {formatPartnersCurrency(totals.totalSalaryAndTarget ?? 0)}
                    </span>
                  </td>
                  <td className="py-3 px-2 tabular-nums">
                    <span className="block text-[10px] text-zinc-500 font-normal print:text-zinc-600 mb-0.5">
                      إجمالي السلف
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

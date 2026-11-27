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
        <div key={i} className="h-16 sm:h-10 bg-muted rounded animate-pulse" />
      ))}
    </div>
  );
}

function MobileValueRow({
  label,
  value,
  valueClassName = 'text-foreground',
}: {
  label: string;
  value: React.ReactNode;
  valueClassName?: string;
}) {
  return (
    <div className="flex items-start justify-between gap-3 min-w-0">
      <span className="text-sm text-muted-foreground shrink-0">{label}</span>
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
    <section className="w-full min-w-0 bg-card border border-border rounded-xl p-3 sm:p-4 md:p-6 print:break-inside-avoid">
      <h2 className="text-base sm:text-lg font-bold text-foreground mb-1 sm:mb-2">الموظفون</h2>
      <p className="text-xs text-muted-foreground mb-3 sm:mb-4">
        استلم راتب = استحقاق الدفتر فقط (راتب + تارجت). سلف = السحب الزائد بعد خصم الاستحقاق والتمويل والتسوية بين الفروع — التسوية لا تزيد الراتب.
      </p>

      {loading && rows.length === 0 ? (
        <TableSkeleton />
      ) : rows.length === 0 ? (
        <div className="text-center py-8 sm:py-10 text-sm sm:text-base text-muted-foreground px-2">
          لا توجد بيانات موظفين في الشهر المحدد
        </div>
      ) : (
        <>
          {/* Mobile: employee cards */}
          <div className="md:hidden print:hidden space-y-3">
            {rows.map((row) => (
              <article
                key={row.employeeId}
                className="w-full min-w-0 rounded-lg border border-border bg-background p-3 sm:p-4 space-y-3"
              >
                <h3 className="text-base font-bold text-foreground break-words border-b border-border pb-2">
                  {row.employeeName}
                </h3>
                <MobileValueRow
                  label="استلم راتب (راتب + تارجت)"
                  value={
                    <span className="flex flex-col items-end gap-0.5">
                      <span>{formatPartnersCurrency(row.salaryAndTarget)}</span>
                      <span className="text-[11px] font-normal text-muted-foreground">
                        راتب {formatPartnersCurrency(row.ledgerSalary)} + تارجت{' '}
                        {formatPartnersCurrency(row.ledgerTarget)}
                      </span>
                    </span>
                  }
                  valueClassName="text-warning"
                />
                <MobileValueRow
                  label="سلف"
                  value={
                    row.advanceExcess > 0 ? (
                      formatPartnersCurrency(row.advanceExcess)
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )
                  }
                  valueClassName="text-destructive"
                />
              </article>
            ))}

            <article className="w-full min-w-0 rounded-lg border border-success/30 bg-success-soft p-3 sm:p-4 space-y-3">
              <h3 className="text-base font-bold text-foreground">الإجمالي</h3>
              <MobileValueRow
                label="إجمالي استلم راتب (راتب + تارجت)"
                value={formatPartnersCurrency(totals.totalSalaryAndTarget ?? 0)}
                valueClassName="text-warning"
              />
              <MobileValueRow
                label="إجمالي السلف"
                value={formatPartnersCurrency(totals.totalAdvanceExcess ?? 0)}
                valueClassName="text-destructive"
              />
            </article>
          </div>

          {/* Desktop + print: table */}
          <div className="hidden md:block print:block">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-muted-foreground print:border-zinc-300 print:text-zinc-600">
                  <th className="text-right py-3 px-2 font-medium">الموظف</th>
                  <th className="text-right py-3 px-2 font-medium">استلم راتب (راتب + تارجت)</th>
                  <th
                    className="text-right py-3 px-2 font-medium"
                    title="ما زاد عن الراتب + التارجت + التمويل بعد خصم التسوية بين الفروع"
                  >
                    سلف
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr
                    key={row.employeeId}
                    className="border-b border-border hover:bg-surface-muted print:break-inside-avoid print:border-zinc-300"
                  >
                    <td className="py-3 px-2 text-foreground font-medium break-words">
                      {row.employeeName}
                    </td>
                    <td className="py-3 px-2 tabular-nums">
                      <span className="block text-warning font-medium">
                        {formatPartnersCurrency(row.salaryAndTarget)}
                      </span>
                      <span className="block text-[10px] text-muted-foreground font-normal print:text-zinc-600">
                        راتب {formatPartnersCurrency(row.ledgerSalary)} + تارجت{' '}
                        {formatPartnersCurrency(row.ledgerTarget)}
                      </span>
                    </td>
                    <td className="py-3 px-2 tabular-nums">
                      {row.advanceExcess > 0 ? (
                        <span className="text-destructive font-medium print:text-rose-700">
                          {formatPartnersCurrency(row.advanceExcess)}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                  </tr>
                ))}
                <tr className="bg-muted font-bold print:break-inside-avoid print:bg-zinc-100">
                  <td className="py-3 px-2 text-foreground print:text-black">الإجمالي</td>
                  <td className="py-3 px-2 tabular-nums">
                    <span className="block text-[10px] text-muted-foreground font-normal print:text-zinc-600 mb-0.5">
                      إجمالي استلم راتب (راتب + تارجت)
                    </span>
                    <span className="text-warning print:text-amber-700">
                      {formatPartnersCurrency(totals.totalSalaryAndTarget ?? 0)}
                    </span>
                  </td>
                  <td className="py-3 px-2 tabular-nums">
                    <span className="block text-[10px] text-muted-foreground font-normal print:text-zinc-600 mb-0.5">
                      إجمالي السلف
                    </span>
                    <span className="text-destructive print:text-rose-700">
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

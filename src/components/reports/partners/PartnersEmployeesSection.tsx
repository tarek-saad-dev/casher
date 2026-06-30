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
        <div key={i} className="h-10 bg-zinc-800/40 rounded animate-pulse" />
      ))}
    </div>
  );
}

export default function PartnersEmployeesSection({
  rows,
  totals,
  loading,
}: PartnersEmployeesSectionProps) {
  return (
    <section className="bg-zinc-900/50 border border-zinc-800/50 rounded-xl p-6 print:break-inside-avoid">
      <h2 className="text-lg font-bold text-white mb-4">الموظفون</h2>

      {loading && rows.length === 0 ? (
        <TableSkeleton />
      ) : rows.length === 0 ? (
        <div className="text-center py-10 text-zinc-500">
          لا توجد بيانات موظفين في الشهر المحدد
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[480px]">
            <thead>
              <tr className="border-b border-zinc-800 text-zinc-400">
                <th className="text-right py-3 px-2 font-medium whitespace-nowrap">الموظف</th>
                <th className="text-right py-3 px-2 font-medium whitespace-nowrap">دخل للمحل</th>
                <th className="text-right py-3 px-2 font-medium whitespace-nowrap">استلم راتب / سلف</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr
                  key={row.employeeId}
                  className="border-b border-zinc-800/60 hover:bg-zinc-800/30 print:break-inside-avoid"
                >
                  <td className="py-3 px-2 text-white font-medium whitespace-nowrap">
                    {row.employeeName}
                  </td>
                  <td className="py-3 px-2 whitespace-nowrap">
                    {row.shopRevenue == null ? (
                      <span className="text-zinc-500">—</span>
                    ) : (
                      <span className="text-white font-medium">
                        {formatPartnersCurrency(row.shopRevenue)}
                      </span>
                    )}
                  </td>
                  <td className="py-3 px-2 text-amber-400 font-medium whitespace-nowrap">
                    {formatPartnersCurrency(row.paidSalaryAndAdvances)}
                  </td>
                </tr>
              ))}
              <tr className="bg-zinc-800/40 font-bold print:break-inside-avoid">
                <td className="py-3 px-2 text-white whitespace-nowrap">الإجمالي</td>
                <td className="py-3 px-2 whitespace-nowrap">
                  <span className="block text-[10px] text-zinc-500 font-normal print:text-zinc-600 mb-0.5">
                    إجمالي الإيراد الفعلي للصنايعية
                  </span>
                  <span className="text-emerald-400">
                    {formatPartnersCurrency(totals.totalShopRevenue)}
                  </span>
                </td>
                <td className="py-3 px-2 whitespace-nowrap">
                  <span className="block text-[10px] text-zinc-500 font-normal print:text-zinc-600 mb-0.5">
                    إجمالي الرواتب والسلف المدفوعة
                  </span>
                  <span className="text-amber-400">
                    {formatPartnersCurrency(totals.totalPaidSalaryAndAdvances)}
                  </span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

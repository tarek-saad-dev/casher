'use client';

import type { PartnersMonthlyReportResponse } from '@/lib/types/partners-report';
import { formatPartnersCurrency, formatPartnersPercent } from './partnersReportUtils';

interface RevenueDetailsSectionProps {
  rows: PartnersMonthlyReportResponse['revenueDetails'];
  totalRevenue: number;
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

export default function RevenueDetailsSection({
  rows,
  totalRevenue,
  loading,
}: RevenueDetailsSectionProps) {
  return (
    <section className="bg-zinc-900/50 border border-zinc-800/50 rounded-xl p-6 print:break-inside-avoid">
      <h2 className="text-lg font-bold text-white mb-4">تفاصيل الإيرادات</h2>

      {loading && rows.length === 0 ? (
        <TableSkeleton />
      ) : rows.length === 0 ? (
        <div className="text-center py-10 text-zinc-500">
          لا توجد إيرادات في الشهر المحدد
        </div>
      ) : (
        <>
          {rows.length > 0 && (
            <div className="mb-6 print:hidden">
              <p className="text-xs text-zinc-500 mb-3">توزيع الإيرادات حسب الموظف</p>
              <div className="space-y-2">
                {rows.slice(0, 8).map((row) => (
                  <div key={row.employeeId ?? row.employeeName} className="flex items-center gap-3">
                    <span className="text-sm text-zinc-300 w-32 truncate shrink-0">{row.employeeName}</span>
                    <div className="flex-1 bg-zinc-800 rounded-full h-2 overflow-hidden">
                      <div
                        className="h-full bg-emerald-500/80 transition-all"
                        style={{ width: `${Math.min(row.percentage, 100)}%` }}
                      />
                    </div>
                    <span className="text-xs text-zinc-400 w-12 text-left shrink-0">
                      {formatPartnersPercent(row.percentage)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-800 text-zinc-400">
                  <th className="text-right py-3 px-2 font-medium">الموظف</th>
                  <th className="text-right py-3 px-2 font-medium">إيراد الخدمات</th>
                  <th className="text-right py-3 px-2 font-medium">إجمالي الإيراد</th>
                  <th className="text-right py-3 px-2 font-medium">عدد الخدمات</th>
                  <th className="text-right py-3 px-2 font-medium">عدد الفواتير</th>
                  <th className="text-right py-3 px-2 font-medium">النسبة</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr
                    key={row.employeeId ?? row.employeeName}
                    className="border-b border-zinc-800/60 hover:bg-zinc-800/30 print:break-inside-avoid"
                  >
                    <td className="py-3 px-2 text-white font-medium">{row.employeeName}</td>
                    <td className="py-3 px-2 text-emerald-400">{formatPartnersCurrency(row.serviceRevenue)}</td>
                    <td className="py-3 px-2 text-emerald-400 font-bold">{formatPartnersCurrency(row.totalRevenue)}</td>
                    <td className="py-3 px-2 text-zinc-400">{row.transactionCount ?? 0}</td>
                    <td className="py-3 px-2 text-zinc-400">{row.invoiceCount ?? 0}</td>
                    <td className="py-3 px-2 text-zinc-400">{formatPartnersPercent(row.percentage)}</td>
                  </tr>
                ))}
                <tr className="bg-zinc-800/40 font-bold print:break-inside-avoid">
                  <td className="py-3 px-2 text-white">الإجمالي</td>
                  <td className="py-3 px-2 text-emerald-400">{formatPartnersCurrency(totalRevenue)}</td>
                  <td className="py-3 px-2 text-emerald-400">{formatPartnersCurrency(totalRevenue)}</td>
                  <td className="py-3 px-2 text-zinc-300">
                    {rows.reduce((sum, r) => sum + (r.transactionCount ?? 0), 0)}
                  </td>
                  <td className="py-3 px-2 text-zinc-300">—</td>
                  <td className="py-3 px-2 text-zinc-300">100%</td>
                </tr>
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}

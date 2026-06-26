'use client';

import type { PartnersMonthlyReportResponse } from '@/lib/types/partners-report';
import { formatPartnersCurrency, formatPartnersPercent } from './partnersReportUtils';

interface PartnersEmployeeAdvancesSectionProps {
  rows: PartnersMonthlyReportResponse['employeeAdvances'];
  totalAdvances: number;
  loading: boolean;
}

function TableSkeleton() {
  return (
    <div className="space-y-3">
      {[...Array(4)].map((_, i) => (
        <div key={i} className="h-10 bg-zinc-800/40 rounded animate-pulse" />
      ))}
    </div>
  );
}

export default function PartnersEmployeeAdvancesSection({
  rows,
  totalAdvances,
  loading,
}: PartnersEmployeeAdvancesSectionProps) {
  return (
    <section className="bg-zinc-900/50 border border-zinc-800/50 rounded-xl p-6 print:break-inside-avoid">
      <h2 className="text-lg font-bold text-white mb-4">المرتبات وسلف الموظفين</h2>

      <div className="mb-6 rounded-xl border border-amber-500/20 bg-amber-500/5 p-4">
        <p className="text-xs text-zinc-400 mb-1">إجمالي السلف خلال الشهر</p>
        <p className="text-2xl font-bold text-amber-400">
          {loading && rows.length === 0 ? '...' : formatPartnersCurrency(totalAdvances)}
        </p>
      </div>

      {loading && rows.length === 0 ? (
        <TableSkeleton />
      ) : rows.length === 0 ? (
        <div className="text-center py-10 text-zinc-500">
          لا توجد سلف موظفين في الشهر المحدد
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-800 text-zinc-400">
                <th className="text-right py-3 px-2 font-medium">الموظف</th>
                <th className="text-right py-3 px-2 font-medium">إجمالي السلف</th>
                <th className="text-right py-3 px-2 font-medium">عدد المعاملات</th>
                <th className="text-right py-3 px-2 font-medium">النسبة</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr
                  key={row.employeeId}
                  className="border-b border-zinc-800/60 hover:bg-zinc-800/30 print:break-inside-avoid"
                >
                  <td className="py-3 px-2 text-white font-medium">{row.employeeName}</td>
                  <td className="py-3 px-2 text-amber-400 font-bold">{formatPartnersCurrency(row.totalAdvance)}</td>
                  <td className="py-3 px-2 text-zinc-400">{row.transactionCount ?? 0}</td>
                  <td className="py-3 px-2 text-zinc-400">{formatPartnersPercent(row.percentage)}</td>
                </tr>
              ))}
              <tr className="bg-zinc-800/40 font-bold print:break-inside-avoid">
                <td className="py-3 px-2 text-white">الإجمالي</td>
                <td className="py-3 px-2 text-amber-400">{formatPartnersCurrency(totalAdvances)}</td>
                <td className="py-3 px-2 text-zinc-300">
                  {rows.reduce((sum, r) => sum + (r.transactionCount ?? 0), 0)}
                </td>
                <td className="py-3 px-2 text-zinc-300">100%</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

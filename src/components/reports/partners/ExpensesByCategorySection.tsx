'use client';

import { AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { PartnersMonthlyReportResponse } from '@/lib/types/partners-report';
import { formatPartnersCurrency, formatPartnersPercent } from './partnersReportUtils';

interface ExpensesByCategorySectionProps {
  rows: PartnersMonthlyReportResponse['expensesByCategory'];
  totalExpenses: number;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
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

export default function ExpensesByCategorySection({
  rows,
  totalExpenses,
  loading,
  error,
  onRetry,
}: ExpensesByCategorySectionProps) {
  return (
    <section className="bg-zinc-900/50 border border-zinc-800/50 rounded-xl p-6 print:break-inside-avoid">
      <h2 className="text-lg font-bold text-white mb-4">المصروفات حسب الفئة</h2>

      {error ? (
        <div className="flex flex-col items-center gap-4 py-8">
          <div className="flex items-center gap-2 text-rose-400">
            <AlertCircle className="h-5 w-5" />
            <span>{error}</span>
          </div>
          <Button
            type="button"
            variant="outline"
            onClick={onRetry}
            className="print:hidden border-zinc-700"
          >
            إعادة المحاولة
          </Button>
        </div>
      ) : loading && rows.length === 0 ? (
        <TableSkeleton />
      ) : rows.length === 0 ? (
        <div className="text-center py-10 text-zinc-500">
          لا توجد مصروفات في الشهر المحدد
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-800 text-zinc-400">
                <th className="text-right py-3 px-2 font-medium">الفئة</th>
                <th className="text-right py-3 px-2 font-medium">عدد المعاملات</th>
                <th className="text-right py-3 px-2 font-medium">المبلغ</th>
                <th className="text-right py-3 px-2 font-medium">النسبة</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr
                  key={row.categoryId ?? row.categoryName}
                  className="border-b border-zinc-800/60 hover:bg-zinc-800/30 print:break-inside-avoid"
                >
                  <td className="py-3 px-2 text-white font-medium">{row.categoryName}</td>
                  <td className="py-3 px-2 text-zinc-400">{row.transactionCount}</td>
                  <td className="py-3 px-2 text-rose-400 font-bold">{formatPartnersCurrency(row.totalAmount)}</td>
                  <td className="py-3 px-2">
                    <div className="flex items-center gap-2">
                      <div className="flex-1 bg-zinc-800 rounded-full h-2 overflow-hidden print:hidden">
                        <div
                          className="h-full bg-rose-500/80"
                          style={{ width: `${Math.min(row.percentage, 100)}%` }}
                        />
                      </div>
                      <span className="text-zinc-400 min-w-[3rem]">{formatPartnersPercent(row.percentage)}</span>
                    </div>
                  </td>
                </tr>
              ))}
              <tr className="bg-zinc-800/40 font-bold print:break-inside-avoid">
                <td className="py-3 px-2 text-white">الإجمالي</td>
                <td className="py-3 px-2 text-zinc-300">
                  {rows.reduce((sum, r) => sum + r.transactionCount, 0)}
                </td>
                <td className="py-3 px-2 text-rose-400">{formatPartnersCurrency(totalExpenses)}</td>
                <td className="py-3 px-2 text-zinc-300">100%</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

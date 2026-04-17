'use client';

import type { DailyTrend } from '@/lib/types';
import { AlertCircle } from 'lucide-react';

interface ExpenseDailyTrendProps {
  dailyTrend: DailyTrend[];
  highestDay: { invDate: string; Amount: number } | null;
  loading: boolean;
}

export default function ExpenseDailyTrend({
  dailyTrend,
  highestDay,
  loading,
}: ExpenseDailyTrendProps) {
  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('ar-EG', {
      style: 'decimal',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount) + ' ج.م';
  };

  if (loading) {
    return (
      <div className="bg-card border border-border rounded-lg p-6">
        <h3 className="text-lg font-semibold mb-4">الاتجاه اليومي</h3>
        <div className="space-y-2">
          {[...Array(10)].map((_, i) => (
            <div key={i} className="h-8 bg-muted rounded animate-pulse"></div>
          ))}
        </div>
      </div>
    );
  }

  if (dailyTrend.length === 0) {
    return (
      <div className="bg-card border border-border rounded-lg p-6">
        <h3 className="text-lg font-semibold mb-4">الاتجاه اليومي</h3>
        <div className="text-center py-8 text-muted-foreground">
          لا توجد بيانات للعرض
        </div>
      </div>
    );
  }

  const maxAmount = Math.max(...dailyTrend.map((d) => d.Amount));

  return (
    <div className="bg-card border border-border rounded-lg p-6">
      <h3 className="text-lg font-semibold mb-4">الاتجاه اليومي</h3>
      
      <div className="overflow-x-auto max-h-96 overflow-y-auto">
        <table className="w-full">
          <thead className="sticky top-0 bg-card">
            <tr className="border-b border-border">
              <th className="text-right py-2 px-2 text-sm font-medium text-muted-foreground">التاريخ</th>
              <th className="text-right py-2 px-2 text-sm font-medium text-muted-foreground">المبلغ</th>
              <th className="text-right py-2 px-2 text-sm font-medium text-muted-foreground">العدد</th>
              <th className="text-right py-2 px-2 text-sm font-medium text-muted-foreground">الاتجاه</th>
            </tr>
          </thead>
          <tbody>
            {dailyTrend.map((day) => {
              const isHighest = highestDay?.invDate === day.invDate;
              const barWidth = maxAmount > 0 ? (day.Amount / maxAmount) * 100 : 0;
              const hasData = day.Amount > 0;

              return (
                <tr
                  key={day.invDate}
                  className={`border-b border-border hover:bg-muted/50 transition-colors ${
                    isHighest ? 'bg-amber-500/10' : ''
                  }`}
                >
                  <td className="py-2 px-2 text-sm">
                    {new Date(day.invDate).toLocaleDateString('ar-EG', {
                      day: 'numeric',
                      month: 'short',
                    })}
                  </td>
                  <td className={`py-2 px-2 text-sm font-medium ${hasData ? 'text-red-600' : 'text-muted-foreground'}`}>
                    {hasData ? formatCurrency(day.Amount) : '—'}
                  </td>
                  <td className="py-2 px-2 text-sm text-muted-foreground">
                    {hasData ? day.Count : '—'}
                  </td>
                  <td className="py-2 px-2">
                    <div className="flex items-center gap-2">
                      {hasData && (
                        <div className="flex-1 bg-muted rounded-full h-1.5 overflow-hidden max-w-[200px]">
                          <div
                            className="h-full bg-gradient-to-r from-red-400 to-red-600 transition-all duration-300"
                            style={{ width: `${barWidth}%` }}
                          ></div>
                        </div>
                      )}
                      {isHighest && (
                        <AlertCircle className="h-4 w-4 text-amber-500" />
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

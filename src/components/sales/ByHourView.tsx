'use client';

import { Clock, TrendingUp } from 'lucide-react';
import type { HourlySales } from '@/lib/types/today-sales';

interface ByHourViewProps {
  hourly: HourlySales[];
}

export default function ByHourView({ hourly }: ByHourViewProps) {
  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('ar-EG', {
      style: 'decimal',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(amount);
  };

  if (hourly.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        <Clock className="w-12 h-12 mx-auto mb-3 opacity-30" />
        <p className="text-sm">لا توجد بيانات للساعات</p>
      </div>
    );
  }

  const maxSales = Math.max(...hourly.map(h => h.totalSales));

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {hourly.map((hour) => (
        <div
          key={hour.hour}
          className="bg-card border border-border rounded-xl p-4 hover:border-border transition-all"
        >
          <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
            <div className="flex items-center gap-2">
              <div className="flex items-center justify-center w-8 h-8 rounded-full bg-info-soft border border-info/20">
                <Clock className="w-4 h-4 text-info" />
              </div>
              <div>
                <h4 className="text-base font-bold text-foreground">{hour.hour}</h4>
                <p className="text-xs text-muted-foreground">{hour.invoiceCount} فاتورة</p>
              </div>
            </div>
            <div className="text-left">
              <p className="text-lg font-black text-success">{formatCurrency(hour.totalSales)}</p>
              <p className="text-xs text-muted-foreground">ج.م</p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2 mb-3">
            <div className="bg-muted rounded-lg p-2">
              <p className="text-xs text-muted-foreground mb-0.5">طريقة الدفع</p>
              <p className="text-xs font-bold text-foreground truncate" title={hour.topPaymentMethod || '-'}>
                {hour.topPaymentMethod || '-'}
              </p>
            </div>
            <div className="bg-muted rounded-lg p-2">
              <p className="text-xs text-muted-foreground mb-0.5">الحلاق</p>
              <p className="text-xs font-bold text-foreground truncate" title={hour.topBarber || '-'}>
                {hour.topBarber || '-'}
              </p>
            </div>
          </div>

          {/* Visual bar indicator */}
          <div className="space-y-1">
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">النشاط</span>
              <span className="font-bold text-info">{hour.percentageOfTotal.toFixed(1)}%</span>
            </div>
            <div className="relative w-full bg-muted rounded-full h-1.5 overflow-hidden">
              <div
                className="h-full bg-info transition-all duration-500"
                style={{ width: `${maxSales > 0 ? (hour.totalSales / maxSales) * 100 : 0}%` }}
              />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

'use client';

import { User, Award, TrendingUp } from 'lucide-react';
import type { BarberSales } from '@/lib/types/today-sales';

interface ByBarberViewProps {
  barbers: BarberSales[];
}

export default function ByBarberView({ barbers }: ByBarberViewProps) {
  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('ar-EG', {
      style: 'decimal',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(amount);
  };

  if (barbers.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        <User className="w-12 h-12 mx-auto mb-3 opacity-30" />
        <p className="text-sm">لا توجد بيانات للحلاقين</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {barbers.map((barber, index) => (
        <div
          key={barber.empId}
          className="bg-card border border-border rounded-xl p-4 hover:border-border transition-all"
        >
          <div className="flex flex-wrap items-start justify-between gap-2 mb-3">
            <div className="flex items-center gap-3">
              {index < 3 && (
                <div className={`flex items-center justify-center w-8 h-8 rounded-full border ${
                  index === 0 ? 'bg-warning-soft border-warning/20 text-warning' :
                  index === 1 ? 'bg-muted border-border text-foreground' :
                  'bg-warning-soft border-warning/20 text-warning'
                }`}>
                  <Award className="w-4 h-4" />
                </div>
              )}
              <div>
                <h4 className="text-lg font-bold text-foreground">{barber.empName}</h4>
                <p className="text-xs text-muted-foreground">{barber.serviceCount} خدمة • {barber.invoiceContribution} فاتورة</p>
              </div>
            </div>
            <div className="text-left">
              <p className="text-2xl font-black text-success">{formatCurrency(barber.totalSales)}</p>
              <p className="text-xs text-muted-foreground">ج.م</p>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3 mb-3">
            <div className="bg-muted rounded-lg p-2.5">
              <p className="text-xs text-muted-foreground mb-1">عدد الخدمات</p>
              <p className="text-sm font-bold text-foreground">{barber.serviceCount}</p>
            </div>
            <div className="bg-muted rounded-lg p-2.5">
              <p className="text-xs text-muted-foreground mb-1">متوسط البيع</p>
              <p className="text-sm font-bold text-foreground">{formatCurrency(barber.averageSale)}</p>
            </div>
            <div className="bg-muted rounded-lg p-2.5">
              <p className="text-xs text-muted-foreground mb-1">أكثر خدمة</p>
              <p className="text-sm font-bold text-foreground truncate" title={barber.topService || '-'}>
                {barber.topService || '-'}
              </p>
            </div>
          </div>

          {/* Progress bar */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">نسبة المساهمة</span>
              <span className="font-bold text-warning">{barber.percentageOfTotal.toFixed(1)}%</span>
            </div>
            <div className="relative w-full bg-muted rounded-full h-2 overflow-hidden">
              <div
                className="h-full bg-primary transition-all duration-500"
                style={{ width: `${barber.percentageOfTotal}%` }}
              />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

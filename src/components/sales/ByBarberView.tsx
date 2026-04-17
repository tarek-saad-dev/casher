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
      <div className="text-center py-12 text-zinc-500">
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
          className="bg-zinc-900/60 border border-zinc-800/50 rounded-xl p-4 hover:border-zinc-700/50 transition-all"
        >
          <div className="flex items-start justify-between mb-3">
            <div className="flex items-center gap-3">
              {index < 3 && (
                <div className={`flex items-center justify-center w-8 h-8 rounded-full border ${
                  index === 0 ? 'bg-amber-500/10 border-amber-500/20 text-amber-400' :
                  index === 1 ? 'bg-zinc-400/10 border-zinc-400/20 text-zinc-300' :
                  'bg-orange-500/10 border-orange-500/20 text-orange-400'
                }`}>
                  <Award className="w-4 h-4" />
                </div>
              )}
              <div>
                <h4 className="text-lg font-bold text-white">{barber.empName}</h4>
                <p className="text-xs text-zinc-400">{barber.serviceCount} خدمة • {barber.invoiceContribution} فاتورة</p>
              </div>
            </div>
            <div className="text-left">
              <p className="text-2xl font-black text-emerald-400">{formatCurrency(barber.totalSales)}</p>
              <p className="text-xs text-zinc-500">ج.م</p>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3 mb-3">
            <div className="bg-zinc-800/40 rounded-lg p-2.5">
              <p className="text-xs text-zinc-400 mb-1">عدد الخدمات</p>
              <p className="text-sm font-bold text-white">{barber.serviceCount}</p>
            </div>
            <div className="bg-zinc-800/40 rounded-lg p-2.5">
              <p className="text-xs text-zinc-400 mb-1">متوسط البيع</p>
              <p className="text-sm font-bold text-white">{formatCurrency(barber.averageSale)}</p>
            </div>
            <div className="bg-zinc-800/40 rounded-lg p-2.5">
              <p className="text-xs text-zinc-400 mb-1">أكثر خدمة</p>
              <p className="text-sm font-bold text-white truncate" title={barber.topService || '-'}>
                {barber.topService || '-'}
              </p>
            </div>
          </div>

          {/* Progress bar */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <span className="text-zinc-400">نسبة المساهمة</span>
              <span className="font-bold text-amber-400">{barber.percentageOfTotal.toFixed(1)}%</span>
            </div>
            <div className="relative w-full bg-zinc-800/50 rounded-full h-2 overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-amber-500 to-yellow-500 transition-all duration-500"
                style={{ width: `${barber.percentageOfTotal}%` }}
              />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

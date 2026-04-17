'use client';

import { TrendingUp, Receipt, Award } from 'lucide-react';
import type { ShiftSales } from '@/lib/types/today-sales';

interface ByShiftViewProps {
  shifts: ShiftSales[];
}

export default function ByShiftView({ shifts }: ByShiftViewProps) {
  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('ar-EG', {
      style: 'decimal',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(amount);
  };

  if (shifts.length === 0) {
    return (
      <div className="text-center py-12 text-zinc-500">
        <Receipt className="w-12 h-12 mx-auto mb-3 opacity-30" />
        <p className="text-sm">لا توجد بيانات للورديات</p>
      </div>
    );
  }

  const maxSales = Math.max(...shifts.map(s => s.totalSales));

  return (
    <div className="space-y-3">
      {shifts.map((shift, index) => (
        <div
          key={shift.shiftMoveId}
          className="bg-zinc-900/60 border border-zinc-800/50 rounded-xl p-4 hover:border-zinc-700/50 transition-all"
        >
          <div className="flex items-start justify-between mb-3">
            <div className="flex items-center gap-3">
              {index === 0 && (
                <div className="flex items-center justify-center w-8 h-8 rounded-full bg-amber-500/10 border border-amber-500/20">
                  <Award className="w-4 h-4 text-amber-400" />
                </div>
              )}
              <div>
                <h4 className="text-lg font-bold text-white">{shift.shiftName}</h4>
                <p className="text-xs text-zinc-400">{shift.userName}</p>
              </div>
            </div>
            <div className="text-left">
              <p className="text-2xl font-black text-emerald-400">{formatCurrency(shift.totalSales)}</p>
              <p className="text-xs text-zinc-500">ج.م</p>
            </div>
          </div>

          <div className="grid grid-cols-4 gap-3 mb-3">
            <div className="bg-zinc-800/40 rounded-lg p-2.5">
              <p className="text-xs text-zinc-400 mb-1">عدد الفواتير</p>
              <p className="text-sm font-bold text-white">{shift.invoiceCount}</p>
            </div>
            <div className="bg-zinc-800/40 rounded-lg p-2.5">
              <p className="text-xs text-zinc-400 mb-1">متوسط الفاتورة</p>
              <p className="text-sm font-bold text-white">{formatCurrency(shift.averageInvoice)}</p>
            </div>
            <div className="bg-zinc-800/40 rounded-lg p-2.5">
              <p className="text-xs text-zinc-400 mb-1">أفضل حلاق</p>
              <p className="text-sm font-bold text-white truncate">{shift.topBarber || '-'}</p>
            </div>
            <div className="bg-zinc-800/40 rounded-lg p-2.5">
              <p className="text-xs text-zinc-400 mb-1">طريقة الدفع الأكثر</p>
              <p className="text-sm font-bold text-white truncate">{shift.topPaymentMethod || '-'}</p>
            </div>
          </div>

          {/* Progress bar */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <span className="text-zinc-400">نسبة المساهمة</span>
              <span className="font-bold text-emerald-400">{shift.percentageOfTotal.toFixed(1)}%</span>
            </div>
            <div className="relative w-full bg-zinc-800/50 rounded-full h-2 overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-emerald-500 to-green-500 transition-all duration-500"
                style={{ width: `${shift.percentageOfTotal}%` }}
              />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

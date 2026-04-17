'use client';

import { Package, TrendingUp } from 'lucide-react';
import type { ServiceSales } from '@/lib/types/today-sales';

interface ByServiceViewProps {
  services: ServiceSales[];
}

export default function ByServiceView({ services }: ByServiceViewProps) {
  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('ar-EG', {
      style: 'decimal',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(amount);
  };

  if (services.length === 0) {
    return (
      <div className="text-center py-12 text-zinc-500">
        <Package className="w-12 h-12 mx-auto mb-3 opacity-30" />
        <p className="text-sm">لا توجد بيانات للخدمات</p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-3">
      {services.map((service, index) => (
        <div
          key={service.proId}
          className="bg-zinc-900/60 border border-zinc-800/50 rounded-xl p-4 hover:border-zinc-700/50 transition-all"
        >
          <div className="flex items-start justify-between mb-3">
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-1">
                {index < 5 && (
                  <div className="flex items-center justify-center w-6 h-6 rounded-full bg-amber-500/10 border border-amber-500/20">
                    <span className="text-xs font-bold text-amber-400">#{index + 1}</span>
                  </div>
                )}
                <h4 className="text-base font-bold text-white truncate">{service.proName}</h4>
              </div>
              <p className="text-xs text-zinc-400">{service.timesSold} مرة • كمية {service.quantitySold}</p>
            </div>
            <div className="text-left ml-3">
              <p className="text-lg font-black text-emerald-400">{formatCurrency(service.totalSales)}</p>
              <p className="text-xs text-zinc-500">ج.م</p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2 mb-3">
            <div className="bg-zinc-800/40 rounded-lg p-2">
              <p className="text-xs text-zinc-400 mb-0.5">متوسط السعر</p>
              <p className="text-sm font-bold text-white">{formatCurrency(service.averagePrice)}</p>
            </div>
            <div className="bg-zinc-800/40 rounded-lg p-2">
              <p className="text-xs text-zinc-400 mb-0.5">النسبة</p>
              <p className="text-sm font-bold text-amber-400">{service.percentageOfTotal.toFixed(1)}%</p>
            </div>
          </div>

          {/* Progress bar */}
          <div className="relative w-full bg-zinc-800/50 rounded-full h-1.5 overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-blue-500 to-cyan-500 transition-all duration-500"
              style={{ width: `${Math.min(service.percentageOfTotal, 100)}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

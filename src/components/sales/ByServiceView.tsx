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
      <div className="text-center py-12 text-muted-foreground">
        <Package className="w-12 h-12 mx-auto mb-3 opacity-30" />
        <p className="text-sm">لا توجد بيانات للخدمات</p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
      {services.map((service, index) => (
        <div
          key={service.proId}
          className="bg-card border border-border rounded-xl p-4 hover:border-border transition-all"
        >
          <div className="flex flex-wrap items-start justify-between gap-2 mb-3">
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-1">
                {index < 5 && (
                  <div className="flex items-center justify-center w-6 h-6 rounded-full bg-warning-soft border border-warning/20">
                    <span className="text-xs font-bold text-warning">#{index + 1}</span>
                  </div>
                )}
                <h4 className="text-base font-bold text-foreground truncate">{service.proName}</h4>
              </div>
              <p className="text-xs text-muted-foreground">{service.timesSold} مرة • كمية {service.quantitySold}</p>
            </div>
            <div className="text-left ml-3">
              <p className="text-lg font-black text-success">{formatCurrency(service.totalSales)}</p>
              <p className="text-xs text-muted-foreground">ج.م</p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2 mb-3">
            <div className="bg-muted rounded-lg p-2">
              <p className="text-xs text-muted-foreground mb-0.5">متوسط السعر</p>
              <p className="text-sm font-bold text-foreground">{formatCurrency(service.averagePrice)}</p>
            </div>
            <div className="bg-muted rounded-lg p-2">
              <p className="text-xs text-muted-foreground mb-0.5">النسبة</p>
              <p className="text-sm font-bold text-warning">{service.percentageOfTotal.toFixed(1)}%</p>
            </div>
          </div>

          {/* Progress bar */}
          <div className="relative w-full bg-muted rounded-full h-1.5 overflow-hidden">
            <div
              className="h-full bg-info transition-all duration-500"
              style={{ width: `${Math.min(service.percentageOfTotal, 100)}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

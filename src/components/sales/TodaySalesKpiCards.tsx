'use client';

import { TrendingUp, Receipt, Users, Award, Clock, CreditCard, User, Package } from 'lucide-react';
import type { TodaySalesKPI } from '@/lib/types/today-sales';

interface TodaySalesKpiCardsProps {
  kpi: TodaySalesKPI;
  loading?: boolean;
}

export default function TodaySalesKpiCards({ kpi, loading }: TodaySalesKpiCardsProps) {
  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('ar-EG', {
      style: 'decimal',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(amount);
  };

  if (loading) {
    return (
      <div className="grid grid-cols-4 gap-4 mb-6">
        {[1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
          <div key={i} className="bg-zinc-900/60 border border-zinc-800/50 rounded-xl p-4 animate-pulse">
            <div className="h-4 bg-zinc-800 rounded w-20 mb-3"></div>
            <div className="h-8 bg-zinc-800 rounded w-32"></div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-4 gap-4 mb-6">
      {/* Total Sales */}
      <div className="bg-gradient-to-br from-emerald-500/10 to-emerald-600/5 border border-emerald-500/20 rounded-xl p-4 hover:border-emerald-500/40 transition-all">
        <div className="flex items-center gap-2 text-emerald-400 mb-2">
          <TrendingUp className="w-4 h-4" />
          <span className="text-xs font-medium">إجمالي المبيعات</span>
        </div>
        <p className="text-2xl font-black text-white">{formatCurrency(kpi.totalSales)}</p>
        <p className="text-xs text-zinc-400 mt-1">ج.م</p>
      </div>

      {/* Invoice Count */}
      <div className="bg-gradient-to-br from-blue-500/10 to-blue-600/5 border border-blue-500/20 rounded-xl p-4 hover:border-blue-500/40 transition-all">
        <div className="flex items-center gap-2 text-blue-400 mb-2">
          <Receipt className="w-4 h-4" />
          <span className="text-xs font-medium">عدد الفواتير</span>
        </div>
        <p className="text-2xl font-black text-white">{kpi.invoiceCount}</p>
        <p className="text-xs text-zinc-400 mt-1">فاتورة</p>
      </div>

      {/* Average Invoice */}
      <div className="bg-gradient-to-br from-amber-500/10 to-amber-600/5 border border-amber-500/20 rounded-xl p-4 hover:border-amber-500/40 transition-all">
        <div className="flex items-center gap-2 text-amber-400 mb-2">
          <TrendingUp className="w-4 h-4" />
          <span className="text-xs font-medium">متوسط الفاتورة</span>
        </div>
        <p className="text-2xl font-black text-white">{formatCurrency(kpi.averageInvoice)}</p>
        <p className="text-xs text-zinc-400 mt-1">ج.م</p>
      </div>

      {/* Customer Count */}
      <div className="bg-gradient-to-br from-purple-500/10 to-purple-600/5 border border-purple-500/20 rounded-xl p-4 hover:border-purple-500/40 transition-all">
        <div className="flex items-center gap-2 text-purple-400 mb-2">
          <Users className="w-4 h-4" />
          <span className="text-xs font-medium">عدد العملاء</span>
        </div>
        <p className="text-2xl font-black text-white">{kpi.customerCount}</p>
        <p className="text-xs text-zinc-400 mt-1">عميل</p>
      </div>

      {/* Top Shift */}
      <div className="bg-zinc-900/60 border border-zinc-800/50 rounded-xl p-4 hover:border-zinc-700/50 transition-all">
        <div className="flex items-center gap-2 text-zinc-400 mb-2">
          <Clock className="w-4 h-4" />
          <span className="text-xs font-medium">أفضل وردية</span>
        </div>
        <p className="text-lg font-bold text-white truncate">{kpi.topShift || 'غير محدد'}</p>
      </div>

      {/* Top Payment Method */}
      <div className="bg-zinc-900/60 border border-zinc-800/50 rounded-xl p-4 hover:border-zinc-700/50 transition-all">
        <div className="flex items-center gap-2 text-zinc-400 mb-2">
          <CreditCard className="w-4 h-4" />
          <span className="text-xs font-medium">أكثر طريقة دفع</span>
        </div>
        <p className="text-lg font-bold text-white truncate">{kpi.topPaymentMethod || 'غير محدد'}</p>
      </div>

      {/* Top Barber */}
      <div className="bg-zinc-900/60 border border-zinc-800/50 rounded-xl p-4 hover:border-zinc-700/50 transition-all">
        <div className="flex items-center gap-2 text-zinc-400 mb-2">
          <User className="w-4 h-4" />
          <span className="text-xs font-medium">أفضل حلاق</span>
        </div>
        <p className="text-lg font-bold text-white truncate">{kpi.topBarber || 'غير محدد'}</p>
      </div>

      {/* Top Service */}
      <div className="bg-zinc-900/60 border border-zinc-800/50 rounded-xl p-4 hover:border-zinc-700/50 transition-all">
        <div className="flex items-center gap-2 text-zinc-400 mb-2">
          <Package className="w-4 h-4" />
          <span className="text-xs font-medium">أكثر خدمة مبيعاً</span>
        </div>
        <p className="text-lg font-bold text-white truncate">{kpi.topService || 'غير محدد'}</p>
      </div>
    </div>
  );
}

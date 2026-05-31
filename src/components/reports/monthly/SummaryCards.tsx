'use client';

import { TrendingUp, TrendingDown, Receipt, Wallet } from 'lucide-react';
import type { MonthlyBusinessReport } from '@/lib/types/monthly-report';

interface SummaryCardsProps {
  data: MonthlyBusinessReport;
  loading: boolean;
}

export default function SummaryCards({ data, loading }: SummaryCardsProps) {
  if (loading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="p-6 bg-card border border-border rounded-lg animate-pulse">
            <div className="h-4 bg-muted rounded w-24 mb-3"></div>
            <div className="h-10 bg-muted rounded w-32"></div>
          </div>
        ))}
      </div>
    );
  }

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('ar-EG', {
      style: 'decimal',
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    }).format(amount) + ' ج.م';
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
      {/* Total Revenue = Treasury Incoming (الوارد) */}
      <div className="p-6 bg-card border border-border rounded-lg hover:shadow-md transition-shadow">
        <div className="flex items-center gap-3 mb-3">
          <div className="p-2 bg-emerald-500/10 rounded-lg">
            <TrendingUp className="h-5 w-5 text-emerald-500" />
          </div>
          <span className="text-sm text-muted-foreground">إجمالي الوارد</span>
        </div>
        <div className="text-2xl font-bold text-emerald-600">
          {formatCurrency(data.totalRevenue)}
        </div>
        <div className="text-xs text-muted-foreground mt-2">
          الوارد الكلي للخزنة
        </div>
      </div>

      {/* Total Expenses = Treasury Outgoing (الصادر) */}
      <div className="p-6 bg-card border border-border rounded-lg hover:shadow-md transition-shadow">
        <div className="flex items-center gap-3 mb-3">
          <div className="p-2 bg-rose-500/10 rounded-lg">
            <TrendingDown className="h-5 w-5 text-rose-500" />
          </div>
          <span className="text-sm text-muted-foreground">إجمالي الصادر</span>
        </div>
        <div className="text-2xl font-bold text-rose-600">
          {formatCurrency(data.totalExpenses)}
        </div>
        <div className="text-xs text-muted-foreground mt-2">
          الصادر الكلي من الخزنة
        </div>
      </div>

      {/* Net Profit = Treasury Net (الصافي) */}
      <div className="p-6 bg-card border border-border rounded-lg hover:shadow-md transition-shadow">
        <div className="flex items-center gap-3 mb-3">
          <div className={`p-2 rounded-lg ${data.netProfit >= 0 ? 'bg-blue-500/10' : 'bg-amber-500/10'}`}>
            <Wallet className={`h-5 w-5 ${data.netProfit >= 0 ? 'text-blue-500' : 'text-amber-500'}`} />
          </div>
          <span className="text-sm text-muted-foreground">الصافي</span>
        </div>
        <div className={`text-2xl font-bold ${data.netProfit >= 0 ? 'text-blue-600' : 'text-amber-600'}`}>
          {formatCurrency(data.netProfit)}
        </div>
        <div className="text-xs text-muted-foreground mt-2">
          الوارد - الصادر
        </div>
      </div>

      {/* Total Invoices */}
      <div className="p-6 bg-card border border-border rounded-lg hover:shadow-md transition-shadow">
        <div className="flex items-center gap-3 mb-3">
          <div className="p-2 bg-purple-500/10 rounded-lg">
            <Receipt className="h-5 w-5 text-purple-500" />
          </div>
          <span className="text-sm text-muted-foreground">عدد الفواتير</span>
        </div>
        <div className="text-2xl font-bold text-purple-600">
          {data.totalInvoices.toLocaleString('ar-EG')}
        </div>
        <div className="text-xs text-muted-foreground mt-2">
          فاتورة خلال الشهر
        </div>
      </div>
    </div>
  );
}

'use client';

import { CreditCard, Banknote, Wallet, TrendingUp } from 'lucide-react';
import type { PaymentMethodSales } from '@/lib/types/today-sales';

interface ByPaymentMethodViewProps {
  paymentMethods: PaymentMethodSales[];
}

export default function ByPaymentMethodView({ paymentMethods }: ByPaymentMethodViewProps) {
  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('ar-EG', {
      style: 'decimal',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(amount);
  };

  const getPaymentIcon = (name: string) => {
    if (name.includes('كاش')) return <Banknote className="w-5 h-5" />;
    if (name.includes('فيزا') || name.includes('بطاقة')) return <CreditCard className="w-5 h-5" />;
    return <Wallet className="w-5 h-5" />;
  };

  if (paymentMethods.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        <Wallet className="w-12 h-12 mx-auto mb-3 opacity-30" />
        <p className="text-sm">لا توجد بيانات لطرق الدفع</p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      {paymentMethods.map((pm) => (
        <div
          key={pm.paymentMethodId}
          className="bg-card border border-border rounded-xl p-5 hover:border-border transition-all"
        >
          {/* Header */}
          <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
            <div className="flex items-center gap-3">
              <div className="flex items-center justify-center w-10 h-10 rounded-full bg-warning-soft border border-warning/20 text-warning">
                {getPaymentIcon(pm.paymentMethodName)}
              </div>
              <div>
                <h4 className="text-lg font-bold text-foreground">{pm.paymentMethodName}</h4>
                <p className="text-xs text-muted-foreground">{pm.invoiceCount} عملية</p>
              </div>
            </div>
            <div className="px-3 py-1.5 rounded-full bg-success-soft border border-success/20">
              <span className="text-sm font-bold text-success">{pm.percentageOfTotal.toFixed(1)}%</span>
            </div>
          </div>

          {/* Amount */}
          <div className="mb-4">
            <p className="text-xs text-muted-foreground mb-1">إجمالي المبلغ</p>
            <p className="text-3xl font-black text-foreground">{formatCurrency(pm.totalAmount)}</p>
            <p className="text-xs text-muted-foreground mt-0.5">ج.م</p>
          </div>

          {/* Stats */}
          <div className="grid grid-cols-2 gap-2">
            <div className="bg-muted rounded-lg p-2.5">
              <p className="text-xs text-muted-foreground mb-1">عدد المعاملات</p>
              <p className="text-sm font-bold text-foreground">{pm.invoiceCount}</p>
            </div>
            <div className="bg-muted rounded-lg p-2.5">
              <p className="text-xs text-muted-foreground mb-1">متوسط المعاملة</p>
              <p className="text-sm font-bold text-foreground">{formatCurrency(pm.averageTransaction)}</p>
            </div>
          </div>

          {/* Progress bar */}
          <div className="mt-3">
            <div className="relative w-full bg-muted rounded-full h-2 overflow-hidden">
              <div
                className="h-full bg-primary transition-all duration-500"
                style={{ width: `${Math.min(pm.percentageOfTotal, 100)}%` }}
              />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

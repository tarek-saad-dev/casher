'use client';

import { ArrowUpRight, ArrowDownRight, Wallet, TrendingUp, List } from 'lucide-react';
import type { PaymentMethodBreakdown } from '@/lib/types/treasury';

interface PaymentMethodBreakdownTableProps {
  paymentMethods: PaymentMethodBreakdown[];
  loading?: boolean;
  onViewDetails?: (key: string, name: string) => void;
}

export default function PaymentMethodBreakdownTable({ 
  paymentMethods, 
  loading,
  onViewDetails,
}: PaymentMethodBreakdownTableProps) {
  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('ar-EG', {
      style: 'decimal',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount) + ' ج.م';
  };

  const getPaymentMethodIcon = (name?: string | null) => {
    const s = (name ?? '').toLowerCase();
    if (s.includes('نقد') || s.includes('كاش') || s.includes('cash')) return '💵';
    if (s.includes('فيزا') || s.includes('visa')) return '💳';
    if (s.includes('انستا') || s.includes('insta')) return '📱';
    if (s.includes('باي') || s.includes('pay')) return '💰';
    return '💳';
  };

  if (loading) {
    return (
      <div className="bg-card border border-border rounded-xl p-3 sm:p-5 shadow-xs">
        <div className="flex items-center gap-3 mb-5">
          <div className="p-2 bg-warning-soft rounded-xl">
            <Wallet className="h-5 w-5 text-warning" />
          </div>
          <h3 className="text-xl font-bold text-foreground tracking-tight">تفصيل طرق الدفع</h3>
        </div>
        
        <div className="space-y-3">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="bg-muted border border-border rounded-xl p-4 animate-pulse">
              <div className="h-6 bg-muted rounded w-32 mb-3"></div>
              <div className="grid grid-cols-4 gap-4">
                <div className="h-4 bg-muted rounded"></div>
                <div className="h-4 bg-muted rounded"></div>
                <div className="h-4 bg-muted rounded"></div>
                <div className="h-4 bg-muted rounded"></div>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (paymentMethods.length === 0) {
    return (
      <div className="bg-card border border-border rounded-2xl p-12 shadow-xs">
        <div className="flex flex-col items-center justify-center gap-4">
          <div className="p-4 bg-muted rounded-full">
            <Wallet className="h-12 w-12 text-muted-foreground" />
          </div>
          <div className="text-center">
            <h3 className="text-lg font-semibold mb-2 text-foreground">لا توجد حركات مالية</h3>
            <p className="text-sm text-muted-foreground">
              لم يتم العثور على حركات مالية للفترة المحددة
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-card border border-border rounded-xl p-3 sm:p-5 shadow-xs">
      <div className="flex items-center gap-3 mb-5">
        <div className="p-2 bg-warning-soft rounded-xl">
          <Wallet className="h-5 w-5 text-warning" />
        </div>
        <h3 className="text-xl font-bold text-foreground tracking-tight">تفصيل طرق الدفع</h3>
      </div>

      <div className="space-y-3">
        {paymentMethods.map((pm) => (
          <div
            key={pm.paymentMethodKey}
            className="bg-muted border border-border rounded-xl p-4 hover:border-border transition-all duration-300"
          >
            {/* Header */}
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <span className="text-2xl">{getPaymentMethodIcon(pm.paymentMethodName)}</span>
                <div>
                  <h4 className="text-lg font-bold text-foreground">{pm.paymentMethodName ?? 'طريقة دفع غير محددة'}</h4>
                  <p className="text-xs text-muted-foreground">{pm.transactionCount} معاملة</p>
                  {(pm.salesInflow > 0 || pm.incomeInflow > 0) && (
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {pm.salesInflow > 0 && `مبيعات: ${formatCurrency(pm.salesInflow)}`}
                      {pm.salesInflow > 0 && pm.incomeInflow > 0 && ' • '}
                      {pm.incomeInflow > 0 && `إيرادات: ${formatCurrency(pm.incomeInflow)}`}
                    </p>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-2">
                {/* Net Badge */}
                <div className={`px-3 py-1.5 rounded-full border ${
                  pm.net >= 0 
                    ? 'bg-success-soft text-success border-success/20' 
                    : 'bg-destructive-soft text-destructive border-destructive/20'
                }`}>
                  <span className="text-sm font-bold">{formatCurrency(pm.net)}</span>
                </div>

                {/* Details button */}
                {onViewDetails && (
                  <button
                    onClick={() => onViewDetails(pm.paymentMethodKey, pm.paymentMethodName ?? 'طريقة دفع غير محددة')}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border bg-muted hover:bg-muted text-foreground hover:text-foreground text-xs font-medium transition-colors"
                  >
                    <List className="h-3.5 w-3.5" />
                    عرض التفاصيل
                  </button>
                )}
              </div>
            </div>

            {/* Metrics Grid */}
            <div className="grid grid-cols-1 gap-3 min-[480px]:grid-cols-3">
              {/* Inflow */}
              <div className="bg-success-soft border border-success/10 rounded-lg p-3">
                <div className="flex items-center gap-1.5 mb-1">
                  <ArrowUpRight className="h-3.5 w-3.5 text-success" />
                  <span className="text-xs text-muted-foreground font-medium">وارد</span>
                </div>
                <div className="text-sm font-bold text-success">
                  {formatCurrency(pm.inflow)}
                </div>
                {(pm.salesInflow > 0 || pm.incomeInflow > 0) && (
                  <div className="text-[10px] text-muted-foreground mt-1 space-y-0.5">
                    {pm.salesInflow > 0 && (
                      <div>مبيعات: {formatCurrency(pm.salesInflow)}</div>
                    )}
                    {pm.incomeInflow > 0 && (
                      <div>إيرادات: {formatCurrency(pm.incomeInflow)}</div>
                    )}
                  </div>
                )}
              </div>

              {/* Outflow */}
              <div className="bg-destructive-soft border border-destructive/10 rounded-lg p-3">
                <div className="flex items-center gap-1.5 mb-1">
                  <ArrowDownRight className="h-3.5 w-3.5 text-destructive" />
                  <span className="text-xs text-muted-foreground font-medium">صادر</span>
                </div>
                <div className="text-sm font-bold text-destructive">
                  {formatCurrency(pm.outflow)}
                </div>
              </div>

              {/* Percentage */}
              <div className="bg-muted border border-border rounded-lg p-3">
                <div className="flex items-center gap-1.5 mb-1">
                  <TrendingUp className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="text-xs text-muted-foreground font-medium">النسبة</span>
                </div>
                <div className="text-sm font-bold text-foreground">
                  {pm.percentageOfTotal.toFixed(1)}%
                </div>
              </div>
            </div>

            {/* Progress Bar */}
            {pm.percentageOfTotal > 0 && (
              <div className="mt-3">
                <div className="relative w-full bg-muted rounded-full h-1.5 overflow-hidden">
                  <div
                    className={`h-full transition-all duration-500 ${
                      pm.net >= 0 
                        ? 'bg-success' 
                        : 'bg-destructive'
                    }`}
                    style={{ width: `${Math.min(pm.percentageOfTotal, 100)}%` }}
                  />
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

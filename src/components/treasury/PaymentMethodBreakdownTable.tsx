'use client';

import { ArrowUpRight, ArrowDownRight, Wallet, TrendingUp } from 'lucide-react';
import type { PaymentMethodBreakdown } from '@/lib/types/treasury';

interface PaymentMethodBreakdownTableProps {
  paymentMethods: PaymentMethodBreakdown[];
  loading?: boolean;
}

export default function PaymentMethodBreakdownTable({ 
  paymentMethods, 
  loading 
}: PaymentMethodBreakdownTableProps) {
  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('ar-EG', {
      style: 'decimal',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount) + ' ج.م';
  };

  const getPaymentMethodIcon = (name: string) => {
    if (name.includes('نقد')) return '💵';
    if (name.includes('فيزا') || name.includes('visa')) return '💳';
    if (name.includes('انستا') || name.includes('insta')) return '📱';
    if (name.includes('باي') || name.includes('pay')) return '💰';
    return '💳';
  };

  if (loading) {
    return (
      <div className="bg-gradient-to-br from-zinc-900/90 to-zinc-900/50 backdrop-blur-sm border border-zinc-800/50 rounded-2xl p-5 shadow-xl shadow-black/10">
        <div className="flex items-center gap-3 mb-5">
          <div className="p-2 bg-amber-500/10 rounded-xl">
            <Wallet className="h-5 w-5 text-amber-400" />
          </div>
          <h3 className="text-xl font-bold text-white tracking-tight">تفصيل طرق الدفع</h3>
        </div>
        
        <div className="space-y-3">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="bg-zinc-800/40 border border-zinc-700/30 rounded-xl p-4 animate-pulse">
              <div className="h-6 bg-zinc-700/30 rounded w-32 mb-3"></div>
              <div className="grid grid-cols-4 gap-4">
                <div className="h-4 bg-zinc-700/30 rounded"></div>
                <div className="h-4 bg-zinc-700/30 rounded"></div>
                <div className="h-4 bg-zinc-700/30 rounded"></div>
                <div className="h-4 bg-zinc-700/30 rounded"></div>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (paymentMethods.length === 0) {
    return (
      <div className="bg-gradient-to-br from-zinc-900/90 to-zinc-900/50 backdrop-blur-sm border border-zinc-800/50 rounded-2xl p-12 shadow-xl shadow-black/10">
        <div className="flex flex-col items-center justify-center gap-4">
          <div className="p-4 bg-zinc-800/40 rounded-full">
            <Wallet className="h-12 w-12 text-zinc-600" />
          </div>
          <div className="text-center">
            <h3 className="text-lg font-semibold mb-2 text-white">لا توجد حركات مالية</h3>
            <p className="text-sm text-zinc-400">
              لم يتم العثور على حركات مالية للفترة المحددة
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-gradient-to-br from-zinc-900/90 to-zinc-900/50 backdrop-blur-sm border border-zinc-800/50 rounded-2xl p-5 shadow-xl shadow-black/10">
      <div className="flex items-center gap-3 mb-5">
        <div className="p-2 bg-amber-500/10 rounded-xl">
          <Wallet className="h-5 w-5 text-amber-400" />
        </div>
        <h3 className="text-xl font-bold text-white tracking-tight">تفصيل طرق الدفع</h3>
      </div>

      <div className="space-y-3">
        {paymentMethods.map((pm) => (
          <div
            key={pm.paymentMethodId}
            className="bg-zinc-800/40 border border-zinc-700/30 rounded-xl p-4 hover:border-zinc-700/50 transition-all duration-300"
          >
            {/* Header */}
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <span className="text-2xl">{getPaymentMethodIcon(pm.paymentMethodName)}</span>
                <div>
                  <h4 className="text-lg font-bold text-white">{pm.paymentMethodName}</h4>
                  <p className="text-xs text-zinc-500">{pm.transactionCount} معاملة</p>
                  {(pm.salesInflow > 0 || pm.incomeInflow > 0) && (
                    <p className="text-xs text-zinc-400 mt-0.5">
                      {pm.salesInflow > 0 && `مبيعات: ${formatCurrency(pm.salesInflow)}`}
                      {pm.salesInflow > 0 && pm.incomeInflow > 0 && ' • '}
                      {pm.incomeInflow > 0 && `إيرادات: ${formatCurrency(pm.incomeInflow)}`}
                    </p>
                  )}
                </div>
              </div>
              
              {/* Net Badge */}
              <div className={`px-3 py-1.5 rounded-full border ${
                pm.net >= 0 
                  ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' 
                  : 'bg-rose-500/10 text-rose-400 border-rose-500/20'
              }`}>
                <span className="text-sm font-bold">{formatCurrency(pm.net)}</span>
              </div>
            </div>

            {/* Metrics Grid */}
            <div className="grid grid-cols-3 gap-3">
              {/* Inflow */}
              <div className="bg-emerald-500/5 border border-emerald-500/10 rounded-lg p-3">
                <div className="flex items-center gap-1.5 mb-1">
                  <ArrowUpRight className="h-3.5 w-3.5 text-emerald-400" />
                  <span className="text-xs text-zinc-400 font-medium">وارد</span>
                </div>
                <div className="text-sm font-bold text-emerald-400">
                  {formatCurrency(pm.inflow)}
                </div>
                {(pm.salesInflow > 0 || pm.incomeInflow > 0) && (
                  <div className="text-[10px] text-zinc-500 mt-1 space-y-0.5">
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
              <div className="bg-rose-500/5 border border-rose-500/10 rounded-lg p-3">
                <div className="flex items-center gap-1.5 mb-1">
                  <ArrowDownRight className="h-3.5 w-3.5 text-rose-400" />
                  <span className="text-xs text-zinc-400 font-medium">صادر</span>
                </div>
                <div className="text-sm font-bold text-rose-400">
                  {formatCurrency(pm.outflow)}
                </div>
              </div>

              {/* Percentage */}
              <div className="bg-zinc-800/60 border border-zinc-700/30 rounded-lg p-3">
                <div className="flex items-center gap-1.5 mb-1">
                  <TrendingUp className="h-3.5 w-3.5 text-zinc-400" />
                  <span className="text-xs text-zinc-400 font-medium">النسبة</span>
                </div>
                <div className="text-sm font-bold text-white">
                  {pm.percentageOfTotal.toFixed(1)}%
                </div>
              </div>
            </div>

            {/* Progress Bar */}
            {pm.percentageOfTotal > 0 && (
              <div className="mt-3">
                <div className="relative w-full bg-zinc-800/50 rounded-full h-1.5 overflow-hidden">
                  <div
                    className={`h-full transition-all duration-500 ${
                      pm.net >= 0 
                        ? 'bg-gradient-to-r from-emerald-500/60 to-green-500/60' 
                        : 'bg-gradient-to-r from-rose-500/60 to-red-500/60'
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

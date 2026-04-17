'use client';

import { TrendingUp, TrendingDown, Wallet, Banknote, Award, Activity } from 'lucide-react';
import type { TreasurySummary } from '@/lib/types/treasury';

interface TreasuryKpiCardsProps {
  summary: TreasurySummary;
  loading?: boolean;
}

export default function TreasuryKpiCards({ summary, loading }: TreasuryKpiCardsProps) {
  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('ar-EG', {
      style: 'decimal',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount) + ' ج.م';
  };

  const kpis = [
    {
      label: 'إجمالي الوارد',
      value: summary.totalInflow,
      icon: TrendingUp,
      color: 'emerald',
      bgColor: 'bg-emerald-500/5',
      borderColor: 'border-emerald-500/10',
      iconColor: 'text-emerald-400',
      textColor: 'text-emerald-400'
    },
    {
      label: 'إجمالي الصادر',
      value: summary.totalOutflow,
      icon: TrendingDown,
      color: 'rose',
      bgColor: 'bg-rose-500/5',
      borderColor: 'border-rose-500/10',
      iconColor: 'text-rose-400',
      textColor: 'text-rose-400'
    },
    {
      label: 'صافي الخزنة',
      value: summary.grandNet,
      icon: Wallet,
      color: summary.grandNet >= 0 ? 'emerald' : 'rose',
      bgColor: summary.grandNet >= 0 ? 'bg-emerald-500/5' : 'bg-rose-500/5',
      borderColor: summary.grandNet >= 0 ? 'border-emerald-500/10' : 'border-rose-500/10',
      iconColor: summary.grandNet >= 0 ? 'text-emerald-400' : 'text-rose-400',
      textColor: summary.grandNet >= 0 ? 'text-emerald-400' : 'text-rose-400'
    },
    {
      label: 'صافي النقدي',
      value: summary.cashNet,
      icon: Banknote,
      color: summary.cashNet >= 0 ? 'amber' : 'orange',
      bgColor: summary.cashNet >= 0 ? 'bg-amber-500/5' : 'bg-orange-500/5',
      borderColor: summary.cashNet >= 0 ? 'border-amber-500/10' : 'border-orange-500/10',
      iconColor: summary.cashNet >= 0 ? 'text-amber-400' : 'text-orange-400',
      textColor: summary.cashNet >= 0 ? 'text-amber-400' : 'text-orange-400'
    },
    {
      label: 'أعلى طريقة دفع',
      value: summary.topPaymentMethod || 'لا يوجد',
      icon: Award,
      color: 'amber',
      bgColor: 'bg-amber-500/5',
      borderColor: 'border-amber-500/10',
      iconColor: 'text-amber-400',
      textColor: 'text-white',
      isText: true
    },
    {
      label: 'عدد المعاملات',
      value: summary.transactionCount,
      icon: Activity,
      color: 'zinc',
      bgColor: 'bg-zinc-800/40',
      borderColor: 'border-zinc-700/30',
      iconColor: 'text-zinc-400',
      textColor: 'text-white',
      isCount: true
    }
  ];

  if (loading) {
    return (
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        {[...Array(6)].map((_, i) => (
          <div
            key={i}
            className="bg-zinc-800/40 border border-zinc-700/30 rounded-xl p-4 animate-pulse"
          >
            <div className="h-4 bg-zinc-700/30 rounded mb-3 w-20"></div>
            <div className="h-8 bg-zinc-700/30 rounded w-full"></div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
      {kpis.map((kpi, index) => {
        const Icon = kpi.icon;
        
        return (
          <div
            key={index}
            className={`${kpi.bgColor} border ${kpi.borderColor} rounded-xl p-4 transition-all duration-300 hover:scale-105`}
          >
            <div className="flex items-center gap-2 mb-3">
              <Icon className={`h-4 w-4 ${kpi.iconColor}`} />
              <span className="text-xs text-zinc-400 font-medium">{kpi.label}</span>
            </div>
            
            {kpi.isText ? (
              <div className={`text-base font-bold ${kpi.textColor} tracking-tight truncate`}>
                {kpi.value}
              </div>
            ) : kpi.isCount ? (
              <div className={`text-2xl font-bold ${kpi.textColor} tracking-tight`}>
                {kpi.value}
              </div>
            ) : (
              <div className={`text-lg font-bold ${kpi.textColor} tracking-tight`}>
                {formatCurrency(kpi.value as number)}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

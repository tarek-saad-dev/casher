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
      color: 'success',
      bgColor: 'bg-success/5',
      borderColor: 'border-success/10',
      iconColor: 'text-success',
      textColor: 'text-success'
    },
    {
      label: 'إجمالي الصادر',
      value: summary.totalOutflow,
      icon: TrendingDown,
      color: 'destructive',
      bgColor: 'bg-destructive/5',
      borderColor: 'border-destructive/10',
      iconColor: 'text-destructive',
      textColor: 'text-destructive'
    },
    {
      label: 'صافي الخزنة',
      value: summary.grandNet,
      icon: Wallet,
      color: summary.grandNet >= 0 ? 'success' : 'destructive',
      bgColor: summary.grandNet >= 0 ? 'bg-success/5' : 'bg-destructive/5',
      borderColor: summary.grandNet >= 0 ? 'border-success/10' : 'border-destructive/10',
      iconColor: summary.grandNet >= 0 ? 'text-success' : 'text-destructive',
      textColor: summary.grandNet >= 0 ? 'text-success' : 'text-destructive'
    },
    {
      label: 'صافي النقدي',
      value: summary.cashNet,
      icon: Banknote,
      color: summary.cashNet >= 0 ? 'warning' : 'destructive',
      bgColor: summary.cashNet >= 0 ? 'bg-warning/5' : 'bg-destructive/5',
      borderColor: summary.cashNet >= 0 ? 'border-warning/10' : 'border-destructive/10',
      iconColor: summary.cashNet >= 0 ? 'text-warning' : 'text-destructive',
      textColor: summary.cashNet >= 0 ? 'text-warning' : 'text-destructive'
    },
    {
      label: 'أعلى طريقة دفع',
      value: summary.topPaymentMethod || 'لا يوجد',
      icon: Award,
      color: 'primary',
      bgColor: 'bg-primary/5',
      borderColor: 'border-primary/10',
      iconColor: 'text-primary',
      textColor: 'text-foreground',
      isText: true
    },
    {
      label: 'عدد المعاملات',
      value: summary.transactionCount,
      icon: Activity,
      color: 'muted',
      bgColor: 'bg-muted',
      borderColor: 'border-border',
      iconColor: 'text-muted-foreground',
      textColor: 'text-foreground',
      isCount: true
    }
  ];

  if (loading) {
    return (
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        {[...Array(6)].map((_, i) => (
          <div
            key={i}
            className="bg-muted border border-border rounded-xl p-4 animate-pulse"
          >
            <div className="h-4 bg-muted-foreground/20 rounded mb-3 w-20"></div>
            <div className="h-8 bg-muted-foreground/20 rounded w-full"></div>
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
              <span className="text-xs text-muted-foreground font-medium">{kpi.label}</span>
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

'use client';

import type { EmployeeAdvanceData } from '@/lib/types';
import { TrendingUp, TrendingDown, AlertTriangle, CheckCircle, Clock, ArrowUpRight, ArrowDownRight } from 'lucide-react';

interface EmployeeAdvanceCardProps {
  data: EmployeeAdvanceData;
}

export default function EmployeeAdvanceCard({ data }: EmployeeAdvanceCardProps) {
  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('ar-EG', {
      style: 'decimal',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount) + ' ج.م';
  };

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return '—';
    return new Date(dateStr).toLocaleDateString('ar-EG', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  };

  const getRiskIcon = () => {
    switch (data.RiskStatus.level) {
      case 'critical':
        return <AlertTriangle className="h-3.5 w-3.5" />;
      case 'high':
        return <TrendingDown className="h-3.5 w-3.5" />;
      case 'watch':
        return <Clock className="h-3.5 w-3.5" />;
      case 'safe':
        return <CheckCircle className="h-3.5 w-3.5" />;
    }
  };

  const getProgressBarColor = () => {
    switch (data.RiskStatus.level) {
      case 'critical':
        return 'bg-gradient-to-r from-rose-500/80 to-red-500/80';
      case 'high':
        return 'bg-gradient-to-r from-orange-500/70 to-amber-500/70';
      case 'watch':
        return 'bg-gradient-to-r from-amber-500/60 to-yellow-500/60';
      case 'safe':
        return 'bg-gradient-to-r from-emerald-500/60 to-green-500/60';
    }
  };

  const getRiskBadgeStyles = () => {
    switch (data.RiskStatus.level) {
      case 'critical':
        return 'bg-rose-500/10 text-rose-400 border-rose-500/20';
      case 'high':
        return 'bg-orange-500/10 text-orange-400 border-orange-500/20';
      case 'watch':
        return 'bg-amber-500/10 text-amber-400 border-amber-500/20';
      case 'safe':
        return 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20';
    }
  };

  const progressWidth = Math.min(data.AdvancePercentage, 100);

  return (
    <div className="group relative bg-gradient-to-br from-zinc-900/90 to-zinc-900/50 backdrop-blur-sm border border-zinc-800/50 rounded-2xl p-5 hover:border-zinc-700/50 hover:shadow-xl hover:shadow-black/20 transition-all duration-300">
      {/* Subtle top accent line */}
      <div className={`absolute top-0 left-0 right-0 h-0.5 rounded-t-2xl ${getProgressBarColor()}`} />
      
      {/* Header: Employee Name & Risk Badge */}
      <div className="flex items-start justify-between mb-5">
        <div>
          <h4 className="text-xl font-bold text-white mb-1 tracking-tight">{data.EmpName}</h4>
          <div className="flex items-center gap-2 text-xs text-zinc-500">
            <span>{data.AdvanceCount} سلفة</span>
            <span>•</span>
            <span>{data.SalesCount} إيراد</span>
          </div>
        </div>
        <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-xs font-medium ${getRiskBadgeStyles()}`}>
          {getRiskIcon()}
          <span>{data.RiskStatus.label}</span>
        </div>
      </div>

      {/* Financial Metrics Grid */}
      <div className="grid grid-cols-2 gap-3 mb-4">
        {/* Revenue */}
        <div className="bg-emerald-500/5 border border-emerald-500/10 rounded-xl p-3">
          <div className="flex items-center gap-1.5 mb-1.5">
            <ArrowUpRight className="h-3.5 w-3.5 text-emerald-400" />
            <span className="text-xs text-zinc-400 font-medium">الإيرادات</span>
          </div>
          <div className="text-lg font-bold text-emerald-400 tracking-tight">
            {formatCurrency(data.TotalRevenue)}
          </div>
        </div>

        {/* Advances */}
        <div className="bg-rose-500/5 border border-rose-500/10 rounded-xl p-3">
          <div className="flex items-center gap-1.5 mb-1.5">
            <ArrowDownRight className="h-3.5 w-3.5 text-rose-400" />
            <span className="text-xs text-zinc-400 font-medium">السلف</span>
          </div>
          <div className="text-lg font-bold text-rose-400 tracking-tight">
            {formatCurrency(data.TotalAdvances)}
          </div>
        </div>
      </div>

      {/* Remaining Balance - Prominent */}
      <div className="bg-zinc-800/40 border border-zinc-700/30 rounded-xl p-4 mb-4">
        <div className="flex items-center justify-between mb-1">
          <span className="text-xs text-zinc-400 font-medium">الصافي</span>
          {data.Remaining >= 0 ? (
            <span className="text-xs text-emerald-400 font-medium">فائض</span>
          ) : (
            <span className="text-xs text-rose-400 font-medium">عجز</span>
          )}
        </div>
        <div className={`text-2xl font-bold tracking-tight ${data.Remaining >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
          {formatCurrency(Math.abs(data.Remaining))}
        </div>
      </div>

      {/* Progress Bar - Refined */}
      <div className="mb-4">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs text-zinc-400 font-medium">نسبة السلف</span>
          <span className="text-sm font-bold text-white">
            {data.AdvancePercentage.toFixed(1)}%
          </span>
        </div>
        <div className="relative w-full bg-zinc-800/50 rounded-full h-2 overflow-hidden">
          <div
            className={`h-full ${getProgressBarColor()} transition-all duration-500 ease-out`}
            style={{ width: `${progressWidth}%` }}
          />
          {data.AdvancePercentage > 100 && (
            <div className="absolute inset-0 flex items-center justify-center">
              <span className="text-[10px] font-bold text-white/90">تجاوز الحد</span>
            </div>
          )}
        </div>
      </div>

      {/* Footer Info */}
      <div className="flex items-center justify-between pt-3 border-t border-zinc-800/50">
        {data.LatestAdvanceDate ? (
          <div className="text-[11px] text-zinc-500">
            آخر سلفة: <span className="text-zinc-400">{formatDate(data.LatestAdvanceDate)}</span>
          </div>
        ) : (
          <div className="text-[11px] text-zinc-500">لا توجد سلف</div>
        )}
        <div className={`text-[10px] px-2 py-0.5 rounded-full ${getRiskBadgeStyles()}`}>
          {data.RiskStatus.description}
        </div>
      </div>
    </div>
  );
}

'use client';

import { TrendingUp, TrendingDown, Wallet, Banknote, Award, Activity } from 'lucide-react';
import KpiCard from '@/components/shared/KpiCard';
import { Skeleton } from '@/components/ui/skeleton';
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
    { label: 'إجمالي الوارد', value: formatCurrency(summary.totalInflow), icon: TrendingUp, variant: 'success' as const },
    { label: 'إجمالي الصادر', value: formatCurrency(summary.totalOutflow), icon: TrendingDown, variant: 'danger' as const },
    { label: 'صافي الخزنة', value: formatCurrency(summary.grandNet), icon: Wallet, variant: summary.grandNet >= 0 ? 'success' as const : 'danger' as const },
    { label: 'صافي النقدي', value: formatCurrency(summary.cashNet), icon: Banknote, variant: summary.cashNet >= 0 ? 'warning' as const : 'danger' as const },
    { label: 'أعلى طريقة دفع', value: summary.topPaymentMethod || 'لا يوجد', icon: Award, variant: 'primary' as const },
    { label: 'عدد المعاملات', value: summary.transactionCount, icon: Activity, variant: 'default' as const },
  ];

  return (
    <div className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6" aria-busy={loading || undefined}>
      {loading
        ? Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-24 rounded-xl" />)
        : kpis.map(({ label, value, icon: Icon, variant }) => (
          <KpiCard key={label} title={label} value={value} icon={<Icon />} variant={variant} className="[&_.num]:whitespace-normal [&_.num]:break-words [&_.num]:text-lg" />
        ))}
    </div>
  );
}

'use client';

import { TrendingUp, TrendingDown, Wallet, Users, Loader2 } from 'lucide-react';
import KpiCard from '@/components/shared/KpiCard';
import type { PartnersMonthlyReportResponse } from '@/lib/types/partners-report';
import { formatPartnersCurrency } from './partnersReportUtils';

interface PartnersSummaryCardsProps {
  summary: PartnersMonthlyReportResponse['summary'] | null;
  loading: boolean;
}

function SummarySkeleton() {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
      {[...Array(4)].map((_, i) => (
        <div key={i} className="h-28 rounded-xl bg-zinc-900/50 border border-zinc-800/50 animate-pulse" />
      ))}
    </div>
  );
}

export default function PartnersSummaryCards({ summary, loading }: PartnersSummaryCardsProps) {
  if (loading && !summary) {
    return <SummarySkeleton />;
  }

  if (!summary) return null;

  const netVariant =
    summary.operatingNet > 0 ? 'success' :
    summary.operatingNet < 0 ? 'danger' :
    'default';

  const netTrend =
    summary.operatingNet > 0 ? 'up' :
    summary.operatingNet < 0 ? 'down' :
    'neutral';

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
      <KpiCard
        title="إجمالي الإيرادات"
        value={formatPartnersCurrency(summary.totalRevenue)}
        icon={<TrendingUp className="h-5 w-5" />}
        variant="success"
      />
      <KpiCard
        title="إجمالي المصروفات"
        value={formatPartnersCurrency(summary.totalExpenses)}
        icon={<TrendingDown className="h-5 w-5" />}
        variant="danger"
      />
      <KpiCard
        title="إجمالي سلف الموظفين"
        value={formatPartnersCurrency(summary.totalEmployeeAdvances)}
        icon={<Users className="h-5 w-5" />}
        variant="warning"
      />
      <KpiCard
        title="صافي التشغيل"
        value={formatPartnersCurrency(summary.operatingNet)}
        subtitle={summary.operatingNetExplanation}
        icon={<Wallet className="h-5 w-5" />}
        variant={netVariant}
        trend={netTrend}
        trendValue={
          summary.operatingNet > 0 ? 'ربح تشغيلي' :
          summary.operatingNet < 0 ? 'خسارة تشغيلية' :
          'متعادل'
        }
      />
    </div>
  );
}

export function PartnersSummaryCardsLoadingOverlay({ loading }: { loading: boolean }) {
  if (!loading) return null;
  return (
    <div className="flex items-center gap-2 text-xs text-zinc-500 print:hidden">
      <Loader2 className="h-3 w-3 animate-spin" />
      جاري تحديث البيانات...
    </div>
  );
}

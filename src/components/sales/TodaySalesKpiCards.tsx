'use client';

import { TrendingUp, Receipt, Users, Clock, CreditCard, User, Package } from 'lucide-react';
import KpiCard from '@/components/shared/KpiCard';
import { Skeleton } from '@/components/ui/skeleton';
import type { TodaySalesKPI } from '@/lib/types/today-sales';

interface TodaySalesKpiCardsProps {
  kpi: TodaySalesKPI;
  loading?: boolean;
}

function formatCurrency(amount: number) {
  return new Intl.NumberFormat('ar-EG', {
    style: 'decimal',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

export default function TodaySalesKpiCards({ kpi, loading }: TodaySalesKpiCardsProps) {
  if (loading) {
    return (
      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="rounded-xl border border-border bg-card p-4">
            <Skeleton className="mb-3 h-4 w-20" />
            <Skeleton className="h-8 w-28" />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
      <KpiCard
        title="إجمالي المبيعات"
        value={formatCurrency(kpi.totalSales)}
        subtitle="ج.م"
        icon={<TrendingUp />}
        variant="success"
      />
      <KpiCard
        title="عدد الفواتير"
        value={kpi.invoiceCount}
        subtitle="فاتورة"
        icon={<Receipt />}
        variant="info"
      />
      <KpiCard
        title="متوسط الفاتورة"
        value={formatCurrency(kpi.averageInvoice)}
        subtitle="ج.م"
        icon={<TrendingUp />}
        variant="warning"
      />
      <KpiCard
        title="عدد العملاء"
        value={kpi.customerCount}
        subtitle="عميل"
        icon={<Users />}
        variant="primary"
      />
      <KpiCard title="أفضل وردية" value={kpi.topShift || '—'} icon={<Clock />} />
      <KpiCard title="أكثر طريقة دفع" value={kpi.topPaymentMethod || '—'} icon={<CreditCard />} />
      <KpiCard title="أفضل حلاق" value={kpi.topBarber || '—'} icon={<User />} />
      <KpiCard title="أكثر خدمة مبيعاً" value={kpi.topService || '—'} icon={<Package />} />
    </div>
  );
}

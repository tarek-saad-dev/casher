'use client';

import PageHeader from '@/components/shared/PageHeader';
import KpiCard from '@/components/shared/KpiCard';
import EmptyState from '@/components/shared/EmptyState';
import { BarChart3, Coins, CreditCard, Calendar } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function TreasurySummaryPage() {
  return (
    <div className="p-6 max-w-7xl mx-auto">
      <PageHeader
        title="ملخص حسب الدفع"
        description="تلخيص حركات الخزنة حسب طرق الدفع"
      >
        <Button variant="outline" className="gap-2 border-zinc-700">
          <Calendar className="w-4 h-4" />
          اختر الفترة
        </Button>
      </PageHeader>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
        <KpiCard
          title="نقدي"
          value="٠ ر.س"
          icon={<Coins className="w-5 h-5" />}
          variant="success"
        />
        <KpiCard
          title="فيزا"
          value="٠ ر.س"
          icon={<CreditCard className="w-5 h-5" />}
          variant="primary"
        />
        <KpiCard
          title="إنستاباي"
          value="٠ ر.س"
          icon={<CreditCard className="w-5 h-5" />}
          variant="warning"
        />
      </div>

      <EmptyState
        title="اختر الفترة"
        description="استخدم الفلاتر لعرض الملخص"
        icon={<BarChart3 className="w-8 h-8 text-amber-500" />}
      />
    </div>
  );
}

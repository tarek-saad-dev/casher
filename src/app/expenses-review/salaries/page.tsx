'use client';

import PageHeader from '@/components/shared/PageHeader';
import KpiCard from '@/components/shared/KpiCard';
import EmptyState from '@/components/shared/EmptyState';
import { Banknote, Users, Calendar } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function SalariesReportPage() {
  return (
    <div className="p-6 max-w-7xl mx-auto">
      <PageHeader
        title="تقرير المرتبات"
        description="تقرير شامل لرواتب العاملين والمستحقات"
      >
        <Button variant="outline" className="gap-2 border-zinc-700">
          <Calendar className="w-4 h-4" />
          اختر الشهر
        </Button>
      </PageHeader>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <KpiCard
          title="إجمالي المستحق"
          value="٠ ر.س"
          icon={<Banknote className="w-5 h-5" />}
          variant="primary"
        />
        <KpiCard
          title="المدفوع"
          value="٠ ر.س"
          icon={<Banknote className="w-5 h-5" />}
          variant="success"
        />
        <KpiCard
          title="المتبقي"
          value="٠ ر.س"
          icon={<Banknote className="w-5 h-5" />}
          variant="danger"
        />
        <KpiCard
          title="عدد الموظفين"
          value="٠"
          icon={<Users className="w-5 h-5" />}
        />
      </div>

      <EmptyState
        title="اختر الشهر"
        description="استخدم الفلاتر لعرض تقرير المرتبات"
        icon={<Banknote className="w-8 h-8 text-amber-500" />}
      />
    </div>
  );
}

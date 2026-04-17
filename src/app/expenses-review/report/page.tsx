'use client';

import PageHeader from '@/components/shared/PageHeader';
import KpiCard from '@/components/shared/KpiCard';
import EmptyState from '@/components/shared/EmptyState';
import { PieChart, Calendar, Filter } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function ExpensesReportPage() {
  return (
    <div className="p-6 max-w-7xl mx-auto">
      <PageHeader
        title="تقرير المصروفات"
        description="تقرير شامل للمصروفات مع تحليلات وإحصائيات"
      >
        <Button variant="outline" className="gap-2 border-zinc-700">
          <Calendar className="w-4 h-4" />
          اختر الشهر
        </Button>
      </PageHeader>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
        <KpiCard
          title="إجمالي المصروفات"
          value="٠ ر.س"
          icon={<PieChart className="w-5 h-5" />}
          variant="danger"
        />
        <KpiCard
          title="عدد العمليات"
          value="٠"
          icon={<Filter className="w-5 h-5" />}
        />
        <KpiCard
          title="أكبر بند صرف"
          value="-"
          icon={<PieChart className="w-5 h-5" />}
          variant="warning"
        />
      </div>

      <EmptyState
        title="اختر الفترة الزمنية"
        description="استخدم الفلاتر لعرض تقرير المصروفات"
        icon={<PieChart className="w-8 h-8 text-amber-500" />}
      />
    </div>
  );
}

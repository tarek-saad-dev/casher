'use client';

import PageHeader from '@/components/shared/PageHeader';
import KpiCard from '@/components/shared/KpiCard';
import EmptyState from '@/components/shared/EmptyState';
import { Coins, Plus, Calendar } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function TodayRevenuePage() {
  return (
    <div className="p-6 max-w-7xl mx-auto">
      <PageHeader
        title="إيرادات اليوم"
        description="الإيرادات غير المرتبطة بفواتير البيع المباشرة"
      >
        <Button className="gap-2 bg-amber-600 hover:bg-amber-700">
          <Plus className="w-4 h-4" />
          إيراد جديد
        </Button>
      </PageHeader>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
        <KpiCard
          title="إجمالي الإيرادات"
          value="٠ ر.س"
          icon={<Coins className="w-5 h-5" />}
          variant="primary"
        />
        <KpiCard
          title="عدد العمليات"
          value="٠"
          icon={<Calendar className="w-5 h-5" />}
        />
        <KpiCard
          title="متوسط القيمة"
          value="٠ ر.س"
          icon={<Coins className="w-5 h-5" />}
          variant="warning"
        />
      </div>

      <EmptyState
        title="لا توجد إيرادات اليوم"
        description="لم يتم تسجيل أي إيرادات إضافية اليوم. يمكنك إضافة إيراد جديد من زر أعلاه."
        icon={<Coins className="w-8 h-8 text-amber-500" />}
      />
    </div>
  );
}

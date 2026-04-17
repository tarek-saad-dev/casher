'use client';

import PageHeader from '@/components/shared/PageHeader';
import EmptyState from '@/components/shared/EmptyState';
import { History, Calendar } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

export default function AllSalesPage() {
  return (
    <div className="p-6 max-w-7xl mx-auto">
      <PageHeader
        title="كل المبيعات"
        description="مراجعة جميع المبيعات مع إمكانية الفلترة حسب الفترة الزمنية"
      >
        <div className="flex items-center gap-2">
          <Input
            type="date"
            className="w-40 bg-zinc-950 border-zinc-800"
          />
          <span className="text-zinc-500">إلى</span>
          <Input
            type="date"
            className="w-40 bg-zinc-950 border-zinc-800"
          />
          <Button className="bg-amber-600 hover:bg-amber-700">
            <Calendar className="w-4 h-4 ml-2" />
            عرض
          </Button>
        </div>
      </PageHeader>

      <EmptyState
        title="اختر الفترة الزمنية"
        description="اختر نطاق التاريخ لعرض المبيعات خلال تلك الفترة"
        icon={<History className="w-8 h-8 text-amber-500" />}
      />
    </div>
  );
}

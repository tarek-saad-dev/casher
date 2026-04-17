'use client';

import PageHeader from '@/components/shared/PageHeader';
import EmptyState from '@/components/shared/EmptyState';
import { CalendarDays, Filter } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function AllRevenuePage() {
  return (
    <div className="p-6 max-w-7xl mx-auto">
      <PageHeader
        title="كل الإيرادات"
        description="مراجعة جميع الإيرادات مع فلاتر متقدمة"
      >
        <Button variant="outline" className="gap-2 border-zinc-700">
          <Filter className="w-4 h-4" />
          فلاتر
        </Button>
      </PageHeader>

      <EmptyState
        title="اختر الفترة الزمنية"
        description="استخدم الفلاتر لعرض الإيرادات حسب التاريخ والتصنيف"
        icon={<CalendarDays className="w-8 h-8 text-amber-500" />}
      />
    </div>
  );
}

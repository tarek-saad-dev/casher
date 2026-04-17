'use client';

import PageHeader from '@/components/shared/PageHeader';
import EmptyState from '@/components/shared/EmptyState';
import { Clock, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function ShiftClosePage() {
  return (
    <div className="p-6 max-w-7xl mx-auto">
      <PageHeader
        title="تقفيل الوردية"
        description="تقفيل الوردية الحالية ومراجعة المبيعات"
      >
        <Button className="gap-2 bg-amber-600 hover:bg-amber-700">
          <Plus className="w-4 h-4" />
          تقفيل وردية
        </Button>
      </PageHeader>

      <EmptyState
        title="قريباً"
        description="هذه الصفحة مخصصة لتقفيل الورديات. سيتم تفعيلها قريباً."
        icon={<Clock className="w-8 h-8 text-amber-500" />}
      />
    </div>
  );
}

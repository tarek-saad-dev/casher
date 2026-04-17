'use client';

import PageHeader from '@/components/shared/PageHeader';
import EmptyState from '@/components/shared/EmptyState';
import { ArrowLeftRight, Filter } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export default function TreasuryMovementsPage() {
  return (
    <div className="p-6 max-w-7xl mx-auto">
      <PageHeader
        title="حركة الخزنة"
        description="عرض كل حركات الخزنة (داخل وخارج)"
      >
        <div className="flex items-center gap-2">
          <Input
            type="date"
            className="w-40 bg-zinc-950 border-zinc-800"
          />
          <Button variant="outline" className="gap-2 border-zinc-700">
            <Filter className="w-4 h-4" />
            فلترة
          </Button>
        </div>
      </PageHeader>

      <EmptyState
        title="اختر الفترة"
        description="استخدم الفلاتر لعرض حركات الخزنة"
        icon={<ArrowLeftRight className="w-8 h-8 text-amber-500" />}
      />
    </div>
  );
}

'use client';

import PageHeader from '@/components/shared/PageHeader';
import EmptyState from '@/components/shared/EmptyState';
import { Tags, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function CategoriesPage() {
  return (
    <div className="p-6 max-w-7xl mx-auto">
      <PageHeader
        title="التصنيفات"
        description="إدارة تصنيفات الإيرادات والمصروفات"
      >
        <Button className="gap-2 bg-amber-600 hover:bg-amber-700">
          <Plus className="w-4 h-4" />
          تصنيف جديد
        </Button>
      </PageHeader>

      <EmptyState
        title="قريباً"
        description="هذه الصفحة مخصصة لإدارة التصنيفات. سيتم تفعيلها قريباً."
        icon={<Tags className="w-8 h-8 text-amber-500" />}
      />
    </div>
  );
}

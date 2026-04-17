'use client';

import PageHeader from '@/components/shared/PageHeader';
import EmptyState from '@/components/shared/EmptyState';
import { FileMinus, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function FixedExpensesPage() {
  return (
    <div className="p-6 max-w-7xl mx-auto">
      <PageHeader
        title="المصروفات الثابتة"
        description="إدارة المصروفات الدورية مثل الإيجار والكهرباء والإنترنت"
      >
        <Button className="gap-2 bg-amber-600 hover:bg-amber-700">
          <Plus className="w-4 h-4" />
          إضافة مصروف
        </Button>
      </PageHeader>

      <EmptyState
        title="قريباً"
        description="هذه الصفحة مخصصة لإدارة المصروفات الثابتة والدورية. سيتم تفعيلها قريباً."
        icon={<FileMinus className="w-8 h-8 text-amber-500" />}
      />
    </div>
  );
}

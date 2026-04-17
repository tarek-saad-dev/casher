'use client';

import PageHeader from '@/components/shared/PageHeader';
import EmptyState from '@/components/shared/EmptyState';
import { ClipboardList, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function PaymentsPage() {
  return (
    <div className="p-6 max-w-7xl mx-auto">
      <PageHeader
        title="المدفوعات والتحصيلات"
        description="إدارة المدفوعات الجزئية والتحصيلات والتسويات"
      >
        <Button className="gap-2 bg-amber-600 hover:bg-amber-700">
          <Plus className="w-4 h-4" />
          تحصيل جديد
        </Button>
      </PageHeader>

      <EmptyState
        title="قريباً"
        description="هذه الصفحة مخصصة لإدارة المدفوعات والتحصيلات. سيتم تفعيلها قريباً."
        icon={<ClipboardList className="w-8 h-8 text-amber-500" />}
      />
    </div>
  );
}

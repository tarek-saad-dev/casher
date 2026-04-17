'use client';

import PageHeader from '@/components/shared/PageHeader';
import EmptyState from '@/components/shared/EmptyState';
import { CreditCard, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function CollectionPage() {
  return (
    <div className="p-6 max-w-7xl mx-auto">
      <PageHeader
        title="تحصيل / دفعة"
        description="إدارة التحصيلات والمدفوعات الجزئية والتسويات"
      >
        <Button className="gap-2">
          <Plus className="w-4 h-4" />
          تحصيل جديد
        </Button>
      </PageHeader>

      <EmptyState
        title="قريباً"
        description="هذه الصفحة مخصصة لإدارة التحصيلات والمدفوعات الجزئية. سيتم تفعيلها قريباً."
        icon={<CreditCard className="w-8 h-8 text-amber-500" />}
      />
    </div>
  );
}

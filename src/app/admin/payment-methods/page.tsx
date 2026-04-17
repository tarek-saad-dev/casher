'use client';

import PageHeader from '@/components/shared/PageHeader';
import EmptyState from '@/components/shared/EmptyState';
import { CreditCard, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function PaymentMethodsPage() {
  return (
    <div className="p-6 max-w-7xl mx-auto">
      <PageHeader
        title="طرق الدفع"
        description="إدارة وسائل الدفع المتاحة"
      >
        <Button className="gap-2 bg-amber-600 hover:bg-amber-700">
          <Plus className="w-4 h-4" />
          طريقة جديدة
        </Button>
      </PageHeader>

      <EmptyState
        title="قريباً"
        description="هذه الصفحة مخصصة لإدارة طرق الدفع. سيتم تفعيلها قريباً."
        icon={<CreditCard className="w-8 h-8 text-amber-500" />}
      />
    </div>
  );
}

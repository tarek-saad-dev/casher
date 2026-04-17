'use client';

import PageHeader from '@/components/shared/PageHeader';
import EmptyState from '@/components/shared/EmptyState';
import { Wallet, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function AdvancesPage() {
  return (
    <div className="p-6 max-w-7xl mx-auto">
      <PageHeader
        title="السلف والخصومات"
        description="إدارة سلف وخصومات الموظفين"
      >
        <Button className="gap-2 bg-amber-600 hover:bg-amber-700">
          <Plus className="w-4 h-4" />
          سلفة جديدة
        </Button>
      </PageHeader>

      <EmptyState
        title="قريباً"
        description="هذه الصفحة مخصصة لإدارة السلف والخصومات. سيتم تفعيلها قريباً."
        icon={<Wallet className="w-8 h-8 text-amber-500" />}
      />
    </div>
  );
}

'use client';

import PageHeader from '@/components/shared/PageHeader';
import EmptyState from '@/components/shared/EmptyState';
import { Scissors, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function ServicesPage() {
  return (
    <div className="p-6 max-w-7xl mx-auto">
      <PageHeader
        title="الخدمات"
        description="إدارة الخدمات والأسعار والتصنيفات"
      >
        <Button className="gap-2 bg-amber-600 hover:bg-amber-700">
          <Plus className="w-4 h-4" />
          خدمة جديدة
        </Button>
      </PageHeader>

      <EmptyState
        title="قريباً"
        description="هذه الصفحة مخصصة لإدارة الخدمات. سيتم تفعيلها قريباً."
        icon={<Scissors className="w-8 h-8 text-amber-500" />}
      />
    </div>
  );
}

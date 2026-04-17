'use client';

import PageHeader from '@/components/shared/PageHeader';
import EmptyState from '@/components/shared/EmptyState';
import { Users, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function EmployeesPage() {
  return (
    <div className="p-6 max-w-7xl mx-auto">
      <PageHeader
        title="الموظفون"
        description="إدارة موظفي الصالون والحلاقين"
      >
        <Button className="gap-2 bg-amber-600 hover:bg-amber-700">
          <Plus className="w-4 h-4" />
          موظف جديد
        </Button>
      </PageHeader>

      <EmptyState
        title="قريباً"
        description="هذه الصفحة مخصصة لإدارة الموظفين. سيتم تفعيلها قريباً."
        icon={<Users className="w-8 h-8 text-amber-500" />}
      />
    </div>
  );
}

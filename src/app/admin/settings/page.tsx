'use client';

import PageHeader from '@/components/shared/PageHeader';
import EmptyState from '@/components/shared/EmptyState';
import { Settings, Save } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function SettingsPage() {
  return (
    <div className="p-6 max-w-7xl mx-auto">
      <PageHeader
        title="الإعدادات العامة"
        description="إعدادات النظام والصلاحيات والتفضيلات"
      >
        <Button className="gap-2 bg-amber-600 hover:bg-amber-700">
          <Save className="w-4 h-4" />
          حفظ التغييرات
        </Button>
      </PageHeader>

      <EmptyState
        title="قريباً"
        description="هذه الصفحة مخصصة للإعدادات العامة. سيتم تفعيلها قريباً."
        icon={<Settings className="w-8 h-8 text-amber-500" />}
      />
    </div>
  );
}

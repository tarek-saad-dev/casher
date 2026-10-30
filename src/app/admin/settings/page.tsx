'use client';

import PageHeader from '@/components/shared/PageHeader';
import ThemeSwitcher from '@/components/theme/ThemeSwitcher';
import { Settings, Printer, ArrowLeft } from 'lucide-react';
import Link from 'next/link';

export default function SettingsPage() {
  return (
    <div className="p-6 max-w-7xl mx-auto">
      <PageHeader
        title="الإعدادات العامة"
        description="إعدادات النظام والصلاحيات والتفضيلات"
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <section className="rounded-2xl border border-border bg-surface p-5">
          <div className="mb-4 flex items-center gap-2">
            <Settings className="h-5 w-5 text-primary" />
            <h2 className="text-base font-semibold text-foreground">المظهر والألوان</h2>
          </div>
          <ThemeSwitcher variant="segmented" />
        </section>
        <Link href="/admin/settings/printing" className="group rounded-2xl border border-border bg-surface p-5 transition-colors hover:border-primary/50">
          <div className="mb-4 flex items-center gap-2">
            <Printer className="h-5 w-5 text-primary" />
            <h2 className="text-base font-semibold text-foreground">إدارة الطباعة</h2>
          </div>
          <p className="text-sm text-muted-foreground">تشغيل وإيقاف الإيصالات، القص التلقائي، وفحص الطابعة على الجهاز الحالي.</p>
          <span className="mt-4 inline-flex items-center gap-2 text-xs text-primary">فتح الإعدادات <ArrowLeft className="h-3.5 w-3.5" /></span>
        </Link>
      </div>
    </div>
  );
}

'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import PageHeader from '@/components/shared/PageHeader';

const STEPS = [
  { label: 'Identity', href: null },
  { label: 'Contact and location', href: null },
  { label: 'Operating hours', href: null },
  { label: 'Services and prices', href: null },
  { label: 'Treasury / payment methods', href: null },
  { label: 'Inventory setup', href: 'opening-inventory' },
  { label: 'Employees', href: 'employees' },
  { label: 'Payroll and target plans', href: 'employees' },
  { label: 'Booking and queue', href: null },
  { label: 'Printing and notifications', href: null },
  { label: 'Review / readiness', href: 'readiness' },
];

export default function BranchSetupPage() {
  const params = useParams<{ id: string }>();
  const branchId = params.id;

  return (
    <div className="mx-auto max-w-3xl p-6" dir="rtl">
      <PageHeader
        title="إعداد الفرع"
        description="معالج الإعداد — الفرع يبقى SETUP حتى تمر الجاهزية والتحويل من الخادم"
      />
      <p className="mt-2 text-sm text-muted-foreground">BranchID: {branchId}</p>

      <ol className="mt-6 list-decimal space-y-2 pr-5 text-sm">
        {STEPS.map((step) => (
          <li key={step.label} className="rounded-lg border border-border/60 bg-surface px-3 py-2">
            {step.href === 'readiness' ? (
              <Link className="text-primary underline" href={`/admin/branches/${branchId}/readiness`}>
                {step.label}
              </Link>
            ) : step.href ? (
              <Link
                className="text-primary underline"
                href={`/admin/branches/${branchId}/setup/${step.href}`}
              >
                {step.label}
              </Link>
            ) : (
              step.label
            )}
          </li>
        ))}
      </ol>

      <div className="mt-6 flex flex-wrap gap-3">
        <Link
          href={`/admin/branches/${branchId}/readiness`}
          className="rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground"
        >
          فتح الجاهزية
        </Link>
        <Link
          href={`/admin/branches/${branchId}/setup/employees`}
          className="rounded-xl border border-border px-4 py-2 text-sm"
        >
          معالج الموظفين
        </Link>
        <Link
          href={`/admin/branches/${branchId}/setup/opening-inventory`}
          className="rounded-xl border border-border px-4 py-2 text-sm"
        >
          المخزون الافتتاحي
        </Link>
        <Link href="/admin/branches" className="rounded-xl border border-border px-4 py-2 text-sm">
          قائمة الفروع
        </Link>
        <Link href="/admin/branches/new" className="rounded-xl border border-border px-4 py-2 text-sm">
          إنشاء فرع آخر في SETUP
        </Link>
      </div>
    </div>
  );
}

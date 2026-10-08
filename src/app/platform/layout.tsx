import Link from 'next/link';
import { redirect } from 'next/navigation';
import { NextResponse } from 'next/server';
import { requirePlatformOperator } from '@/lib/api-auth';

export const dynamic = 'force-dynamic';

/**
 * Operator console shell. Server-side gate uses the same rule as /api/admin/platform/**
 * (super_admin + platform-tenant membership); every API call re-checks it.
 */
export default async function PlatformLayout({ children }: { children: React.ReactNode }) {
  const auth = await requirePlatformOperator();
  if (auth instanceof NextResponse) {
    redirect(auth.status === 401 ? '/login' : '/403');
  }

  return (
    <div className="mx-auto w-full max-w-6xl p-4 md:p-6 space-y-4" dir="rtl">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-3">
        <div>
          <h1 className="text-xl font-bold">لوحة مشغل المنصة</h1>
          <p className="text-xs text-muted-foreground">DRVOERP — إدارة المنشآت والاشتراكات والتطبيقات</p>
        </div>
        <nav className="flex gap-2 text-sm">
          <Link href="/platform" className="rounded-lg border border-border px-3 py-1.5 hover:bg-muted">
            المنشآت
          </Link>
          <Link
            href="/platform/tenants/new"
            className="rounded-lg bg-primary px-3 py-1.5 text-primary-foreground hover:opacity-90"
          >
            منشأة جديدة
          </Link>
        </nav>
      </header>
      {children}
    </div>
  );
}

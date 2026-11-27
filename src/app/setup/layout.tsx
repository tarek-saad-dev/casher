import { redirect } from 'next/navigation';
import Link from 'next/link';
import { isAuthResult, requireAdmin } from '@/lib/api-auth';

import { isPublicSalonSetupTenant } from '@/platform/onboarding/selfServiceEligibility';

export const dynamic = 'force-dynamic';

/** The proxy is only a cookie pre-gate; verify the current tenant/role on the server. */
export default async function SetupLayout({ children }: { children: React.ReactNode }) {
  const auth = await requireAdmin();
  if (!isAuthResult(auth)) {
    if (auth.status === 401) redirect('/login');
    redirect('/403');
  }
  if (!(await isPublicSalonSetupTenant(auth.tenantId, auth.tenant.tenantCode))) redirect('/403');
  return <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-background">
    <nav dir="rtl" aria-label="اختصارات تجهيز المنشأة" className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border bg-card px-4 py-2 text-xs text-foreground">
      <Link href="/setup" className="font-black text-primary">رحلة التجهيز</Link>
      <Link href="/setup/identity" className="rounded-lg border border-border px-3 py-1.5 font-bold">هوية المنشأة</Link>
      <Link href="/setup/operating" className="rounded-lg border border-border px-3 py-1.5 font-bold">إعدادات التشغيل</Link>
      <Link href="/setup/training" className="rounded-lg border border-primary/30 bg-primary-soft px-3 py-1.5 font-bold text-primary">مساحة التدريب</Link>
    </nav>
    {children}
  </div>;
}

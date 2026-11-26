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
  return <div className="flex min-h-0 flex-1 flex-col overflow-hidden"><div dir="rtl" className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 py-2 text-xs text-[#102433]"><span className="font-bold">تخصيص منشأتك</span><Link href="/setup/identity" className="rounded-lg border border-teal-200 bg-teal-50 px-3 py-1.5 font-bold text-teal-800">الاسم والشعار والألوان</Link></div>{children}</div>;
}

import { redirect } from 'next/navigation';
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
  return <>{children}</>;
}

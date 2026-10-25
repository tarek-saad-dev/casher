import { redirect } from 'next/navigation';
import { isAuthResult, requireAdmin } from '@/lib/api-auth';
import AppManagerClient from '@/components/tenant/AppManagerClient';

export const dynamic = 'force-dynamic';

/** Tenant-owner/admin UI. The API independently revalidates role and tenant. */
export default async function TenantAppsPage() {
  const auth = await requireAdmin();
  if (!isAuthResult(auth)) redirect('/403');
  return <AppManagerClient />;
}

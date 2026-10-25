import { redirect } from 'next/navigation';
import { NextResponse } from 'next/server';
import { requireTenantBillingAdmin } from '@/platform/commercial/tenantBillingAuth';
import TenantBillingClient from '@/components/tenant/TenantBillingClient';

export const dynamic = 'force-dynamic';
export default async function BillingPage() {
  const auth = await requireTenantBillingAdmin();
  if (auth instanceof NextResponse) redirect(auth.status === 401 ? '/login' : '/403');
  return <TenantBillingClient />;
}

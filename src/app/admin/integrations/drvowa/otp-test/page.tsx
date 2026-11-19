import { notFound, redirect } from 'next/navigation';

import { isAuthResult, requireAdmin } from '@/lib/api-auth';
import { isDrvowaOwnerTenant } from '@/lib/integrations/drvowaTenant';
import { DrvowaOtpTest } from '@/components/admin/DrvowaOtpTest';

export default async function DrvowaOtpTestPage() {
  const auth = await requireAdmin();
  if (!isAuthResult(auth)) redirect('/login');
  if (!(await isDrvowaOwnerTenant(auth.tenantId))) notFound();

  return (
    <main className="mx-auto w-full max-w-3xl space-y-6 p-4 sm:p-6" dir="rtl">
      <DrvowaOtpTest />
    </main>
  );
}

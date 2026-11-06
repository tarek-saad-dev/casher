import { redirect } from 'next/navigation';
import { getEmployeePortalIdentity } from '@/lib/employee-portal/auth';
import EmployeePortalShell from '@/components/employee-portal/EmployeePortalShell';
import PasswordChangeForm from './password-change-form';

export const dynamic = 'force-dynamic';

export default async function PasswordChangePage() {
  const identity = await getEmployeePortalIdentity();
  if (!identity) redirect('/employee-portal');

  if (identity.mustChangePassword) {
    return (
      <main dir="rtl" className="flex h-full min-h-0 flex-col overflow-y-auto bg-zinc-950 text-white">
        <PasswordChangeForm forced />
      </main>
    );
  }

  return (
    <EmployeePortalShell>
      <PasswordChangeForm forced={false} />
    </EmployeePortalShell>
  );
}

import { redirect } from 'next/navigation';
import { getEmployeePortalIdentity } from '@/lib/employee-portal/auth';
import PasswordChangeForm from './password-change-form';
export const dynamic = 'force-dynamic';
export default async function PasswordChangePage() {
  const identity = await getEmployeePortalIdentity();
  if (!identity) redirect('/employee-portal');
  return <PasswordChangeForm forced={identity.mustChangePassword} />;
}

import { redirect } from 'next/navigation';
import { isAuthResult, requireAdmin } from '@/lib/api-auth';

export const dynamic = 'force-dynamic';

/** The proxy is only a cookie pre-gate; verify the current tenant/role on the server. */
export default async function SetupLayout({ children }: { children: React.ReactNode }) {
  const auth = await requireAdmin();
  if (!isAuthResult(auth)) redirect('/login');
  return <>{children}</>;
}

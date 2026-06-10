import { redirect } from 'next/navigation';
import { getSession } from '@/lib/session';
import { getUserAccess } from '@/lib/permissions-server';

interface Props {
  requiredPagePath: string;
  children: React.ReactNode;
}

/**
 * Server Component guard.
 * Usage: wrap page content with <PageGuard requiredPagePath="/treasury/daily">
 * If user lacks access → redirect to /403
 */
export default async function PageGuard({ requiredPagePath, children }: Props) {
  const session = await getSession();
  if (!session) redirect('/login');

  const access = await getUserAccess(session.UserID, session.UserName, session.UserLevel);

  // super_admin always passes
  if (access.isSuperAdmin) return <>{children}</>;

  const clean = requiredPagePath.replace(/\/$/, '') || '/';
  const allowed = access.allowedPagePaths.some((p: string) => {
    const np = p.replace(/\/$/, '') || '/';
    return clean === np || clean.startsWith(np + '/');
  });

  if (!allowed) redirect('/403');
  return <>{children}</>;
}

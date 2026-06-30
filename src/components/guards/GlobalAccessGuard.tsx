import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { getSession } from '@/lib/session';
import { getUserAccess } from '@/lib/permissions-server';
import { canPartnerAccessPath } from '@/lib/partnerAccess';

const PARTNER_EXEMPT_PATHS = new Set(['/login', '/403']);

/**
 * Server-side guard for partner-only users.
 * Blocks page navigation outside the partners report before client layout renders.
 */
export default async function GlobalAccessGuard({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSession();
  if (!session) return <>{children}</>;

  const headersList = await headers();
  const pathname = headersList.get('x-pathname') ?? '';

  if (!pathname || PARTNER_EXEMPT_PATHS.has(pathname)) {
    return <>{children}</>;
  }

  const access = await getUserAccess(
    session.UserID,
    session.UserName,
    session.UserLevel
  );

  if (!access.isPartnerOnly) return <>{children}</>;

  if (!canPartnerAccessPath(pathname)) {
    redirect('/403');
  }

  return <>{children}</>;
}

import { redirect } from 'next/navigation';
import { getSession } from '@/lib/session';
import { getUserAccess } from '@/lib/permissions-server';

export default async function RootPage() {
  // Read-only: never mutates cookies. Legacy/invalid cookies return null.
  const session = await getSession();
  if (!session) {
    redirect('/login?reason=session-expired');
  }

  const access = await getUserAccess(
    session.UserID,
    session.UserName,
    session.UserLevel
  );

  redirect(access.defaultLandingPath);
}

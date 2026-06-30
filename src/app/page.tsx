import { redirect } from 'next/navigation';
import { getSession } from '@/lib/session';
import { getUserAccess } from '@/lib/permissions-server';

export default async function RootPage() {
  const session = await getSession();
  if (!session) {
    redirect('/login');
  }

  const access = await getUserAccess(
    session.UserID,
    session.UserName,
    session.UserLevel
  );

  redirect(access.defaultLandingPath);
}

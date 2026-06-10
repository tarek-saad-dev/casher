import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { getUserAccess } from '@/lib/permissions-server';

export const runtime = 'nodejs';

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'غير مصرح' }, { status: 401 });

  const access = await getUserAccess(session.UserID, session.UserName, session.UserLevel);
  return NextResponse.json(access);
}

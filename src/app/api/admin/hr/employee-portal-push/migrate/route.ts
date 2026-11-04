import { NextRequest, NextResponse } from 'next/server';
import { isAuthResult, requirePageAccess } from '@/lib/api-auth';
import { ensureEmployeePortalPushTable } from '@/lib/employee-portal/pushSubscriptions';

export const runtime = 'nodejs';

/** POST /api/admin/hr/employee-portal-push/migrate — idempotent push subscription table. */
export async function POST(request: NextRequest) {
  const setupSecret = request.headers.get('x-admin-setup-secret');
  if (setupSecret !== process.env.ADMIN_SETUP_SECRET) {
    const auth = await requirePageAccess('/admin/hr');
    if (!isAuthResult(auth)) return auth;
  }

  try {
    await ensureEmployeePortalPushTable();
    return NextResponse.json({ success: true, table: 'TblEmployeePortalPushSubscription' });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[employee-portal-push/migrate]', message);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

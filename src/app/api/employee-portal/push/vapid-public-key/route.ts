import { NextResponse } from 'next/server';
import { getEmployeePortalIdentity } from '@/lib/employee-portal/auth';
import { getVapidPublicKey } from '@/lib/employee-portal/vapid';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const identity = await getEmployeePortalIdentity();
  if (!identity) {
    return NextResponse.json({ error: 'غير مصرح' }, { status: 401 });
  }

  const publicKey = getVapidPublicKey();
  if (!publicKey) {
    return NextResponse.json({ error: 'إشعارات الدفع غير مهيأة' }, { status: 503 });
  }
  return NextResponse.json({ publicKey });
}

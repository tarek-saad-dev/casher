import { NextResponse } from 'next/server';
import { isAuthResult, requirePlatformOperator } from '@/lib/api-auth';
import { getPool } from '@/lib/db';
import { listPlans } from '@/platform/commercial/planRepository';

export const runtime = 'nodejs';

/** GET /api/admin/platform/plans — commercial plans (limits are provisional, editable data). */
export async function GET() {
  const auth = await requirePlatformOperator();
  if (!isAuthResult(auth)) return auth;

  const plans = await listPlans(await getPool());
  return NextResponse.json({ plans });
}

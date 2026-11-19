import { NextResponse } from 'next/server';
import { z } from 'zod';

import { isAuthResult, requireAdmin } from '@/lib/api-auth';
import { callDrvowaOtpForAdminTest } from '@/lib/integrations/drvowaOtpTest';
import { isDrvowaOwnerTenant } from '@/lib/integrations/drvowaTenant';

export const runtime = 'nodejs';

const schema = z.object({
  phone: z.string().trim().min(8).max(32),
  requestId: z.string().uuid(),
  confirmedOwnNumber: z.literal(true),
}).strict();

export async function POST(request: Request) {
  const auth = await requireAdmin();
  if (!isAuthResult(auth)) return auth;
  if (!(await isDrvowaOwnerTenant(auth.tenantId))) {
    return NextResponse.json({ ok: false, code: 'FORBIDDEN' }, { status: 403 });
  }
  const data = schema.safeParse(await request.json().catch(() => null));
  if (!data.success) {
    return NextResponse.json({ ok: false, code: 'INVALID_INPUT' }, { status: 400 });
  }
  const result = await callDrvowaOtpForAdminTest('send', {
    phone: data.data.phone,
    purpose: 'CUT_CLUB_SIGNUP',
    requestId: data.data.requestId,
  });
  return NextResponse.json(result.body, { status: result.status });
}

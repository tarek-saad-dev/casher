import { NextRequest, NextResponse } from 'next/server';
import { getEmployeePortalIdentity } from '@/lib/employee-portal/auth';
import { AddonGuardError, previewAddon, reserveAddon } from '@/lib/employee-portal/bookingAddonAvailability';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
type Ctx = { params: Promise<{ id: string }> };

async function actor(context: Ctx) {
  const identity = await getEmployeePortalIdentity();
  if (!identity || identity.mustChangePassword) return null;
  const { id } = await context.params;
  const bookingId = Number(id);
  if (!Number.isInteger(bookingId) || bookingId <= 0) return null;
  return { bookingId, empId: identity.empId, tenantId: identity.tenantId };
}

export async function GET(req: NextRequest, context: Ctx) {
  const user = await actor(context);
  if (!user) return NextResponse.json({ error: 'غير مصرح' }, { status: 401 });
  const proId = Number(req.nextUrl.searchParams.get('proId'));
  try {
    const preview = await previewAddon({ ...user, proId });
    return NextResponse.json(preview, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    if (error instanceof AddonGuardError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error('[staff-addon-preview]', error instanceof Error ? error.message : error);
    return NextResponse.json({ error: 'تعذر فحص التوافر — توجه للكاشير' }, { status: 503 });
  }
}
export async function POST(req: NextRequest, context: Ctx) {
  const user = await actor(context);
  if (!user) return NextResponse.json({ error: 'غير مصرح' }, { status: 401 });
  const body = (await req.json().catch(() => null)) as
    | { proId?: unknown; expectedEndAt?: unknown }
    | null;
  if (!body || typeof body.expectedEndAt !== 'string') {
    return NextResponse.json({ error: 'افحص توافر الوقت أولاً' }, { status: 400 });
  }
  const result = await reserveAddon({
    ...user,
    proId: Number(body.proId),
    expectedEndAt: body.expectedEndAt,
  });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json(result);
}

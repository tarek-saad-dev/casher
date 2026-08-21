/**
 * Internal flagged V2 availability probe — NOT for cutsaloon / operations cutover.
 *
 * GET/POST /api/admin/booking/v2/availability
 * Requires BOOKING_V2_INTERNAL_API=1 (or non-production) + admin session branch.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireActiveBranchContext, isActiveBranchContext } from '@/lib/branch/context';

export const runtime = 'nodejs';

function allowed(): boolean {
  if (process.env.BOOKING_V2_INTERNAL_API === '1') return true;
  if (process.env.NODE_ENV !== 'production') return true;
  return false;
}

async function handle(req: NextRequest) {
  if (!allowed()) {
    return NextResponse.json({ ok: false, error: 'V2_INTERNAL_DISABLED' }, { status: 404 });
  }

  const branchCtx = await requireActiveBranchContext();
  if (!isActiveBranchContext(branchCtx)) return branchCtx;

  let body: Record<string, unknown> = {};
  if (req.method === 'POST') {
    try {
      body = (await req.json()) as Record<string, unknown>;
    } catch {
      body = {};
    }
  }
  const sp = new URL(req.url).searchParams;
  const get = (k: string) =>
    (body[k] != null ? String(body[k]) : null) ?? sp.get(k);

  const date = get('date') ?? get('businessDate');
  const to = get('to') ?? date;
  const durationMinutes = Number(get('durationMinutes') ?? get('duration') ?? 30);
  const slotIntervalMinutes = Number(get('slotIntervalMinutes') ?? 15);
  const empRaw = get('empId') ?? get('employeeIds');
  const employeeIds = empRaw
    ? String(empRaw)
        .split(',')
        .map((x) => Number(x.trim()))
        .filter((n) => Number.isInteger(n) && n > 0)
    : [];

  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ ok: false, error: 'INVALID_DATE' }, { status: 400 });
  }
  if (!employeeIds.length) {
    return NextResponse.json({ ok: false, error: 'EMPLOYEE_IDS_REQUIRED' }, { status: 400 });
  }

  const { resolveBookingAvailabilityV2 } = await import(
    '@/lib/booking/projection/resolveBookingAvailabilityV2Live'
  );
  const result = await resolveBookingAvailabilityV2({
    employeeIds,
    branchIds: [branchCtx.branchId],
    businessDateRange: { from: date, to: to && /^\d{4}-\d{2}-\d{2}$/.test(to) ? to : date },
    durationMinutes,
    slotIntervalMinutes,
    source: 'admin',
  });

  return NextResponse.json({
    ok: true,
    contract: 'booking-v2-availability-internal',
    cutover: false,
    readMode: process.env.BOOKING_V2_READ_MODE ?? 'shadow',
    canaryPercent: Number(process.env.BOOKING_V2_READ_CANARY_PERCENT ?? '10'),
    branchId: branchCtx.branchId,
    durationMinutes,
    slotIntervalMinutes,
    queryCount: result.queryCount,
    dbMs: Math.round(result.dbMs),
    composeMs: Number(result.composeMs.toFixed(3)),
    totalMs: Number(result.totalMs.toFixed(3)),
    days: result.days.map((d) => ({
      employeeId: d.employeeId,
      branchId: d.branchId,
      businessDate: d.businessDate,
      availabilityRevision: d.availabilityRevision,
      changeMask: d.changeMask,
      reusedBaseline: d.reusedBaseline,
      availableStarts: d.availableStarts.map((s) => ({
        time: s.time,
        dayOffset: s.dayOffset,
        startMin: s.startMin,
      })),
      freeRangeCount: d.freeRanges.length,
    })),
  });
}

export async function GET(req: NextRequest) {
  return handle(req);
}

export async function POST(req: NextRequest) {
  return handle(req);
}

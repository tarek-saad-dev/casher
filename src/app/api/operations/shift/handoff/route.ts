import { NextRequest, NextResponse } from 'next/server';
import { hasPermission } from '@/lib/permissions';
import { getSession } from '@/lib/session';
import { branchErrorResponse } from '@/lib/branch/operationalGates';
import { handoffShift } from '@/lib/branch/shiftSession';
import { loadOperationalBootstrap } from '@/modules/operations/application/loadOperationalBootstrap';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/operations/shift/handoff
 * Atomically close the caller's OPEN shift and open a new one on targetBranchId.
 * Body: { targetBranchId, shiftId } — shiftId is the shift definition, not TblShiftMove.ID.
 * Server derives userId, current shift, current branch, and target BusinessDay.
 */
export async function POST(req: NextRequest) {
  try {
    const user = await getSession();
    if (!user || !hasPermission(user.UserLevel, 'shift.open')) {
      return NextResponse.json(
        { error: 'غير مصرح — لا تملك صلاحية نقل الوردية', code: 'FORBIDDEN' },
        { status: 403 },
      );
    }

    let body: Record<string, unknown> = {};
    try {
      body = (await req.json()) as Record<string, unknown>;
    } catch {
      return NextResponse.json(
        { error: 'جسم الطلب غير صالح', code: 'INVALID_BODY' },
        { status: 400 },
      );
    }

    const targetBranchId = Number(body.targetBranchId);
    const shiftId = Number(body.shiftId);
    if (!Number.isFinite(targetBranchId) || targetBranchId <= 0) {
      return NextResponse.json(
        { error: 'يجب تحديد الفرع الهدف', code: 'INVALID_BRANCH' },
        { status: 400 },
      );
    }
    if (!Number.isFinite(shiftId) || shiftId <= 0) {
      return NextResponse.json(
        { error: 'يجب تحديد الوردية', code: 'INVALID_SHIFT' },
        { status: 400 },
      );
    }

    const newShift = await handoffShift({
      userId: user.UserID,
      targetBranchId,
      shiftId,
    });

    const boot = await loadOperationalBootstrap({ user });

    return NextResponse.json({
      ok: true,
      shift: {
        ID: newShift.id,
        NewDay: newShift.newDay,
        UserID: newShift.userId,
        ShiftID: newShift.shiftId,
        StartDate: newShift.startDate,
        StartTime: newShift.startTime,
        Status: newShift.status,
        BranchID: newShift.branchId,
        BusinessDayID: newShift.businessDayId,
      },
      bootstrap: boot.ok ? boot.data : null,
    });
  } catch (err: unknown) {
    const mapped = branchErrorResponse(err);
    if (mapped) return mapped;
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[api/operations/shift/handoff] error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

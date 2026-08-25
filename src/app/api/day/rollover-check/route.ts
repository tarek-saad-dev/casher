import { NextResponse } from 'next/server';
import {
  getOpenBusinessDay,
  isActiveBranchContext,
  listOpenShiftsForBranch,
  requireActiveBranchContext,
} from '@/lib/branch';
import { branchErrorResponse } from '@/lib/branch/operationalGates';
import {
  isPastRolloverWindow,
  resolveBusinessDate,
} from '@/modules/operations/clock/BusinessClock';
import { ensureBusinessDayCurrent } from '@/modules/operations/application/reconcileBusinessDay';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET /api/day/rollover-check — stale vs BusinessClock expected date (active branch)
export async function GET() {
  try {
    const branch = await requireActiveBranchContext();
    if (!isActiveBranchContext(branch)) return branch;

    const catchUp = await ensureBusinessDayCurrent(branch.branchId, {
      mode: 'BEST_EFFORT',
      trigger: 'BEST_EFFORT_CATCH_UP',
    });

    const openDay = await getOpenBusinessDay(branch.branchId);
    const expectedDate = resolveBusinessDate(branch);
    const pastRolloverWindow = isPastRolloverWindow(branch);

    if (!openDay) {
      return NextResponse.json({
        needsRollover: false,
        isStale: catchUp.stale === true,
        hasOpenDay: false,
        openDay: null,
        openDayDate: null,
        todayDate: expectedDate,
        expectedBusinessDate: expectedDate,
        pastRolloverWindow,
        reconciliationAction: catchUp.action,
        reconciliationError: catchUp.error ?? null,
        openShifts: [],
        branchId: branch.branchId,
        branchCode: branch.branchCode,
      });
    }

    const openDayDate = openDay.newDay.slice(0, 10);
    const isStale = openDayDate < expectedDate;

    const branchOpenShifts = await listOpenShiftsForBranch(branch.branchId);
    const openShifts = branchOpenShifts.map((sm) => ({
      ID: sm.id,
      UserID: sm.userId,
      ShiftID: sm.shiftId,
      StartTime: sm.startTime,
      UserName: sm.userName,
      ShiftName: sm.shiftName,
    }));

    return NextResponse.json({
      needsRollover: isStale,
      isStale,
      hasOpenDay: true,
      openDay: { ID: openDay.id, NewDay: openDay.newDay, Status: openDay.status ? 1 : 0 },
      openDayDate,
      todayDate: expectedDate,
      expectedBusinessDate: expectedDate,
      pastRolloverWindow,
      reconciliationAction: catchUp.action,
      reconciliationError: catchUp.error ?? null,
      openShifts,
      branchId: branch.branchId,
      branchCode: branch.branchCode,
    });
  } catch (err: unknown) {
    const mapped = branchErrorResponse(err);
    if (mapped) return mapped;
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[api/day/rollover-check] error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

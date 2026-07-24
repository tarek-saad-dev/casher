import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import {
  getUserOpenShiftForBranch,
  isActiveBranchContext,
  requireActiveBranchContext,
} from '@/lib/branch';

// GET /api/shift — open shift for authenticated user on the active branch only
export async function GET() {
  try {
    const user = await getSession();
    if (!user) {
      return NextResponse.json({ shift: null });
    }

    const branch = await requireActiveBranchContext();
    if (!isActiveBranchContext(branch)) return branch;

    const openShift = await getUserOpenShiftForBranch(user.UserID, branch.branchId);
    if (!openShift) {
      return NextResponse.json({ shift: null });
    }

    return NextResponse.json({
      shift: {
        ID: openShift.id,
        NewDay: openShift.newDay,
        UserID: openShift.userId,
        ShiftID: openShift.shiftId,
        StartDate: openShift.startDate,
        StartTime: openShift.startTime,
        EndDate: openShift.endDate,
        EndTime: openShift.endTime,
        Status: openShift.status ? 1 : 0,
        UserName: openShift.userName,
        ShiftName: openShift.shiftName,
      },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[api/shift] GET error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

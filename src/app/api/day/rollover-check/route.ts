import { NextResponse } from 'next/server';
import {
  getOpenBusinessDay,
  isActiveBranchContext,
  listOpenShiftsForBranch,
  requireActiveBranchContext,
} from '@/lib/branch';
import { getPool } from '@/lib/db';

// GET /api/day/rollover-check — Check if active-branch open day is stale vs today
export async function GET() {
  try {
    const branch = await requireActiveBranchContext();
    if (!isActiveBranchContext(branch)) return branch;

    const openDay = await getOpenBusinessDay(branch.branchId);

    if (!openDay) {
      return NextResponse.json({
        needsRollover: false,
        isStale: false,
        hasOpenDay: false,
        openDay: null,
        openDayDate: null,
        todayDate: null,
        openShifts: [],
        branchId: branch.branchId,
        branchCode: branch.branchCode,
      });
    }

    const openDayDate = openDay.newDay.slice(0, 10);

    const db = await getPool();
    const todayResult = await db.request().query(`SELECT CAST(GETDATE() AS DATE) AS today`);
    const todayDate = new Date(todayResult.recordset[0].today).toISOString().split('T')[0];

    const isStale = openDayDate < todayDate;

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
      todayDate,
      openShifts,
      branchId: branch.branchId,
      branchCode: branch.branchCode,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[api/day/rollover-check] error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

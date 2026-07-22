import { NextRequest, NextResponse } from 'next/server';
import { hasPermission } from '@/lib/permissions';
import { getSession } from '@/lib/session';
import {
  branchErrorResponse,
  requireBranchOperatorContext,
} from '@/lib/branch/operationalGates';
import { isActiveBranchContext } from '@/lib/branch/context';
import { openShift } from '@/lib/branch/shiftSession';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// POST /api/shift/open — Open a shift for the active branch day
export async function POST(req: NextRequest) {
  try {
    const user = await getSession();
    if (!user || !hasPermission(user.UserLevel, 'shift.open')) {
      return NextResponse.json({ error: 'غير مصرح — لا تملك صلاحية فتح وردية' }, { status: 403 });
    }

    const body = await req.json();
    // Ignore any client-supplied branchId — active branch comes from session only.
    const shiftID: number = body.shiftID;
    if (!shiftID) {
      return NextResponse.json({ error: 'يجب تحديد الوردية' }, { status: 400 });
    }

    const branch = await requireBranchOperatorContext();
    if (!isActiveBranchContext(branch)) return branch;

    const newShift = await openShift(branch, user.UserID, shiftID);
    console.log(
      `[shift] Opened shift: ID=${newShift.id}, Branch=${branch.branchCode}, ShiftID=${shiftID}, UserID=${user.UserID}, Day=${newShift.newDay}`,
    );

    return NextResponse.json(
      {
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
          BranchCode: branch.branchCode,
        },
      },
      { status: 201 },
    );
  } catch (err: unknown) {
    const mapped = branchErrorResponse(err);
    if (mapped) return mapped;
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[api/shift/open] error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

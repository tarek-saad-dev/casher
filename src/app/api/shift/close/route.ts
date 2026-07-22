import { NextRequest, NextResponse } from 'next/server';
import { hasPermission } from '@/lib/permissions';
import { getSession } from '@/lib/session';
import {
  branchErrorResponse,
  requireBranchOperatorContext,
} from '@/lib/branch/operationalGates';
import { isActiveBranchContext } from '@/lib/branch/context';
import { closeShift } from '@/lib/branch/shiftSession';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// POST /api/shift/close — Close a shift belonging to the active branch
export async function POST(req: NextRequest) {
  try {
    const user = await getSession();
    if (!user || !hasPermission(user.UserLevel, 'shift.close')) {
      return NextResponse.json({ error: 'غير مصرح — لا تملك صلاحية إغلاق الوردية' }, { status: 403 });
    }

    const body = await req.json();
    const shiftMoveID: number = body.shiftMoveID;
    if (!shiftMoveID) {
      return NextResponse.json({ error: 'Missing shiftMoveID' }, { status: 400 });
    }

    const branch = await requireBranchOperatorContext();
    if (!isActiveBranchContext(branch)) return branch;

    const closed = await closeShift(branch, shiftMoveID);
    console.log(
      `[shift] Closed shift: ID=${shiftMoveID}, Branch=${branch.branchCode}, by ${user.UserName}`,
    );

    return NextResponse.json({
      ok: true,
      shiftMoveID: closed.id,
      BranchID: closed.branchId,
      BranchCode: branch.branchCode,
      BusinessDayID: closed.businessDayId,
    });
  } catch (err: unknown) {
    const mapped = branchErrorResponse(err);
    if (mapped) return mapped;
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[api/shift/close] error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

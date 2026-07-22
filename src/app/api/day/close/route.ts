import { NextRequest, NextResponse } from 'next/server';
import { hasPermission } from '@/lib/permissions';
import { getSession } from '@/lib/session';
import {
  branchErrorResponse,
  requireBranchOperatorContext,
} from '@/lib/branch/operationalGates';
import { isActiveBranchContext } from '@/lib/branch/context';
import { closeBusinessDay } from '@/lib/branch/businessDay';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// POST /api/day/close — Close the active branch business day
// Body: { forceCloseShifts?: boolean }
export async function POST(req: NextRequest) {
  try {
    const user = await getSession();
    if (!user || !hasPermission(user.UserLevel, 'day.close')) {
      return NextResponse.json({ error: 'غير مصرح — لا تملك صلاحية إغلاق يوم العمل' }, { status: 403 });
    }

    let forceCloseShifts = false;
    try {
      const body = await req.json();
      forceCloseShifts = !!body?.forceCloseShifts;
    } catch {
      // No body
    }

    const branch = await requireBranchOperatorContext();
    if (!isActiveBranchContext(branch)) return branch;

    try {
      const result = await closeBusinessDay(branch, { forceCloseShifts });
      console.log(
        `[day] Closed branch day: ID=${result.day.id}, Branch=${branch.branchCode}, forceCloseShifts=${forceCloseShifts}, by ${user.UserName}`,
      );
      return NextResponse.json({
        ok: true,
        dayID: result.day.id,
        BranchID: branch.branchId,
        BranchCode: branch.branchCode,
        closedShifts: result.closedShifts,
      });
    } catch (err: unknown) {
      const mapped = branchErrorResponse(err);
      if (mapped) {
        // Preserve OPEN_SHIFTS code for UI
        if (
          typeof err === 'object' &&
          err &&
          (err as { openShifts?: unknown[] }).openShifts
        ) {
          const body = await mapped.json();
          return NextResponse.json(
            { ...body, code: body.code === 'OPERATION_NOT_ALLOWED' ? 'OPEN_SHIFTS' : body.code },
            { status: mapped.status },
          );
        }
        return mapped;
      }
      throw err;
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[api/day/close] error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

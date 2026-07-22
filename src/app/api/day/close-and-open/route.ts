import { NextRequest, NextResponse } from 'next/server';
import { hasPermission } from '@/lib/permissions';
import { getSession } from '@/lib/session';
import {
  branchErrorResponse,
  requireBranchOperatorContext,
} from '@/lib/branch/operationalGates';
import { isActiveBranchContext } from '@/lib/branch/context';
import { closeAndOpenBusinessDay } from '@/lib/branch/businessDay';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// POST /api/day/close-and-open — Close active branch day and open a new one
export async function POST(req: NextRequest) {
  try {
    const user = await getSession();
    if (!user || !hasPermission(user.UserLevel, 'day.close') || !hasPermission(user.UserLevel, 'day.open')) {
      return NextResponse.json({ error: 'غير مصرح — لا تملك صلاحية إغلاق وفتح يوم العمل' }, { status: 403 });
    }

    let forceCloseShifts = false;
    try {
      const body = await req.json();
      forceCloseShifts = !!body?.forceCloseShifts;
    } catch {
      // defaults
    }

    const branch = await requireBranchOperatorContext();
    if (!isActiveBranchContext(branch)) return branch;

    try {
      const result = await closeAndOpenBusinessDay(branch, { forceCloseShifts });
      console.log(
        `[day] Close-and-open branch=${branch.branchCode}: closed ID=${result.closedDay.id}, opened ID=${result.openedDay.id}, by ${user.UserName}`,
      );
      return NextResponse.json({
        ok: true,
        closedDayID: result.closedDay.id,
        closedDayDate: result.closedDay.newDay,
        newDay: {
          ID: result.openedDay.id,
          NewDay: result.openedDay.newDay,
          Status: result.openedDay.status,
          BranchID: result.openedDay.branchId,
          BranchCode: branch.branchCode,
        },
        BranchID: branch.branchId,
        BranchCode: branch.branchCode,
        closedShifts: result.closedShifts,
      });
    } catch (err: unknown) {
      const mapped = branchErrorResponse(err);
      if (mapped) {
        if (typeof err === 'object' && err && (err as { openShifts?: unknown[] }).openShifts) {
          const body = await mapped.json();
          return NextResponse.json(
            { ...body, code: 'OPEN_SHIFTS' },
            { status: mapped.status },
          );
        }
        return mapped;
      }
      throw err;
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[api/day/close-and-open] error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

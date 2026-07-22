import { NextResponse } from 'next/server';
import { hasPermission } from '@/lib/permissions';
import { getSession } from '@/lib/session';
import {
  branchErrorResponse,
  requireBranchOperatorContext,
} from '@/lib/branch/operationalGates';
import { isActiveBranchContext } from '@/lib/branch/context';
import { openBusinessDay } from '@/lib/branch/businessDay';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// POST /api/day/open — Open a new business day for the active branch
export async function POST() {
  try {
    const user = await getSession();
    if (!user || !hasPermission(user.UserLevel, 'day.open')) {
      return NextResponse.json({ error: 'غير مصرح — لا تملك صلاحية فتح يوم عمل' }, { status: 403 });
    }

    const branch = await requireBranchOperatorContext();
    if (!isActiveBranchContext(branch)) return branch;

    const day = await openBusinessDay(branch);
    console.log(
      `[day] Opened branch day: ID=${day.id}, Branch=${branch.branchCode}, NewDay=${day.newDay}, by ${user.UserName}`,
    );

    return NextResponse.json(
      {
        day: {
          ID: day.id,
          NewDay: day.newDay,
          Status: day.status,
          BranchID: day.branchId,
          BranchCode: branch.branchCode,
        },
      },
      { status: 201 },
    );
  } catch (err: unknown) {
    const mapped = branchErrorResponse(err);
    if (mapped) return mapped;
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[api/day/open] error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

import { NextResponse } from 'next/server';
import { requireAuthenticatedBranchContext } from '@/lib/branch/operationalGates';
import { isActiveBranchContext } from '@/lib/branch/context';
import { getOpenBusinessDay } from '@/lib/branch/businessDay';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET /api/day — Get current open business day for the active branch
export async function GET() {
  try {
    const branch = await requireAuthenticatedBranchContext();
    if (!isActiveBranchContext(branch)) return branch;

    const day = await getOpenBusinessDay(branch.branchId);
    if (!day) {
      return NextResponse.json({ day: null, BranchID: branch.branchId, BranchCode: branch.branchCode });
    }
    return NextResponse.json({
      day: {
        ID: day.id,
        NewDay: day.newDay,
        Status: day.status,
        BranchID: day.branchId,
      },
      BranchID: branch.branchId,
      BranchCode: branch.branchCode,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[api/day] GET error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import {
  isActiveBranchContext,
  requireBranchOperationAccess,
} from '@/lib/branch';
import { getCairoBusinessDate } from '@/lib/businessDate';
import { executeWorkOnDayOff } from '@/lib/hr/attendance/workOnDayOff.service';

/**
 * POST /api/admin/attendance/work-on-day-off
 * Body: { empId, date?, reason?, checkInTime? }
 *
 * Employee is on leave today but came to work — unlock day + Present.
 */
export async function POST(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: 'غير مصرح' }, { status: 401 });
    }

    const branch = await requireBranchOperationAccess();
    if (!isActiveBranchContext(branch)) return branch;

    const body = await req.json();
    const empId = Number(body.empId);
    const date = String(body.date || getCairoBusinessDate());
    const reason =
      typeof body.reason === 'string' && body.reason.trim()
        ? body.reason.trim()
        : 'نزل يشتغل يوم إجازته';

    if (!Number.isFinite(empId) || empId <= 0) {
      return NextResponse.json({ error: 'empId غير صالح' }, { status: 400 });
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return NextResponse.json({ error: 'date غير صالح' }, { status: 400 });
    }

    const result = await executeWorkOnDayOff({
      empId,
      date,
      branchId: branch.branchId,
      reason,
      sourceTag: 'work-on-day-off',
    });

    return NextResponse.json({
      success: true,
      ...result,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[api/admin/attendance/work-on-day-off] POST error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

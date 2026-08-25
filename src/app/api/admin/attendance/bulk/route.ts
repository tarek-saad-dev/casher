import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import {
  isActiveBranchContext,
  requireBranchOperationAccess,
} from '@/lib/branch';
import {
  empBranchWorkDayCloseErrorResponse,
  isEmpBranchWorkDayCloseError,
} from '@/lib/hr/empBranchWorkDayClose.http';
import {
  ADMIN_BULK_SUCCESS_MESSAGE,
  AttendanceCommandError,
  saveAdminAttendanceBulk,
} from '@/modules/attendance';

// PUT /api/admin/attendance/bulk
export async function PUT(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: 'غير مصرح' }, { status: 401 });
    }

    const branch = await requireBranchOperationAccess();
    if (!isActiveBranchContext(branch)) return branch;

    const body = await req.json();
    if (body.BranchID != null || body.branchId != null) {
      return NextResponse.json(
        { error: 'BranchID في الطلب غير مسموح' },
        { status: 400 },
      );
    }
    const { WorkDate, items } = body;

    if (!WorkDate || !/^\d{4}-\d{2}-\d{2}$/.test(WorkDate)) {
      return NextResponse.json(
        { error: 'التاريخ مطلوب بصيغة YYYY-MM-DD' },
        { status: 400 },
      );
    }

    const summary = await saveAdminAttendanceBulk({
      branchId: branch.branchId,
      userId: session.UserID || null,
      workDate: WorkDate,
      items,
    });

    return NextResponse.json({
      success: true,
      message: ADMIN_BULK_SUCCESS_MESSAGE,
      summary,
    });
  } catch (err: unknown) {
    if (isEmpBranchWorkDayCloseError(err)) {
      return empBranchWorkDayCloseErrorResponse(err);
    }
    if (err instanceof AttendanceCommandError) {
      return NextResponse.json(
        err.code !== undefined
          ? { error: err.message, code: err.code }
          : { error: err.message },
        { status: err.statusCode },
      );
    }
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[api/admin/attendance/bulk] PUT error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

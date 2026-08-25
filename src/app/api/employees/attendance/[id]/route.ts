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
  updateLegacyEmployeeAttendanceById,
  AttendanceCommandError,
} from '@/modules/attendance';

type Ctx = { params: Promise<{ id: string }> };

// PUT /api/employees/attendance/:id
// Body: { checkInTime?, checkOutTime?, status?, notes? }
// Ownership: must match active session branch (non-disclosing 404 otherwise).
export async function PUT(req: NextRequest, { params }: Ctx) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: 'غير مصرح' }, { status: 401 });

    const branch = await requireBranchOperationAccess();
    if (!isActiveBranchContext(branch)) return branch;

    const { id } = await params;
    const recordId = parseInt(id);
    if (isNaN(recordId)) {
      return NextResponse.json({ error: 'معرف غير صالح' }, { status: 400 });
    }

    const body = await req.json();
    if (body.BranchID != null || body.branchId != null) {
      return NextResponse.json(
        { error: 'BranchID في الطلب غير مسموح' },
        { status: 400 },
      );
    }
    const { checkInTime, checkOutTime, status, notes } = body;

    const result = await updateLegacyEmployeeAttendanceById({
      branchId: branch.branchId,
      attendanceId: recordId,
      checkInTime,
      checkOutTime,
      status,
      notes,
    });

    return NextResponse.json(result.row);
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
    console.error('[api/employees/attendance/:id] PUT error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

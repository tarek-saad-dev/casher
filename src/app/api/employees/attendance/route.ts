import { NextRequest, NextResponse } from 'next/server';
import { getPool, sql } from '@/lib/db';
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
  saveLegacyEmployeeAttendance,
  AttendanceCommandError,
} from '@/modules/attendance';

// GET /api/employees/attendance?empId=&from=YYYY-MM-DD&to=YYYY-MM-DD
// Active-branch scoped by default (Phase 1K).
export async function GET(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: 'غير مصرح' }, { status: 401 });
    }

    const branch = await requireBranchOperationAccess();
    if (!isActiveBranchContext(branch)) return branch;

    const { searchParams } = new URL(req.url);
    const empId = searchParams.get('empId');
    const from = searchParams.get('from');
    const to = searchParams.get('to');

    const db = await getPool();
    const req2 = db.request().input('branchId', sql.Int, branch.branchId);

    let where = 'WHERE a.BranchID = @branchId';
    if (empId) {
      req2.input('empId', sql.Int, parseInt(empId));
      where += ' AND a.EmpID = @empId';
    }
    if (from) {
      req2.input('from', sql.Date, from);
      where += ' AND a.WorkDate >= @from';
    }
    if (to) {
      req2.input('to', sql.Date, to);
      where += ' AND a.WorkDate <= @to';
    }

    const result = await req2.query(`
      SELECT
        a.ID,
        a.BranchID,
        a.EmpID,
        e.EmpName,
        a.WorkDate,
        a.CheckInTime,
        a.CheckOutTime,
        a.Status,
        a.Notes,
        a.CreatedAt,
        a.UpdatedAt
      FROM      dbo.TblEmpAttendance a
      JOIN      dbo.TblEmp           e ON e.EmpID = a.EmpID
      ${where}
      ORDER BY  a.WorkDate DESC, e.EmpName
    `);

    return NextResponse.json(result.recordset);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[api/employees/attendance] GET error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// POST /api/employees/attendance
// Body: { empId, workDate, checkInTime?, checkOutTime?, status?, notes? }
// BranchID / authoritative WorkDate from client are rejected.
export async function POST(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: 'غير مصرح' }, { status: 401 });

    const branch = await requireBranchOperationAccess();
    if (!isActiveBranchContext(branch)) return branch;

    const body = await req.json();
    if (body.BranchID != null || body.branchId != null) {
      return NextResponse.json(
        { error: 'BranchID في الطلب غير مسموح' },
        { status: 400 },
      );
    }
    const { empId, workDate, checkInTime, checkOutTime, status, notes } = body;

    if (!empId || !workDate) {
      return NextResponse.json({ error: 'empId و workDate مطلوبان' }, { status: 400 });
    }

    const result = await saveLegacyEmployeeAttendance({
      branchId: branch.branchId,
      empId,
      workDate,
      checkInTime,
      checkOutTime,
      status,
      notes,
    });

    return NextResponse.json(result.row, { status: result.isNew ? 201 : 200 });
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
    console.error('[api/employees/attendance] POST error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

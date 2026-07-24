import { NextRequest, NextResponse } from 'next/server';
import { getPool, sql } from '@/lib/db';
import { getSession } from '@/lib/session';
import {
  isActiveBranchContext,
  requireBranchOperationAccess,
} from '@/lib/branch';
import {
  assertEmployeeEligibleForBranchAttendance,
  AttendanceDomainError,
} from '@/lib/hr/attendance/branchAttendance.service';

/** Convert "HH:mm" or "HH:mm:ss" string to Date anchored to 1970-01-01 UTC for sql.Time. */
function timeToDate(timeStr: string | null | undefined): Date | null {
  if (!timeStr || timeStr.trim() === '') return null;
  const parts = timeStr.split(':').map(Number);
  const h = parts[0] ?? 0;
  const m = parts[1] ?? 0;
  const s = parts[2] ?? 0;
  const d = new Date(0);
  d.setUTCHours(h, m, s, 0);
  return d;
}

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

    try {
      await assertEmployeeEligibleForBranchAttendance(
        Number(empId),
        branch.branchId,
        workDate,
      );
    } catch (eligErr) {
      if (eligErr instanceof AttendanceDomainError) {
        return NextResponse.json(
          { error: eligErr.message, code: eligErr.code },
          { status: eligErr.statusCode },
        );
      }
      throw eligErr;
    }

    const db = await getPool();

    const empCheck = await db.request()
      .input('empId', sql.Int, empId)
      .query(`SELECT 1 FROM dbo.TblEmp WHERE EmpID = @empId`);
    if (empCheck.recordset.length === 0) {
      return NextResponse.json({ error: 'الموظف غير موجود' }, { status: 404 });
    }

    if (checkInTime && !checkOutTime) {
      const openOther = await db
        .request()
        .input('empId', sql.Int, empId)
        .input('branchId', sql.Int, branch.branchId)
        .query(`
          SELECT TOP 1 ID
          FROM dbo.TblEmpAttendance
          WHERE EmpID = @empId
            AND CheckInTime IS NOT NULL
            AND CheckOutTime IS NULL
            AND BranchID <> @branchId
        `);
      if (openOther.recordset[0]) {
        return NextResponse.json(
          {
            error: 'الموظف لديه حضور مفتوح في فرع آخر — سجّل الانصراف أولاً',
            code: 'ALREADY_OPEN',
          },
          { status: 409 },
        );
      }
    }

    const result = await db.request()
      .input('branchId', sql.Int, branch.branchId)
      .input('empId', sql.Int, empId)
      .input('workDate', sql.Date, workDate)
      .input('checkInTime', sql.Time, timeToDate(checkInTime))
      .input('checkOutTime', sql.Time, timeToDate(checkOutTime))
      .input('status', sql.NVarChar(20), status ?? null)
      .input('notes', sql.NVarChar(200), notes ?? null)
      .query(`
        MERGE dbo.TblEmpAttendance AS target
        USING (
          SELECT @branchId AS BranchID, @empId AS EmpID, @workDate AS WorkDate
        ) AS src
          ON target.BranchID = src.BranchID
         AND target.EmpID = src.EmpID
         AND target.WorkDate = src.WorkDate
        WHEN MATCHED THEN
          UPDATE SET
            CheckInTime  = ISNULL(@checkInTime,  target.CheckInTime),
            CheckOutTime = ISNULL(@checkOutTime, target.CheckOutTime),
            Status       = ISNULL(@status,       target.Status),
            Notes        = ISNULL(@notes,        target.Notes),
            UpdatedAt    = GETDATE()
        WHEN NOT MATCHED THEN
          INSERT (BranchID, EmpID, WorkDate, CheckInTime, CheckOutTime, Status, Notes, CreatedAt)
          VALUES (@branchId, @empId, @workDate, @checkInTime, @checkOutTime, @status, @notes, GETDATE())
        OUTPUT
          INSERTED.ID, INSERTED.BranchID, INSERTED.EmpID, INSERTED.WorkDate,
          INSERTED.CheckInTime, INSERTED.CheckOutTime,
          INSERTED.Status, INSERTED.Notes, INSERTED.CreatedAt, INSERTED.UpdatedAt;
      `);

    const isNew = result.recordset[0]?.UpdatedAt === null;
    return NextResponse.json(result.recordset[0], { status: isNew ? 201 : 200 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[api/employees/attendance] POST error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

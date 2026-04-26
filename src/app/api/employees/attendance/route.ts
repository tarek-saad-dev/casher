import { NextRequest, NextResponse } from 'next/server';
import { getPool, sql } from '@/lib/db';
import { getSession } from '@/lib/session';

// GET /api/employees/attendance?empId=&from=YYYY-MM-DD&to=YYYY-MM-DD
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const empId = searchParams.get('empId');
    const from  = searchParams.get('from');
    const to    = searchParams.get('to');

    const db  = await getPool();
    const req2 = db.request();

    let where = 'WHERE 1=1';
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
export async function POST(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: 'غير مصرح' }, { status: 401 });

    const body = await req.json();
    const { empId, workDate, checkInTime, checkOutTime, status, notes } = body;

    if (!empId || !workDate) {
      return NextResponse.json({ error: 'empId و workDate مطلوبان' }, { status: 400 });
    }

    const db = await getPool();

    // Verify employee exists
    const empCheck = await db.request()
      .input('empId', sql.Int, empId)
      .query(`SELECT 1 FROM dbo.TblEmp WHERE EmpID = @empId`);
    if (empCheck.recordset.length === 0) {
      return NextResponse.json({ error: 'الموظف غير موجود' }, { status: 404 });
    }

    const result = await db.request()
      .input('empId',        sql.Int,          empId)
      .input('workDate',     sql.Date,          workDate)
      .input('checkInTime',  sql.NVarChar(10),  checkInTime  ?? null)
      .input('checkOutTime', sql.NVarChar(10),  checkOutTime ?? null)
      .input('status',       sql.NVarChar(20),  status       ?? null)
      .input('notes',        sql.NVarChar(200), notes        ?? null)
      .query(`
        MERGE dbo.TblEmpAttendance AS target
        USING (SELECT @empId AS EmpID, @workDate AS WorkDate) AS src
          ON target.EmpID = src.EmpID AND target.WorkDate = src.WorkDate
        WHEN MATCHED THEN
          UPDATE SET
            CheckInTime  = ISNULL(@checkInTime,  target.CheckInTime),
            CheckOutTime = ISNULL(@checkOutTime, target.CheckOutTime),
            Status       = ISNULL(@status,       target.Status),
            Notes        = ISNULL(@notes,        target.Notes),
            UpdatedAt    = GETDATE()
        WHEN NOT MATCHED THEN
          INSERT (EmpID, WorkDate, CheckInTime, CheckOutTime, Status, Notes, CreatedAt)
          VALUES (@empId, @workDate, @checkInTime, @checkOutTime, @status, @notes, GETDATE())
        OUTPUT
          INSERTED.ID, INSERTED.EmpID, INSERTED.WorkDate,
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

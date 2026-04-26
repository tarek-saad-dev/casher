import { NextRequest, NextResponse } from 'next/server';
import { getPool, sql } from '@/lib/db';
import { getSession } from '@/lib/session';

type Ctx = { params: Promise<{ id: string }> };

// PUT /api/employees/attendance/:id
// Body: { checkInTime?, checkOutTime?, status?, notes? }
export async function PUT(req: NextRequest, { params }: Ctx) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: 'غير مصرح' }, { status: 401 });

    const { id } = await params;
    const recordId = parseInt(id);
    if (isNaN(recordId)) {
      return NextResponse.json({ error: 'معرف غير صالح' }, { status: 400 });
    }

    const body = await req.json();
    const { checkInTime, checkOutTime, status, notes } = body;

    const db = await getPool();

    // Build dynamic SET
    const setClauses: string[] = ['UpdatedAt = GETDATE()'];
    const request = new sql.Request(db as any);

    if (checkInTime  !== undefined) { setClauses.push('CheckInTime  = @checkInTime');  request.input('checkInTime',  sql.NVarChar(10),  checkInTime); }
    if (checkOutTime !== undefined) { setClauses.push('CheckOutTime = @checkOutTime'); request.input('checkOutTime', sql.NVarChar(10),  checkOutTime); }
    if (status       !== undefined) { setClauses.push('Status       = @status');       request.input('status',       sql.NVarChar(20),  status); }
    if (notes        !== undefined) { setClauses.push('Notes        = @notes');        request.input('notes',        sql.NVarChar(200), notes); }

    if (setClauses.length === 1) {
      return NextResponse.json({ error: 'لا توجد بيانات للتعديل' }, { status: 400 });
    }

    request.input('id', sql.Int, recordId);
    const result = await request.query(`
      UPDATE dbo.TblEmpAttendance
      SET    ${setClauses.join(', ')}
      OUTPUT INSERTED.ID, INSERTED.EmpID, INSERTED.WorkDate,
             INSERTED.CheckInTime, INSERTED.CheckOutTime,
             INSERTED.Status, INSERTED.Notes, INSERTED.UpdatedAt
      WHERE  ID = @id
    `);

    if (result.recordset.length === 0) {
      return NextResponse.json({ error: 'السجل غير موجود' }, { status: 404 });
    }

    return NextResponse.json(result.recordset[0]);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[api/employees/attendance/:id] PUT error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from 'next/server';
import { getPool, sql } from '@/lib/db';
import { getSession } from '@/lib/session';
import {
  isActiveBranchContext,
  requireBranchOperationAccess,
} from '@/lib/branch';

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

    const db = await getPool();

    const owned = await db
      .request()
      .input('id', sql.Int, recordId)
      .query(`
        SELECT ID, BranchID FROM dbo.TblEmpAttendance WHERE ID = @id
      `);
    if (!owned.recordset[0] || Number(owned.recordset[0].BranchID) !== branch.branchId) {
      return NextResponse.json({ error: 'غير موجود' }, { status: 404 });
    }

    const setClauses: string[] = ['UpdatedAt = GETDATE()'];
    const request = db.request();

    if (checkInTime !== undefined) {
      setClauses.push('CheckInTime  = @checkInTime');
      request.input('checkInTime', sql.NVarChar(10), checkInTime);
    }
    if (checkOutTime !== undefined) {
      setClauses.push('CheckOutTime = @checkOutTime');
      request.input('checkOutTime', sql.NVarChar(10), checkOutTime);
    }
    if (status !== undefined) {
      setClauses.push('Status       = @status');
      request.input('status', sql.NVarChar(20), status);
    }
    if (notes !== undefined) {
      setClauses.push('Notes        = @notes');
      request.input('notes', sql.NVarChar(200), notes);
    }

    if (setClauses.length === 1) {
      return NextResponse.json({ error: 'لا توجد بيانات للتعديل' }, { status: 400 });
    }

    request.input('id', sql.Int, recordId);
    request.input('branchId', sql.Int, branch.branchId);
    const result = await request.query(`
      UPDATE dbo.TblEmpAttendance
      SET    ${setClauses.join(', ')}
      OUTPUT INSERTED.ID, INSERTED.BranchID, INSERTED.EmpID, INSERTED.WorkDate,
             INSERTED.CheckInTime, INSERTED.CheckOutTime,
             INSERTED.Status, INSERTED.Notes, INSERTED.UpdatedAt
      WHERE  ID = @id AND BranchID = @branchId
    `);

    if (result.recordset.length === 0) {
      return NextResponse.json({ error: 'غير موجود' }, { status: 404 });
    }

    return NextResponse.json(result.recordset[0]);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[api/employees/attendance/:id] PUT error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

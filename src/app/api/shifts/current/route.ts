import { NextResponse } from 'next/server';
import { getPool, sql } from '@/lib/db';
import { isActiveBranchContext, requireActiveBranchContext } from '@/lib/branch';

// GET /api/shifts/current — latest shift for the session active branch only
export async function GET() {
  try {
    const branch = await requireActiveBranchContext();
    if (!isActiveBranchContext(branch)) return branch;
    const branchId = branch.branchId;

    const db = await getPool();

    // Level 1: latest open shift for today on this branch
    let result = await db
      .request()
      .input('branchId', sql.Int, branchId)
      .query(`
      SELECT TOP 1 ID, Status, NewDay, BranchID
      FROM [dbo].[TblShiftMove]
      WHERE Status = 1
        AND BranchID = @branchId
        AND CAST(NewDay AS DATE) = CAST(GETDATE() AS DATE)
      ORDER BY ID DESC
    `);

    if (result.recordset.length > 0) {
      return NextResponse.json({ ...result.recordset[0], level: 'open_today' });
    }

    // Level 2: latest closed shift for today on this branch
    result = await db
      .request()
      .input('branchId', sql.Int, branchId)
      .query(`
      SELECT TOP 1 ID, Status, NewDay, BranchID
      FROM [dbo].[TblShiftMove]
      WHERE Status = 0
        AND BranchID = @branchId
        AND CAST(NewDay AS DATE) = CAST(GETDATE() AS DATE)
      ORDER BY ID DESC
    `);

    if (result.recordset.length > 0) {
      return NextResponse.json({ ...result.recordset[0], level: 'closed_today' });
    }

    // Level 3: latest still-open shift on this branch regardless of date
    result = await db
      .request()
      .input('branchId', sql.Int, branchId)
      .query(`
      SELECT TOP 1 ID, Status, NewDay, BranchID
      FROM [dbo].[TblShiftMove]
      WHERE Status = 1 AND BranchID = @branchId AND EndDate IS NULL
      ORDER BY ID DESC
    `);

    if (result.recordset.length > 0) {
      return NextResponse.json({ ...result.recordset[0], level: 'open_any' });
    }

    return NextResponse.json({ error: 'لا توجد وردية مفتوحة' }, { status: 404 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[api/shifts/current] GET error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

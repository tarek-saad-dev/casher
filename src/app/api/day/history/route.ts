import { NextResponse } from 'next/server';
import { getPool, sql } from '@/lib/db';
import { isActiveBranchContext, requireActiveBranchContext } from '@/lib/branch';

// GET /api/day/history — last 15 business days for the active branch
export async function GET() {
  try {
    const branch = await requireActiveBranchContext();
    if (!isActiveBranchContext(branch)) return branch;

    const db = await getPool();
    const result = await db
      .request()
      .input('branchId', sql.Int, branch.branchId)
      .query(`
      SELECT TOP 15
        d.ID, d.NewDay, d.Status,
        (SELECT COUNT(*) FROM [dbo].[TblShiftMove] sm
          WHERE sm.BusinessDayID = d.ID AND sm.BranchID = @branchId) AS shiftsCount,
        (SELECT COUNT(*) FROM [dbo].[TblinvServHead] h
          WHERE h.BusinessDayID = d.ID AND h.BranchID = @branchId AND h.invType = N'مبيعات') AS salesCount,
        (SELECT ISNULL(SUM(GrandTotal), 0) FROM [dbo].[TblinvServHead] h
          WHERE h.BusinessDayID = d.ID AND h.BranchID = @branchId AND h.invType = N'مبيعات') AS totalRevenue
      FROM [dbo].[TblNewDay] d
      WHERE d.BranchID = @branchId
      ORDER BY d.ID DESC
    `);
    return NextResponse.json(result.recordset);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[api/day/history] error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

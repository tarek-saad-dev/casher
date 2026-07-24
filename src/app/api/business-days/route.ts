import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import sql from 'mssql';
import { isActiveBranchContext, requireActiveBranchContext } from '@/lib/branch';

function formatDate(d: Date | string | null | undefined): string | null {
  if (!d) return null;
  const date = typeof d === 'string' ? new Date(d) : d;
  if (isNaN(date.getTime())) return null;
  return date.toLocaleDateString('en-CA', { timeZone: 'Africa/Cairo' });
}

/**
 * GET /api/business-days
 * Recent business days for the session active branch only.
 */
export async function GET(request: NextRequest) {
  try {
    const branch = await requireActiveBranchContext();
    if (!isActiveBranchContext(branch)) return branch;

    const db = await getPool();

    const searchParams = request.nextUrl.searchParams;
    const limit = searchParams.get('limit') ? parseInt(searchParams.get('limit')!) : 30;

    const result = await db
      .request()
      .input('limit', sql.Int, limit)
      .input('branchId', sql.Int, branch.branchId)
      .query(`
        SELECT TOP (@limit)
          ID,
          NewDay,
          Status
        FROM [dbo].[TblNewDay]
        WHERE BranchID = @branchId
        ORDER BY NewDay DESC
      `);

    const days = result.recordset.map((row: { ID: number; NewDay: Date | string; Status: number }) => {
      const dayStr = formatDate(row.NewDay) ?? String(row.NewDay);
      return {
        id: row.ID,
        newDay: dayStr,
        dayDate: dayStr,
        isOpen: row.Status === 1,
        label: dayStr,
      };
    });

    return NextResponse.json({ days });
  } catch (error) {
    console.error('[api/business-days] GET error:', error);
    return NextResponse.json(
      {
        error: 'فشل تحميل الأيام',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 },
    );
  }
}

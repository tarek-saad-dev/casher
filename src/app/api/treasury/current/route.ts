import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import sql from 'mssql';
import { isActiveBranchContext, requireActiveBranchContext } from '@/lib/branch';
import type { CurrentDayShift } from '@/lib/types/treasury';

function formatDate(d: Date | string | null | undefined): string | null {
  if (!d) return null;
  const date = typeof d === 'string' ? new Date(d) : d;
  if (isNaN(date.getTime())) return null;
  return date.toLocaleDateString('en-CA', { timeZone: 'Africa/Cairo' });
}

/**
 * GET /api/treasury/current
 * Get current open business day and active shift
 */
export async function GET(request: NextRequest) {
  let db;
  
  try {
    // PHASE1D: never trust browser branchId — always filter by the session's active branch
    const branch = await requireActiveBranchContext();
    if (!isActiveBranchContext(branch)) return branch;

    db = await getPool();
    
    // Get current open day (Status=1) for the active branch, fallback to latest day
    const currentDayResult = await db.request()
      .input('branchId', sql.Int, branch.branchId)
      .query(`
      SELECT TOP 1
        ID,
        NewDay,
        Status
      FROM [dbo].[TblNewDay]
      WHERE Status = 1 AND BranchID = @branchId
      ORDER BY ID DESC
    `);

    let currentDayRow = currentDayResult.recordset[0] ?? null;

    if (!currentDayRow) {
      const fallbackResult = await db.request()
        .input('branchId', sql.Int, branch.branchId)
        .query(`
        SELECT TOP 1 ID, NewDay, Status
        FROM [dbo].[TblNewDay]
        WHERE BranchID = @branchId
        ORDER BY ID DESC
      `);
      currentDayRow = fallbackResult.recordset[0] ?? null;
    }

    const currentDay = currentDayRow
      ? {
          id: currentDayRow.ID,
          newDay: formatDate(currentDayRow.NewDay)!,
          dayDate: formatDate(currentDayRow.NewDay)!,
          isOpen: currentDayRow.Status === 1,
        }
      : null;
    
    // Get current active shift (if day is open)
    let currentShift = null;
    if (currentDayRow) {
      const currentShiftResult = await db.request()
        .input('newDay', sql.Date, currentDayRow.NewDay)
        .input('branchId', sql.Int, branch.branchId)
        .query(`
          SELECT TOP 1 
            sm.ID as ShiftMoveID,
            s.ShiftName,
            u.UserName,
            sm.StartDate
          FROM [dbo].[TblShiftMove] sm
          INNER JOIN [dbo].[TblShift] s ON sm.ShiftID = s.ShiftID
          INNER JOIN [dbo].[TblUser] u ON sm.UserID = u.UserID
          WHERE sm.NewDay = @newDay
            AND sm.BranchID = @branchId
            AND sm.EndDate IS NULL
          ORDER BY sm.StartDate DESC
        `);
      
      if (currentShiftResult.recordset.length > 0) {
        currentShift = {
          shiftMoveId: currentShiftResult.recordset[0].ShiftMoveID,
          shiftName: currentShiftResult.recordset[0].ShiftName,
          userName: currentShiftResult.recordset[0].UserName,
          startDate: currentShiftResult.recordset[0].StartDate
        };
      }
    }
    
    const response: CurrentDayShift = {
      currentDay,
      currentShift
    };
    
    return NextResponse.json(response);
    
  } catch (error) {
    console.error('[api/treasury/current] GET error:', error);
    return NextResponse.json(
      { 
        error: 'فشل تحميل بيانات اليوم والوردية الحالية',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}

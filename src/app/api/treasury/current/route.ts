import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import sql from 'mssql';
import type { CurrentDayShift } from '@/lib/types/treasury';

/**
 * GET /api/treasury/current
 * Get current open business day and active shift
 */
export async function GET(request: NextRequest) {
  let db;
  
  try {
    db = await getPool();
    
    // Get current open day
    const currentDayResult = await db.request().query(`
      SELECT TOP 1 
        NewDay,
        DayDate,
        IsOpen
      FROM [dbo].[TblNewDay]
      WHERE IsOpen = 1
      ORDER BY NewDay DESC
    `);
    
    const currentDay = currentDayResult.recordset.length > 0 
      ? {
          newDay: currentDayResult.recordset[0].NewDay,
          dayDate: currentDayResult.recordset[0].DayDate,
          isOpen: currentDayResult.recordset[0].IsOpen
        }
      : null;
    
    // Get current active shift (if day is open)
    let currentShift = null;
    if (currentDay) {
      const currentShiftResult = await db.request()
        .input('newDay', sql.Int, currentDay.newDay)
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

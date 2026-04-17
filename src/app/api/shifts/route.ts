import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import sql from 'mssql';

/**
 * GET /api/shifts
 * Get shifts for a specific business day
 * Query params:
 * - newDay: business day number (required)
 */
export async function GET(request: NextRequest) {
  let db;
  
  try {
    db = await getPool();
    
    const searchParams = request.nextUrl.searchParams;
    const newDay = searchParams.get('newDay') ? parseInt(searchParams.get('newDay')!) : null;
    
    if (newDay === null) {
      return NextResponse.json(
        { error: 'معامل newDay مطلوب' },
        { status: 400 }
      );
    }
    
    const result = await db.request()
      .input('newDay', sql.Int, newDay)
      .query(`
        SELECT 
          sm.ID as ShiftMoveID,
          sm.ShiftID,
          s.ShiftName,
          sm.UserID,
          u.UserName,
          sm.StartDate,
          sm.EndDate
        FROM [dbo].[TblShiftMove] sm
        INNER JOIN [dbo].[TblShift] s ON sm.ShiftID = s.ShiftID
        INNER JOIN [dbo].[TblUser] u ON sm.UserID = u.UserID
        WHERE sm.NewDay = @newDay
        ORDER BY sm.StartDate DESC
      `);
    
    const shifts = result.recordset.map((row: any) => ({
      ShiftMoveID: row.ShiftMoveID,
      ShiftID: row.ShiftID,
      ShiftName: row.ShiftName,
      UserID: row.UserID,
      UserName: row.UserName,
      StartDate: row.StartDate,
      EndDate: row.EndDate
    }));
    
    return NextResponse.json({ shifts });
    
  } catch (error) {
    console.error('[api/shifts] GET error:', error);
    return NextResponse.json(
      { 
        error: 'فشل تحميل الورديات',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}

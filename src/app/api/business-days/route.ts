import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import sql from 'mssql';

/**
 * GET /api/business-days
 * Get list of business days for selection
 * Query params:
 * - limit: number of recent days to return (default 30)
 */
export async function GET(request: NextRequest) {
  let db;
  
  try {
    db = await getPool();
    
    const searchParams = request.nextUrl.searchParams;
    const limit = searchParams.get('limit') ? parseInt(searchParams.get('limit')!) : 30;
    
    const result = await db.request()
      .input('limit', sql.Int, limit)
      .query(`
        SELECT TOP (@limit)
          NewDay,
          DayDate,
          IsOpen
        FROM [dbo].[TblNewDay]
        ORDER BY NewDay DESC
      `);
    
    const days = result.recordset.map((row: any) => ({
      NewDay: row.NewDay,
      DayDate: row.DayDate,
      IsOpen: row.IsOpen
    }));
    
    return NextResponse.json({ days });
    
  } catch (error) {
    console.error('[api/business-days] GET error:', error);
    return NextResponse.json(
      { 
        error: 'فشل تحميل الأيام',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}

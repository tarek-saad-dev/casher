import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import sql from 'mssql';
import type { TreasuryMovementsResponse, TreasuryMovement } from '@/lib/types/treasury';

/**
 * GET /api/treasury/movements
 * Get detailed treasury movements with pagination
 * 
 * Query params:
 * - newDay: business day number
 * - dateFrom: start date (YYYY-MM-DD)
 * - dateTo: end date (YYYY-MM-DD)
 * - shiftMoveId: specific shift
 * - userId: filter by user
 * - page: page number (default 1)
 * - pageSize: items per page (default 50)
 */
export async function GET(request: NextRequest) {
  let db;
  
  try {
    db = await getPool();
    
    const searchParams = request.nextUrl.searchParams;
    const newDay = searchParams.get('newDay') ? parseInt(searchParams.get('newDay')!) : null;
    const dateFrom = searchParams.get('dateFrom');
    const dateTo = searchParams.get('dateTo');
    const shiftMoveId = searchParams.get('shiftMoveId') ? parseInt(searchParams.get('shiftMoveId')!) : null;
    const userId = searchParams.get('userId') ? parseInt(searchParams.get('userId')!) : null;
    const page = searchParams.get('page') ? parseInt(searchParams.get('page')!) : 1;
    const pageSize = searchParams.get('pageSize') ? parseInt(searchParams.get('pageSize')!) : 50;
    
    // Build WHERE clause
    let whereConditions: string[] = ['1=1'];
    const params: any = {};
    
    if (newDay !== null) {
      whereConditions.push('sm.NewDay = @newDay');
      params.newDay = newDay;
    }
    
    if (dateFrom && dateTo) {
      whereConditions.push('cm.invDate >= @dateFrom AND cm.invDate <= @dateTo');
      params.dateFrom = dateFrom;
      params.dateTo = dateTo;
    } else if (dateFrom) {
      whereConditions.push('cm.invDate >= @dateFrom');
      params.dateFrom = dateFrom;
    } else if (dateTo) {
      whereConditions.push('cm.invDate <= @dateTo');
      params.dateTo = dateTo;
    }
    
    if (shiftMoveId !== null) {
      whereConditions.push('sm.ShiftMoveID = @shiftMoveId');
      params.shiftMoveId = shiftMoveId;
    }
    
    if (userId !== null) {
      whereConditions.push('sm.UserID = @userId');
      params.userId = userId;
    }
    
    const whereClause = whereConditions.join(' AND ');
    
    // Get total count
    const countQuery = `
      SELECT COUNT(*) AS Total
      FROM [dbo].[TblCashMove] cm
      INNER JOIN [dbo].[TblShiftMove] sm ON cm.ShiftMoveID = sm.ShiftMoveID
      WHERE ${whereClause}
    `;
    
    const countRequest = db.request();
    Object.keys(params).forEach(key => {
      if (key === 'newDay' || key === 'shiftMoveId' || key === 'userId') {
        countRequest.input(key, sql.Int, params[key]);
      } else {
        countRequest.input(key, sql.Date, params[key]);
      }
    });
    
    const countResult = await countRequest.query(countQuery);
    const total = countResult.recordset[0].Total;
    const totalPages = Math.ceil(total / pageSize);
    
    // Get paginated movements
    const offset = (page - 1) * pageSize;
    
    const movementsQuery = `
      SELECT 
        cm.ID,
        cm.invID,
        cm.invType,
        cm.invDate,
        CONVERT(VARCHAR(5), cm.invDate, 108) AS invTime,
        cm.PaymentMethodID,
        pm.PaymentMethod,
        cm.inOut,
        cm.GrandTolal AS Amount,
        cm.ShiftMoveID,
        s.ShiftName,
        sm.UserID,
        u.UserName,
        cm.Notes
      FROM [dbo].[TblCashMove] cm
      INNER JOIN [dbo].[TblPaymentMethods] pm ON cm.PaymentMethodID = pm.PaymentID
      INNER JOIN [dbo].[TblShiftMove] sm ON cm.ShiftMoveID = sm.ID
      LEFT JOIN [dbo].[TblShift] s ON sm.ShiftID = s.ShiftID
      LEFT JOIN [dbo].[TblUser] u ON sm.UserID = u.UserID
      WHERE ${whereClause}
      ORDER BY cm.invDate DESC, cm.ID DESC
      OFFSET @offset ROWS
      FETCH NEXT @pageSize ROWS ONLY
    `;
    
    const movementsRequest = db.request();
    Object.keys(params).forEach(key => {
      if (key === 'newDay' || key === 'shiftMoveId' || key === 'userId') {
        movementsRequest.input(key, sql.Int, params[key]);
      } else {
        movementsRequest.input(key, sql.Date, params[key]);
      }
    });
    movementsRequest.input('offset', sql.Int, offset);
    movementsRequest.input('pageSize', sql.Int, pageSize);
    
    const movementsResult = await movementsRequest.query(movementsQuery);
    
    const movements: TreasuryMovement[] = movementsResult.recordset.map((row: any) => ({
      id: row.ID,
      invId: row.invID,
      invType: row.invType,
      invDate: row.invDate,
      invTime: row.invTime,
      paymentMethodId: row.PaymentMethodID,
      paymentMethodName: row.PaymentMethod,
      inOut: row.inOut,
      amount: row.Amount,
      shiftMoveId: row.ShiftMoveID,
      shiftName: row.ShiftName,
      userId: row.UserID,
      userName: row.UserName,
      notes: row.Notes
    }));
    
    const response: TreasuryMovementsResponse = {
      movements,
      pagination: {
        page,
        pageSize,
        total,
        totalPages
      }
    };
    
    return NextResponse.json(response);
    
  } catch (error) {
    console.error('[api/treasury/movements] GET error:', error);
    return NextResponse.json(
      { 
        error: 'فشل تحميل حركات الخزنة',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}

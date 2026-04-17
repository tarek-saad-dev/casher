import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import sql from 'mssql';
import type { 
  ReconciliationRequest, 
  ReconciliationResponse, 
  ReconciliationHistoryResponse,
  ReconciliationRecord,
  VarianceStatus 
} from '@/lib/types/treasury';

const VARIANCE_THRESHOLD = 50; // 50 ج.م acceptable variance

function getVarianceStatus(variance: number, systemAmount: number): VarianceStatus {
  const absVariance = Math.abs(variance);
  const percentage = systemAmount !== 0 ? (absVariance / Math.abs(systemAmount)) * 100 : 0;
  
  if (absVariance <= VARIANCE_THRESHOLD) {
    return 'acceptable';
  } else if (percentage <= 5) {
    return 'warning';
  } else {
    return 'critical';
  }
}

/**
 * POST /api/treasury/reconciliation
 * Save end-of-day reconciliation
 */
export async function POST(request: NextRequest) {
  let db;
  
  try {
    const body: ReconciliationRequest = await request.json();
    const { newDay, shiftMoveId, reconciliations } = body;
    
    if (!newDay || !reconciliations || reconciliations.length === 0) {
      return NextResponse.json(
        { error: 'البيانات المطلوبة غير مكتملة' },
        { status: 400 }
      );
    }
    
    db = await getPool();
    
    // Get current user (in real app, get from session)
    // For now, use a default user ID
    const closedByUserId = 1; // TODO: Get from auth session
    
    const reconciliationIds: number[] = [];
    const variances: any[] = [];
    
    // Insert each reconciliation record
    for (const recon of reconciliations) {
      const variance = recon.countedAmount - recon.systemAmount;
      const status = getVarianceStatus(variance, recon.systemAmount);
      
      const insertResult = await db.request()
        .input('newDay', sql.Int, newDay)
        .input('shiftMoveId', sql.Int, shiftMoveId || null)
        .input('paymentMethodId', sql.Int, recon.paymentMethodId)
        .input('systemAmount', sql.Decimal(18, 2), recon.systemAmount)
        .input('countedAmount', sql.Decimal(18, 2), recon.countedAmount)
        .input('notes', sql.NVarChar, recon.notes || null)
        .input('closedByUserId', sql.Int, closedByUserId)
        .query(`
          INSERT INTO [dbo].[TblTreasuryCloseRecon] 
            ([NewDay], [ShiftMoveID], [PaymentMethodID], [SystemAmount], [CountedAmount], [Notes], [ClosedByUserID])
          VALUES 
            (@newDay, @shiftMoveId, @paymentMethodId, @systemAmount, @countedAmount, @notes, @closedByUserId);
          
          SELECT SCOPE_IDENTITY() AS ID;
        `);
      
      const reconId = insertResult.recordset[0].ID;
      reconciliationIds.push(reconId);
      
      // Get payment method name for response
      const pmResult = await db.request()
        .input('paymentMethodId', sql.Int, recon.paymentMethodId)
        .query(`
          SELECT PaymentMethod 
          FROM [dbo].[TblPaymentMethods] 
          WHERE PaymentID = @paymentMethodId
        `);
      
      const paymentMethodName = pmResult.recordset[0]?.PaymentMethod || '';
      const variancePercentage = recon.systemAmount !== 0 
        ? (variance / Math.abs(recon.systemAmount)) * 100 
        : 0;
      
      variances.push({
        paymentMethodId: recon.paymentMethodId,
        paymentMethodName,
        variance,
        variancePercentage,
        status
      });
    }
    
    const response: ReconciliationResponse = {
      success: true,
      reconciliationIds,
      variances,
      message: 'تم حفظ قفل اليوم بنجاح'
    };
    
    return NextResponse.json(response);
    
  } catch (error) {
    console.error('[api/treasury/reconciliation] POST error:', error);
    return NextResponse.json(
      { 
        error: 'فشل حفظ قفل اليوم',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}

/**
 * GET /api/treasury/reconciliation
 * Get reconciliation history
 */
export async function GET(request: NextRequest) {
  let db;
  
  try {
    db = await getPool();
    
    const searchParams = request.nextUrl.searchParams;
    const newDay = searchParams.get('newDay') ? parseInt(searchParams.get('newDay')!) : null;
    const shiftMoveId = searchParams.get('shiftMoveId') ? parseInt(searchParams.get('shiftMoveId')!) : null;
    
    let whereConditions: string[] = ['r.IsActive = 1'];
    const params: any = {};
    
    if (newDay !== null) {
      whereConditions.push('r.NewDay = @newDay');
      params.newDay = newDay;
    }
    
    if (shiftMoveId !== null) {
      whereConditions.push('r.ShiftMoveID = @shiftMoveId');
      params.shiftMoveId = shiftMoveId;
    }
    
    const whereClause = whereConditions.join(' AND ');
    
    const query = `
      SELECT 
        r.ID,
        r.NewDay,
        nd.DayDate,
        r.ShiftMoveID,
        s.ShiftName,
        r.PaymentMethodID,
        pm.PaymentMethod,
        r.SystemAmount,
        r.CountedAmount,
        r.VarianceAmount,
        r.Notes,
        r.ClosedByUserID,
        u.UserName AS ClosedByUserName,
        r.ClosedAt
      FROM [dbo].[TblTreasuryCloseRecon] r
      INNER JOIN [dbo].[TblNewDay] nd ON r.NewDay = nd.NewDay
      INNER JOIN [dbo].[TblPaymentMethods] pm ON r.PaymentMethodID = pm.PaymentID
      INNER JOIN [dbo].[TblUser] u ON r.ClosedByUserID = u.UserID
      LEFT JOIN [dbo].[TblShiftMove] sm ON r.ShiftMoveID = sm.ID
      LEFT JOIN [dbo].[TblShift] s ON sm.ShiftID = s.ShiftID
      WHERE ${whereClause}
      ORDER BY r.ClosedAt DESC
    `;
    
    const queryRequest = db.request();
    Object.keys(params).forEach(key => {
      queryRequest.input(key, sql.Int, params[key]);
    });
    
    const result = await queryRequest.query(query);
    
    const reconciliations: ReconciliationRecord[] = result.recordset.map((row: any) => {
      const variance = row.VarianceAmount || 0;
      const variancePercentage = row.SystemAmount !== 0 
        ? (variance / Math.abs(row.SystemAmount)) * 100 
        : 0;
      const status = getVarianceStatus(variance, row.SystemAmount);
      
      return {
        id: row.ID,
        newDay: row.NewDay,
        dayDate: row.DayDate,
        shiftMoveId: row.ShiftMoveID,
        shiftName: row.ShiftName,
        paymentMethodId: row.PaymentMethodID,
        paymentMethodName: row.PaymentMethod,
        systemAmount: row.SystemAmount,
        countedAmount: row.CountedAmount,
        varianceAmount: variance,
        variancePercentage,
        status,
        notes: row.Notes,
        closedByUserId: row.ClosedByUserID,
        closedByUserName: row.ClosedByUserName,
        closedAt: row.ClosedAt
      };
    });
    
    const response: ReconciliationHistoryResponse = {
      reconciliations
    };
    
    return NextResponse.json(response);
    
  } catch (error) {
    console.error('[api/treasury/reconciliation] GET error:', error);
    return NextResponse.json(
      { 
        error: 'فشل تحميل سجل القفل',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}

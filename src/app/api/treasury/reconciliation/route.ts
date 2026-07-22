import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import sql from 'mssql';
import { executeAuditedAction, isAuditedActionError } from '@/lib/sensitiveActionAudit';
import { closeTreasuryDay } from '@/lib/actions/treasuryActions';
import { getSession } from '@/lib/session';
import type { 
  ReconciliationRequest, 
  ReconciliationResponse, 
  ReconciliationHistoryResponse,
  ReconciliationRecord,
  VarianceStatus 
} from '@/lib/types/treasury';

const VARIANCE_THRESHOLD = 50; // 50 ج.م acceptable variance

function formatDate(d: Date | string | null | undefined): string | null {
  if (!d) return null;
  const date = typeof d === 'string' ? new Date(d) : d;
  if (isNaN(date.getTime())) return null;
  return date.toLocaleDateString('en-CA', { timeZone: 'Africa/Cairo' });
}

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
  let db: sql.ConnectionPool | undefined;

  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: 'غير مصرح' }, { status: 401 });

    const { requireBranchOperatorContext } = await import('@/lib/branch/operationalGates');
    const { isActiveBranchContext } = await import('@/lib/branch/context');
    const branch = await requireBranchOperatorContext();
    if (!isActiveBranchContext(branch)) return branch;

    db = await getPool();
    const body: ReconciliationRequest & { reason?: string } = await request.json();
    const { newDay, shiftMoveId, reconciliations, reason } = body;

    if (!newDay || !reconciliations || reconciliations.length === 0) {
      return NextResponse.json({ error: 'البيانات المطلوبة غير مكتملة' }, { status: 400 });
    }

    const dayResult = await db.request()
      .input('newDay', sql.Date, newDay)
      .input('branchId', sql.Int, branch.branchId)
      .query(`
        SELECT TOP 1 ID, NewDay, Status, BranchID
        FROM dbo.TblNewDay
        WHERE NewDay = @newDay AND BranchID = @branchId
      `);
    const dayRow = dayResult.recordset[0];
    if (!dayRow) {
      return NextResponse.json({ error: 'اليوم المطلوب غير موجود في الفرع النشط' }, { status: 404 });
    }

    const auditResult = await executeAuditedAction({
      actionType: 'close_day',
      user: session,
      entityId: newDay,
      request,
      actionMethod: 'CLOSE_DAY',
      endpointPath: '/api/treasury/reconciliation',
      reason: reason || null,
      loadOldData: async () => {
        if (!dayRow) return null;
        const previousRecon = await db!.request().input('dayId', sql.Int, dayRow.ID).query(`
          SELECT r.ID, r.PaymentMethodID, pm.PaymentMethod, r.SystemAmount, r.CountedAmount, r.VarianceAmount, r.Notes
          FROM dbo.TblTreasuryCloseRecon r
          JOIN dbo.TblPaymentMethods pm ON r.PaymentMethodID = pm.PaymentID
          WHERE r.NewDay = @dayId
        `);
        return {
          newDay,
          dayStatus: dayRow.Status,
          previousReconciliations: previousRecon.recordset,
        };
      },
      execute: async (transaction) => closeTreasuryDay(transaction, {
        newDay,
        branchId: branch.branchId,
        shiftMoveId,
        reconciliations,
        closedByUserId: session.UserID,
      }),
      loadNewData: async (transaction, result) => {
        const newRecon = await new sql.Request(transaction)
          .input('dayId', sql.Int, dayRow.ID)
          .query(`
            SELECT r.ID, r.PaymentMethodID, pm.PaymentMethod, r.SystemAmount, r.CountedAmount, r.VarianceAmount, r.Notes
            FROM dbo.TblTreasuryCloseRecon r
            JOIN dbo.TblPaymentMethods pm ON r.PaymentMethodID = pm.PaymentID
            WHERE r.NewDay = @dayId
          `);
        return {
          newDay,
          reconciliationIds: result.reconciliationIds,
          variances: result.variances,
          closedByUserId: result.closedByUserId,
          reconciliations: newRecon.recordset,
        };
      },
    });

    const response: ReconciliationResponse = {
      success: true,
      reconciliationIds: auditResult.data.reconciliationIds,
      variances: auditResult.data.variances,
      message: 'تم حفظ قفل اليوم بنجاح',
    };

    return NextResponse.json({ ...response, auditId: auditResult.auditId });

  } catch (error) {
    if (isAuditedActionError(error)) {
      return NextResponse.json(
        { error: error.message, auditId: error.failedAuditId },
        { status: 500 },
      );
    }
    console.error('[api/treasury/reconciliation] POST error:', error);
    return NextResponse.json(
      { error: 'فشل حفظ قفل اليوم' },
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
    const newDayDate = searchParams.get('newDay') || null;
    const shiftMoveId = searchParams.get('shiftMoveId') ? parseInt(searchParams.get('shiftMoveId')!) : null;
    
    let dayId: number | null = null;
    if (newDayDate) {
      const dayLookup = await db.request()
        .input('newDay', sql.Date, newDayDate)
        .query(`SELECT TOP 1 ID FROM [dbo].[TblNewDay] WHERE NewDay = @newDay`);
      dayId = dayLookup.recordset[0]?.ID ?? null;
    }
    
    let whereConditions: string[] = ['r.IsActive = 1'];
    const params: any = {};
    
    if (dayId !== null) {
      whereConditions.push('r.NewDay = @dayId');
      params.dayId = dayId;
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
        nd.NewDay AS DayDate,
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
      INNER JOIN [dbo].[TblNewDay] nd ON r.NewDay = nd.ID
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
        newDay: formatDate(row.DayDate) ?? row.DayDate,
        dayDate: formatDate(row.DayDate) ?? row.DayDate,
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

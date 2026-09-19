import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import sql from 'mssql';
import { executeAuditedAction, isAuditedActionError } from '@/lib/sensitiveActionAudit';
import { closeTreasuryShift } from '@/lib/actions/treasuryActions';
import { getSession } from '@/lib/session';
import { hasPermission } from '@/lib/permissions';
import { isActiveBranchContext } from '@/lib/branch/context';
import { requireBranchOperatorContext, branchErrorResponse } from '@/lib/branch/operationalGates';
import type {
  ReconciliationResponse,
  ShiftReconciliationRequest,
} from '@/lib/types/treasury';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/treasury/shift-reconciliation
 * Cashier shift close with optional cash variance — does NOT close the business day.
 */
export async function POST(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session || !hasPermission(session.UserLevel, 'shift.close')) {
      return NextResponse.json({ error: 'غير مصرح — لا تملك صلاحية إغلاق الوردية' }, { status: 403 });
    }

    const branch = await requireBranchOperatorContext();
    if (!isActiveBranchContext(branch)) return branch;

    const body: ShiftReconciliationRequest = await request.json();
    const { shiftMoveId, reconciliations, reason } = body;

    if (!shiftMoveId || !Array.isArray(reconciliations)) {
      return NextResponse.json({ error: 'البيانات المطلوبة غير مكتملة' }, { status: 400 });
    }

    for (const r of reconciliations) {
      if (r.paymentMethodId == null || typeof r.systemAmount !== 'number' || typeof r.countedAmount !== 'number') {
        return NextResponse.json({ error: 'بيانات التسوية غير مكتملة' }, { status: 400 });
      }
    }

    const db = await getPool();
    const shiftLookup = await db.request()
      .input('shiftMoveId', sql.Int, shiftMoveId)
      .query(`
        SELECT TOP 1 ID, UserID, BranchID, BusinessDayID, Status
        FROM dbo.TblShiftMove
        WHERE ID = @shiftMoveId
      `);
    const shiftRow = shiftLookup.recordset[0];
    if (!shiftRow) {
      return NextResponse.json({ error: 'الوردية غير موجودة' }, { status: 404 });
    }

    const auditResult = await executeAuditedAction({
      actionType: 'close_shift_recon',
      user: session,
      entityId: shiftMoveId,
      request,
      actionMethod: 'CLOSE_SHIFT_RECON',
      endpointPath: '/api/treasury/shift-reconciliation',
      reason: reason?.trim() || null,
      loadOldData: async () => ({
        shiftMoveId,
        userId: shiftRow.UserID,
        branchId: shiftRow.BranchID,
        businessDayId: shiftRow.BusinessDayID,
        status: shiftRow.Status,
      }),
      execute: async (transaction) =>
        closeTreasuryShift(transaction, {
          shiftMoveId,
          branchId: branch.branchId,
          closedByUserId: session.UserID,
          reconciliations: reconciliations.map((r) => ({
            paymentMethodId: r.paymentMethodId as number,
            systemAmount: r.systemAmount,
            countedAmount: r.countedAmount,
            notes: r.notes,
          })),
        }),
      loadNewData: async (transaction, result) => {
        const newRecon = await new sql.Request(transaction)
          .input('shiftMoveId', sql.Int, shiftMoveId)
          .query(`
            SELECT r.ID, r.PaymentMethodID, pm.PaymentMethod, r.SystemAmount, r.CountedAmount, r.VarianceAmount, r.Notes
            FROM dbo.TblTreasuryCloseRecon r
            JOIN dbo.TblPaymentMethods pm ON r.PaymentMethodID = pm.PaymentID
            WHERE r.ShiftMoveID = @shiftMoveId
          `);
        return {
          shiftMoveId: result.shiftMoveId,
          businessDayId: result.businessDayId,
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
      message: 'تم تقفيل الوردية بنجاح',
    };

    return NextResponse.json({
      ...response,
      shiftMoveId: auditResult.data.shiftMoveId,
      businessDayId: auditResult.data.businessDayId,
      auditId: auditResult.auditId,
    });
  } catch (error) {
    const mapped = branchErrorResponse(error);
    if (mapped) return mapped;
    if (isAuditedActionError(error)) {
      return NextResponse.json(
        { error: error.message, auditId: error.failedAuditId },
        { status: 500 },
      );
    }
    const message = error instanceof Error ? error.message : 'فشل تقفيل الوردية';
    console.error('[api/treasury/shift-reconciliation] POST error:', message);
    const status =
      message.includes('غير مصرح') || message.includes('لا تنتمي')
        ? 403
        : message.includes('غير موجودة')
          ? 404
          : message.includes('مسبقاً') || message.includes('مغلقة')
            ? 400
            : 500;
    return NextResponse.json({ error: message }, { status });
  }
}

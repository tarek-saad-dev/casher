import { NextRequest, NextResponse } from "next/server";
import { getPool, sql } from "@/lib/db";
import { getSession } from "@/lib/session";
import { executeAuditedAction, isAuditedActionError } from '@/lib/sensitiveActionAudit';
import { getIncomeSnapshot, updateIncome, deleteIncome } from '@/lib/actions/incomeActions';
import { cashMoveHardDeleteSuccessMessage } from '@/lib/services/cashMoveHardDeleteService';

type Ctx = { params: Promise<{ id: string }> };

// ─────────────────────── GET /api/incomes/[id] ───────────────────────
export async function GET(_req: NextRequest, { params }: Ctx) {
  try {
    const { id } = await params;
    const incomeId = parseInt(id);
    if (isNaN(incomeId))
      return NextResponse.json(
        { error: "معرف الإيراد غير صالح" },
        { status: 400 },
      );

    const { requireBranchOperationAccess, isActiveBranchContext } = await import(
      '@/lib/branch/context'
    );
    const { financialNotFoundResponse } = await import(
      '@/lib/branch/financialOwnership'
    );
    const branch = await requireBranchOperationAccess();
    if (!isActiveBranchContext(branch)) return branch;

    const db = await getPool();
    const result = await db
      .request()
      .input("id", sql.Int, incomeId)
      .input("branchId", sql.Int, branch.branchId)
      .query(`
        SELECT
          CM.ID, CM.invID, CM.invType, CM.invDate, CM.invTime,
          CM.ExpINID, ISNULL(CAT.CatName, N'غير مصنف') AS CategoryName,
          CM.GrandTolal AS Amount, CM.inOut, CM.Notes,
          CM.ShiftMoveID, SM.NewDay, U.UserName, S.ShiftName,
          CM.PaymentMethodID, ISNULL(PM.PaymentMethod, N'غير محدد') AS PaymentMethod
        FROM dbo.TblCashMove CM
        LEFT JOIN dbo.TblExpINCat CAT       ON CM.ExpINID        = CAT.ExpINID
        LEFT JOIN dbo.TblShiftMove SM       ON CM.ShiftMoveID    = SM.ID
        LEFT JOIN dbo.TblUser U             ON SM.UserID         = U.UserID
        LEFT JOIN dbo.TblShift S            ON SM.ShiftID        = S.ShiftID
        LEFT JOIN dbo.TblPaymentMethods PM  ON CM.PaymentMethodID = PM.PaymentID
        WHERE CM.ID = @id AND CM.invType = N'ايرادات' AND CM.BranchID = @branchId
      `);

    if (result.recordset.length === 0) return financialNotFoundResponse();

    return NextResponse.json(result.recordset[0]);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[api/incomes/[id]] GET error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// ─────────────────────── PATCH /api/incomes/[id] ───────────────────────
export async function PATCH(req: NextRequest, { params }: Ctx) {
  try {
    const session = await getSession();
    if (!session)
      return NextResponse.json(
        { error: "يجب تسجيل الدخول أولاً" },
        { status: 401 },
      );

    const { id } = await params;
    const incomeId = parseInt(id);
    if (isNaN(incomeId))
      return NextResponse.json(
        { error: "معرف الإيراد غير صالح" },
        { status: 400 },
      );

    const body = await req.json();
    const { invDate, amount, expInId, paymentMethodId, notes, shiftMoveId } =
      body;

    if (!invDate)
      return NextResponse.json({ error: "التاريخ مطلوب" }, { status: 400 });
    if (!amount || Number(amount) <= 0)
      return NextResponse.json(
        { error: "قيمة الإيراد يجب أن تكون أكبر من صفر" },
        { status: 400 },
      );
    if (!expInId)
      return NextResponse.json(
        { error: "يجب اختيار تصنيف الإيراد" },
        { status: 400 },
      );
    if (!paymentMethodId)
      return NextResponse.json(
        { error: "يجب اختيار طريقة الدفع" },
        { status: 400 },
      );

    const { requireBranchOperationAccess, isActiveBranchContext } = await import(
      '@/lib/branch/context'
    );
    const { financialNotFoundResponse } = await import(
      '@/lib/branch/financialOwnership'
    );
    const branch = await requireBranchOperationAccess();
    if (!isActiveBranchContext(branch)) return branch;

    const auditResult = await executeAuditedAction({
      actionType: 'edit_income',
      user: session,
      entityId: incomeId,
      request: req,
      actionMethod: 'PATCH',
      endpointPath: `/api/incomes/${incomeId}`,
      reason: notes || null,
      loadOldData: async (transaction) => {
        const snap = await getIncomeSnapshot(transaction, incomeId);
        if (!snap || Number(snap.BranchID) !== Number(branch.branchId)) return null;
        return snap as unknown as Record<string, unknown>;
      },
      execute: async (transaction) =>
        updateIncome(
          transaction,
          incomeId,
          {
            invDate,
            amount: Number(amount),
            expInId,
            paymentMethodId,
            notes,
            shiftMoveId,
            createdByUserId: session.UserID,
          },
          branch.branchId,
        ),
      loadNewData: async (transaction) =>
        getIncomeSnapshot(transaction, incomeId) as unknown as Record<string, unknown> | null,
    });

    if (!auditResult.data) return financialNotFoundResponse();

    return NextResponse.json({
      success: true,
      message: 'تم تحديث الإيراد',
      auditId: auditResult.auditId,
      data: auditResult.data,
    });
  } catch (err: unknown) {
    if (isAuditedActionError(err)) {
      return NextResponse.json({ error: err.message, auditId: err.failedAuditId }, { status: 500 });
    }
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[api/incomes/[id]] PATCH error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// ───────────────────────── DELETE /api/incomes/[id] ───────────────────────
export async function DELETE(req: NextRequest, { params }: Ctx) {
  try {
    const session = await getSession();
    if (!session)
      return NextResponse.json({ error: 'يجب تسجيل الدخول أولاً' }, { status: 401 });

    const { id } = await params;
    const incomeId = parseInt(id);
    if (isNaN(incomeId))
      return NextResponse.json({ error: 'معرف الإيراد غير صالح' }, { status: 400 });

    const body = await req.json().catch(() => ({}));
    const reason = body.reason || null;

    const { requireBranchOperationAccess, isActiveBranchContext } = await import(
      '@/lib/branch/context'
    );
    const { financialNotFoundResponse } = await import(
      '@/lib/branch/financialOwnership'
    );
    const branch = await requireBranchOperationAccess();
    if (!isActiveBranchContext(branch)) return branch;

    const auditResult = await executeAuditedAction({
      actionType: 'delete_income',
      user: session,
      entityId: incomeId,
      request: req,
      actionMethod: 'DELETE',
      endpointPath: `/api/incomes/${incomeId}`,
      reason,
      loadOldData: async (transaction) => {
        const snap = await getIncomeSnapshot(transaction, incomeId);
        if (!snap || Number(snap.BranchID) !== Number(branch.branchId)) return null;
        return snap as unknown as Record<string, unknown>;
      },
      execute: async (transaction) =>
        deleteIncome(transaction, incomeId, branch.branchId),
      loadNewData: async () => null,
    });

    const ledgerDeletedCount = auditResult.data.ledgerDeletedCount;
    return NextResponse.json({
      success: true,
      message: cashMoveHardDeleteSuccessMessage(ledgerDeletedCount),
      ledgerDeletedCount,
      auditId: auditResult.auditId,
    });

  } catch (err: unknown) {
    if (isAuditedActionError(err)) {
      return NextResponse.json({ error: err.message, auditId: err.failedAuditId }, { status: 500 });
    }
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[api/incomes/[id]] DELETE error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

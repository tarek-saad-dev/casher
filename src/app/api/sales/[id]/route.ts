import { NextRequest, NextResponse } from "next/server";
import { getPool, sql } from "@/lib/db";
import { getSession } from "@/lib/session";
import { executeAuditedAction, isAuditedActionError } from '@/lib/sensitiveActionAudit';
import { getInvoiceSnapshot, updateInvoice, deleteInvoice } from '@/lib/actions/invoiceActions';
import type { InvoiceItemInput } from '@/lib/actions/invoiceActions';
import {
  assertActiveBranchOwns,
  financialNotFoundResponse,
  isActiveBranchContext,
  loadInvoiceOwnership,
  requireActiveBranchContext,
} from '@/lib/branch';

// GET /api/sales/[id] — Get sale by invID for printing
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const invID = parseInt(id);
    if (isNaN(invID)) {
      return NextResponse.json({ error: "Invalid invID" }, { status: 400 });
    }

    const branch = await requireActiveBranchContext();
    if (!isActiveBranchContext(branch)) return branch;

    // PHASE1D: never trust browser branchId — re-validate ownership server-side and
    // return a non-disclosing 404 if the invoice belongs to another branch.
    const ownership = await loadInvoiceOwnership(invID, 'مبيعات');
    if (!ownership || !assertActiveBranchOwns(branch.branchId, ownership.branchId)) {
      return financialNotFoundResponse();
    }

    const db = await getPool();

    // Fetch header
    const head = await db.request().input("invID", sql.Int, invID).query(`
        SELECT
          h.invID, h.invType, h.invDate, h.invTime,
          h.ClientID, h.SubTotal, h.Dis, h.DisVal,
          h.Tax, h.TaxVal, h.GrandTotal, h.TotalBonus,
          h.PayCash, h.PayVisa, h.PaymentMethodID,
          h.invNotes, h.Notes,
          c.[Name] AS customerName,
          c.Mobile AS customerPhone
        FROM [dbo].[TblinvServHead] h
        LEFT JOIN [dbo].[TblClient] c ON h.ClientID = c.ClientID
        WHERE h.invID = @invID AND h.invType = N'مبيعات'
      `);

    if (head.recordset.length === 0) {
      return NextResponse.json(
        { error: "الفاتورة غير موجودة" },
        { status: 404 },
      );
    }

    const header = head.recordset[0];

    // Fetch details
    const details = await db.request().input("invID", sql.Int, invID).query(`
        SELECT
          d.ProID, d.EmpID, d.SPrice, d.SValue, d.SPriceAfterDis,
          d.Dis, d.DisVal, d.Qty, d.Bonus, d.Notes,
          p.ProName,
          e.EmpName
        FROM [dbo].[TblinvServDetail] d
        LEFT JOIN [dbo].[TblPro] p ON d.ProID = p.ProID
        LEFT JOIN [dbo].[TblEmp] e ON d.EmpID = e.EmpID
        WHERE d.invID = @invID AND d.invType = N'مبيعات'
      `);

    // Fetch real payment allocations for mixed-payment display/printing
    const payAllocations = await db.request().input("invID", sql.Int, invID).query(`
        SELECT
          p.PaymentMethodID,
          pm.PaymentMethod AS PaymentMethodName,
          p.PayValue
        FROM [dbo].[TblinvServPayment] p
        LEFT JOIN [dbo].[TblPaymentMethods] pm ON p.PaymentMethodID = pm.PaymentID
        WHERE p.invID = @invID AND p.invType = N'مبيعات'
          AND ISNULL(p.PayValue, 0) > 0
        ORDER BY p.ID
      `);

    const isSplitPayment = payAllocations.recordset.length > 1;

    return NextResponse.json({
      ...header,
      items: details.recordset,
      paymentAllocations: payAllocations.recordset,
      isSplitPayment,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[api/sales/id] GET error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// PUT /api/sales/[id] — Update existing sale invoice (executes immediately, audited)
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const invID = parseInt(id);
    if (isNaN(invID)) return NextResponse.json({ error: 'Invalid invID' }, { status: 400 });

    const sessionUser = await getSession();
    if (!sessionUser) return NextResponse.json({ error: 'غير مصرح' }, { status: 401 });
    const userID = sessionUser.UserID;

    const branch = await requireActiveBranchContext();
    if (!isActiveBranchContext(branch)) return branch;

    // PHASE1D: never trust browser branchId — re-validate ownership server-side.
    const ownership = await loadInvoiceOwnership(invID, 'مبيعات');
    if (!ownership || !assertActiveBranchOwns(branch.branchId, ownership.branchId)) {
      return financialNotFoundResponse();
    }

    const body = await req.json();

    if (!body.items || body.items.length === 0)
      return NextResponse.json({ error: 'يجب إضافة خدمة واحدة على الأقل' }, { status: 400 });

    const db = await getPool();
    const existingSnap = await db.request()
      .input('id', sql.Int, invID)
      .query(`SELECT invID FROM dbo.TblinvServHead WHERE invID=@id AND invType=N'مبيعات'`);
    if (!existingSnap.recordset.length)
      return NextResponse.json({ error: 'الفاتورة غير موجودة' }, { status: 404 });

    let targetRecalcScopes: import('@/lib/payroll/employee-target/employee-target-recalc-scope').TargetRecalcScope[] = [];

    const auditResult = await executeAuditedAction({
      actionType: 'edit_invoice',
      user: sessionUser,
      entityId: invID,
      request: req,
      actionMethod: 'PUT',
      endpointPath: `/api/sales/${invID}`,
      reason: body.reason || body.notes || null,
      loadOldData: async (transaction) => getInvoiceSnapshot(transaction, invID) as unknown as Record<string, unknown> | null,
      execute: async (transaction) => updateInvoice(transaction, invID, {
        clientId: body.clientId,
        subTotal: body.subTotal,
        dis: body.dis,
        disVal: body.disVal,
        grandTotal: body.grandTotal,
        totalBonus: body.totalBonus,
        payCash: body.payCash,
        payVisa: body.payVisa,
        paymentMethodId: body.paymentMethodId,
        notes: body.notes,
        items: body.items.map((item: InvoiceItemInput) => ({
          proId: item.proId,
          empId: item.empId,
          serviceId: item.serviceId,
          sPrice: item.sPrice,
          qty: item.qty,
          dis: item.dis,
          disVal: item.disVal,
          discount: item.discount,
          sValue: item.sValue,
          total: item.total,
          bonus: item.bonus,
          notes: item.notes,
        })),
        paymentAllocations: body.paymentAllocations,
      }, userID),
      loadNewData: async (transaction) => getInvoiceSnapshot(transaction, invID) as unknown as Record<string, unknown> | null,
      beforeCommit: async ({ transaction, oldData, newData }) => {
        const { enqueueTargetRecalcFromInvoiceSnapshots } = await import(
          '@/lib/payroll/employee-target/employee-target-invoice-sync'
        );
        targetRecalcScopes = await enqueueTargetRecalcFromInvoiceSnapshots({
          transaction,
          beforeSnapshot: oldData,
          afterSnapshot: newData,
          reason: 'invoice_update',
          sourceType: 'TblinvServHead',
          sourceRef: String(invID),
        });
      },
    });

    // Recalculate loyalty points after the audited transaction commits
    if (body.clientId) {
      try {
        await db.request()
          .input('invID', sql.Int, invID)
          .input('invType', sql.NVarChar(20), 'مبيعات')
          .input('UserID', sql.Int, userID).query(`
            EXEC [dbo].[sp_Loyalty_EarnPointsFromSale]
              @invID = @invID,
              @invType = @invType,
              @UserID = @UserID
          `);
      } catch (loyaltyErr) {
        console.error('[api/sales/id] Loyalty recalc error:', loyaltyErr);
      }
    }

    // Best-effort target processing — invoice already committed; durable request remains if this fails
    if (targetRecalcScopes.length > 0) {
      const { tryProcessAfterInvoiceCommit } = await import(
        '@/lib/payroll/employee-target/employee-target-invoice-sync'
      );
      void tryProcessAfterInvoiceCommit({
        scopes: targetRecalcScopes,
        actorUserId: userID,
      });
    }

    return NextResponse.json({
      invID,
      invType: 'مبيعات',
      updated: true,
      auditId: auditResult.auditId,
      data: auditResult.data,
    });
  } catch (err: unknown) {
    if (isAuditedActionError(err)) {
      return NextResponse.json({ error: err.message, auditId: err.failedAuditId }, { status: 500 });
    }
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[api/sales/id] PUT error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// DELETE /api/sales/[id] — Delete sale invoice (executes immediately, audited)
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: 'غير مصرح' }, { status: 401 });

    const { id } = await params;
    const invID = parseInt(id);
    if (isNaN(invID)) return NextResponse.json({ error: 'Invalid invID' }, { status: 400 });

    // Never trust browser branchId — active branch always comes from gated session context.
    const { requireBranchOperationAccess } = await import('@/lib/branch/context');
    const branch = await requireBranchOperationAccess();
    if (branch instanceof NextResponse) return branch;

    // PHASE1D: never trust browser branchId — re-validate ownership server-side.
    const ownership = await loadInvoiceOwnership(invID, 'مبيعات');
    if (!ownership || !assertActiveBranchOwns(branch.branchId, ownership.branchId)) {
      return financialNotFoundResponse();
    }

    const body = await req.json().catch(() => ({}));
    const reason = typeof body.reason === 'string' ? body.reason.trim() : '';

    if (!reason) {
      return NextResponse.json(
        { success: false, error: 'سبب مسح فاتورة المبيعات مطلوب' },
        { status: 400 },
      );
    }

    let targetRecalcScopes: import('@/lib/payroll/employee-target/employee-target-recalc-scope').TargetRecalcScope[] = [];

    const auditResult = await executeAuditedAction({
      actionType: 'delete_invoice',
      user: session,
      entityId: invID,
      request: req,
      actionMethod: 'DELETE',
      endpointPath: `/api/sales/${invID}`,
      reason,
      loadOldData: async (transaction) => getInvoiceSnapshot(transaction, invID) as unknown as Record<string, unknown> | null,
      execute: async (transaction) => deleteInvoice(transaction, invID, branch.branchId),
      loadNewData: async () => null,
      beforeCommit: async ({ transaction, oldData }) => {
        const { enqueueTargetRecalcFromInvoiceSnapshots } = await import(
          '@/lib/payroll/employee-target/employee-target-invoice-sync'
        );
        targetRecalcScopes = await enqueueTargetRecalcFromInvoiceSnapshots({
          transaction,
          beforeSnapshot: oldData,
          afterSnapshot: null,
          reason: 'invoice_delete',
          sourceType: 'TblinvServHead',
          sourceRef: String(invID),
        });
      },
    });

    if (targetRecalcScopes.length > 0) {
      const { tryProcessAfterInvoiceCommit } = await import(
        '@/lib/payroll/employee-target/employee-target-invoice-sync'
      );
      void tryProcessAfterInvoiceCommit({
        scopes: targetRecalcScopes,
        actorUserId: session.UserID,
      });
    }

    return NextResponse.json({
      success: true,
      message: 'تم حذف الفاتورة',
      auditId: auditResult.auditId,
    });

  } catch (err: unknown) {
    if (isAuditedActionError(err)) {
      const isValidation = err.message.includes('تتطلب سبباً') || err.message.includes('مطلوب');
      return NextResponse.json(
        { success: false, error: err.message, auditId: err.failedAuditId },
        { status: isValidation ? 400 : 500 },
      );
    }
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}


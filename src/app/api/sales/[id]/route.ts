import { NextRequest, NextResponse } from "next/server";
import { getPool, sql } from "@/lib/db";
import { getSession } from "@/lib/session";
import { requireApprovalOrExecute } from '@/lib/approvalWorkflow';
import { resolveSplitPaymentConfig } from "@/lib/clearingMethod";
import { redistributeFromClearing } from "@/lib/splitPaymentService";

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
          d.Qty, d.Bonus, d.Notes,
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

// PUT /api/sales/[id] — Update existing sale invoice
// super_admin: executes immediately | others: creates pending approval
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

    const body = await req.json();

    if (!body.items || body.items.length === 0)
      return NextResponse.json({ error: 'يجب إضافة خدمة واحدة على الأقل' }, { status: 400 });

    const db = await getPool();
    const existingSnap = await db.request()
      .input('id', sql.Int, invID)
      .query(`SELECT invID, invDate, GrandTotal, Notes FROM dbo.TblinvServHead WHERE invID=@id AND invType=N'مبيعات'`);
    if (!existingSnap.recordset.length)
      return NextResponse.json({ error: 'الفاتورة غير موجودة' }, { status: 404 });

    const editWorkflow = await requireApprovalOrExecute({
      userId:      sessionUser.UserID,
      userName:    sessionUser.UserName,
      requestType: 'edit_invoice',
      entityId:    String(invID),
      actionMethod:'PUT',
      endpointPath:`/api/sales/${invID}`,
      oldDataLoader: async () => existingSnap.recordset[0],
      newData: body,
      riskLevel: 'high',
    });
    if (editWorkflow.pendingApproval)
      return NextResponse.json({ success: true, pendingApproval: true, approvalId: editWorkflow.approvalId, message: editWorkflow.message });
    if (editWorkflow.executed)
      return NextResponse.json({ success: true, message: editWorkflow.message });

    // Start transaction (non-super_admin path should not reach here, but kept for safety)
    const transaction = db.transaction();
    await transaction.begin();

    try {
      // 1. Verify invoice exists
      const existingResult = await transaction
        .request()
        .input("invID", sql.Int, invID)
        .query(
          `SELECT invID FROM [dbo].[TblinvServHead] WHERE invID = @invID AND invType = N'مبيعات'`,
        );

      if (existingResult.recordset.length === 0) {
        await transaction.rollback();
        return NextResponse.json(
          { error: "الفاتورة غير موجودة" },
          { status: 404 },
        );
      }

      // 2. Delete existing details and payment allocations
      await transaction
        .request()
        .input("invID", sql.Int, invID)
        .query(
          `DELETE FROM [dbo].[TblinvServDetail] WHERE invID = @invID AND invType = N'مبيعات'`,
        );

      await transaction
        .request()
        .input("invID", sql.Int, invID)
        .query(
          `DELETE FROM [dbo].[TblinvServPayment] WHERE invID = @invID AND invType = N'مبيعات'`,
        );

      // 3. Delete old loyalty points
      // TODO: SECURITY & AUDIT - Replace DELETE with sp_Loyalty_ReverseSalePoints
      // Current: Directly deletes ledger entries (loses audit trail of original earn)
      // Should be: Call sp_Loyalty_ReverseSalePoints to create REVERSAL entry instead
      // This preserves audit trail and properly adjusts points via ledger
      // Location: PUT /api/sales/[id] - Line ~119
      await transaction
        .request()
        .input("invID", sql.Int, invID)
        .query(
          `DELETE FROM [dbo].[TblLoyaltyPointLedger] WHERE SourceInvID = @invID`,
        );

      // 4. Delete old cash movements
      await transaction
        .request()
        .input("invID", sql.Int, invID)
        .query(`DELETE FROM [dbo].[TblCashMove] WHERE invID = @invID`);

      // 5. Calculate totals
      const subTotal = Math.max(0, body.subTotal || 0);
      const disVal = Math.max(0, body.disVal || 0);
      const grandTotal = Math.max(0, subTotal - disVal);
      const totalBonus = body.totalBonus || 0;

      // 6. Update header
      const headReq = transaction.request();
      headReq
        .input("invID", sql.Int, invID)
        .input("ClientID", sql.Int, body.clientId || null)
        .input("SubTotal", sql.Decimal(10, 2), subTotal)
        .input("Dis", sql.Decimal(5, 2), body.dis || 0)
        .input("DisVal", sql.Decimal(10, 2), disVal)
        .input("GrandTotal", sql.Decimal(10, 2), grandTotal)
        .input("TotalBonus", sql.Decimal(10, 2), totalBonus)
        .input("PayCash", sql.Decimal(10, 2), body.payCash || 0)
        .input("PayVisa", sql.Decimal(10, 2), body.payVisa || 0)
        .input("PaymentMethodID", sql.Int, body.paymentMethodId || 1)
        .input("Notes", sql.NVarChar(sql.MAX), body.notes || "مبيعات")
        .input("UserID", sql.Int, userID);

      await headReq.query(`
        UPDATE [dbo].[TblinvServHead] SET
          ClientID = @ClientID,
          SubTotal = @SubTotal,
          Dis = @Dis,
          DisVal = @DisVal,
          GrandTotal = @GrandTotal,
          TotalBonus = @TotalBonus,
          PayCash = @PayCash,
          PayVisa = @PayVisa,
          PaymentMethodID = @PaymentMethodID,
          Notes = @Notes,
          UserID = @UserID
        WHERE invID = @invID AND invType = N'مبيعات'
      `);

      // 7. Insert new details
      for (const item of body.items) {
        const itemValue = (item.sPrice || 0) * (item.qty || 1);
        const detailReq = transaction.request();
        detailReq
          .input("invID", sql.Int, invID)
          .input("invType", sql.NVarChar(20), "مبيعات")
          .input("ProID", sql.Int, item.proId)
          .input("EmpID", sql.Int, item.empId)
          .input("SPrice", sql.Decimal(10, 2), item.sPrice || 0)
          .input("SValue", sql.Decimal(10, 2), itemValue)
          .input("Qty", sql.Int, item.qty || 1)
          .input("Bonus", sql.Decimal(10, 2), item.bonus || 0)
          .input("Notes", sql.NVarChar(sql.MAX), item.notes || "");

        await detailReq.query(`
          INSERT INTO [dbo].[TblinvServDetail]
            (invID, invType, ProID, EmpID, SPrice, SValue, Qty, Bonus, Notes)
          VALUES
            (@invID, @invType, @ProID, @EmpID, @SPrice, @SValue, @Qty, @Bonus, @Notes)
        `);
      }

      // 8. Re-insert cash movement(s) using correct clearing-account architecture
      const db2 = await getPool();
      const splitCfg = await resolveSplitPaymentConfig(db2);

      const rawEditAllocations = body.paymentAllocations || [];
      const activeEditAllocations = rawEditAllocations.filter(
        (pa: { paymentMethodId: number; amount: number }) => {
          const amt = Number(pa.amount);
          return isFinite(amt) && amt > 0 && pa.paymentMethodId !== splitCfg.clearingMethodId;
        },
      );

      const isEditSplitPayment = activeEditAllocations.length > 1;
      const editHeaderPaymentMethodId = isEditSplitPayment
        ? splitCfg.clearingMethodId
        : (activeEditAllocations[0]?.paymentMethodId || body.paymentMethodId || 1);

      // Update header PaymentMethodID to reflect correct method
      await transaction.request()
        .input("invID", sql.Int, invID)
        .input("PaymentMethodID", sql.Int, editHeaderPaymentMethodId)
        .query(`UPDATE [dbo].[TblinvServHead] SET PaymentMethodID = @PaymentMethodID WHERE invID = @invID AND invType = N'مبيعات'`);

      // Re-insert TblinvServPayment rows (one per real allocation)
      const now2 = new Date();
      const payHours2 = now2.getHours();
      const payAmPm2 = payHours2 >= 12 ? "PM" : "AM";
      const payH122 = payHours2 % 12 || 12;
      const payTimeStr2 = `${now2.getFullYear()}-${String(now2.getMonth() + 1).padStart(2, "0")}-${String(now2.getDate()).padStart(2, "0")} ${String(payH122).padStart(2, "0")}:${String(now2.getMinutes()).padStart(2, "0")}:${String(now2.getSeconds()).padStart(2, "0")} ${payAmPm2}`;

      const editInvDate = now2; // Use current date for edits (TblCashMove was already cleared)
      const editInvTime = `${String(now2.getHours()).padStart(2, "0")}.${String(now2.getMinutes()).padStart(2, "0")}`;

      for (const alloc of activeEditAllocations) {
        await transaction.request()
          .input("invID", sql.Int, invID)
          .input("invType", sql.NVarChar(20), "مبيعات")
          .input("PayDate", sql.Date, editInvDate)
          .input("PayTime", sql.NVarChar(50), payTimeStr2)
          .input("PayValue", sql.Decimal(10, 2), Number(alloc.amount))
          .input("Notes", sql.NVarChar(4000), (body.notes || "مبيعات").substring(0, 4000))
          .input("PaymentMethodID", sql.Int, alloc.paymentMethodId)
          .input("ShiftMoveID", sql.Int, null)
          .query(`
            INSERT INTO [dbo].[TblinvServPayment]
              (invID, invType, PayDate, PayTime, PayValue, Notes, PaymentMethodID, ShiftMoveID)
            VALUES
              (@invID, @invType, @PayDate, @PayTime, @PayValue, @Notes, @PaymentMethodID, @ShiftMoveID)
          `);
      }

      // Re-insert TblCashMove: for single payment insert directly;
      // for mixed payment insert clearing income then redistribute.
      if (!isEditSplitPayment) {
        // Single payment — insert one 'in' row for the real method
        if (grandTotal > 0) {
          await transaction.request()
            .input("invID", sql.Int, invID)
            .input("invType", sql.NVarChar(20), "مبيعات")
            .input("GrandTotal", sql.Decimal(10, 2), grandTotal)
            .input("PaymentMethodID", sql.Int, editHeaderPaymentMethodId)
            .input("Notes", sql.NVarChar(sql.MAX), body.notes || "مبيعات")
            .input("ShiftMoveID", sql.Int, null)
            .query(`
              INSERT INTO [dbo].[TblCashMove]
                (invID, invType, invDate, invTime, GrandTolal, PaymentMethodID, inOut, Notes, ShiftMoveID)
              VALUES
                (@invID, @invType, CONVERT(date, GETDATE()), CONVERT(varchar(5), GETDATE(), 8),
                 @GrandTotal, @PaymentMethodID, N'in', @Notes, @ShiftMoveID)
            `);
        }
      } else {
        // Mixed payment — insert clearing income row first, then redistribute
        if (grandTotal > 0) {
          await transaction.request()
            .input("invID", sql.Int, invID)
            .input("invType", sql.NVarChar(20), "مبيعات")
            .input("GrandTotal", sql.Decimal(10, 2), grandTotal)
            .input("PaymentMethodID", sql.Int, splitCfg.clearingMethodId)
            .input("Notes", sql.NVarChar(sql.MAX), body.notes || "مبيعات")
            .input("ShiftMoveID", sql.Int, null)
            .query(`
              INSERT INTO [dbo].[TblCashMove]
                (invID, invType, invDate, invTime, GrandTolal, PaymentMethodID, inOut, Notes, ShiftMoveID)
              VALUES
                (@invID, @invType, CONVERT(date, GETDATE()), CONVERT(varchar(5), GETDATE(), 8),
                 @GrandTotal, @PaymentMethodID, N'in', @Notes, @ShiftMoveID)
            `);
        }

        await redistributeFromClearing({
          transaction,
          clearingMethodId: splitCfg.clearingMethodId,
          allocations: activeEditAllocations.map((a: { paymentMethodId: number; amount: number }) => ({
            paymentMethodId: a.paymentMethodId,
            amount: Number(a.amount),
          })),
          invDate: editInvDate,
          invTime: editInvTime,
          clientId: body.clientId || null,
          shiftMoveId: null,
          invoiceId: invID,
          expenseCatId: splitCfg.expenseCatId,
          incomeCatId: splitCfg.incomeCatId,
        });
      }

      // 9. Commit
      await transaction.commit();

      // 10. Recalculate loyalty points
      if (body.clientId) {
        try {
          await db
            .request()
            .input("invID", sql.Int, invID)
            .input("invType", sql.NVarChar(20), "مبيعات")
            .input("UserID", sql.Int, userID).query(`
              EXEC [dbo].[sp_Loyalty_EarnPointsFromSale]
                @invID = @invID,
                @invType = @invType,
                @UserID = @UserID
            `);
        } catch (loyaltyErr) {
          console.error("[api/sales/id] Loyalty recalc error:", loyaltyErr);
        }
      }

      return NextResponse.json({ invID, invType: "مبيعات", updated: true });
    } catch (err) {
      await transaction.rollback();
      throw err;
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[api/sales/id] PUT error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// DELETE /api/sales/[id] — Delete sale invoice
// super_admin: executes immediately | others: creates pending approval
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

    const db = await getPool();
    const existing = await db.request()
      .input('id', sql.Int, invID)
      .query(`SELECT invID, invDate, GrandTotal FROM dbo.TblinvServHead WHERE invID=@id`);
    if (!existing.recordset.length)
      return NextResponse.json({ error: 'الفاتورة غير موجودة' }, { status: 404 });

    const workflow = await requireApprovalOrExecute({
      userId:      session.UserID,
      userName:    session.UserName,
      requestType: 'delete_invoice',
      entityId:    String(invID),
      actionMethod:'DELETE',
      endpointPath:`/api/sales/${invID}`,
      oldDataLoader: async () => existing.recordset[0],
    });

    if (workflow.pendingApproval)
      return NextResponse.json({ success: true, pendingApproval: true, approvalId: workflow.approvalId, message: workflow.message });

    return NextResponse.json({ success: true, message: 'تم حذف الفاتورة' });

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}



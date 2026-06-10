import { NextRequest, NextResponse } from "next/server";
import { getPool, sql } from "@/lib/db";
import { getSession } from "@/lib/session";
import { requireRole, isAuthResult } from '@/lib/api-auth';

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

    return NextResponse.json({
      ...header,
      items: details.recordset,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[api/sales/id] GET error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// PUT /api/sales/[id] — Update existing sale invoice
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const invID = parseInt(id);
    if (isNaN(invID)) {
      return NextResponse.json({ error: "Invalid invID" }, { status: 400 });
    }

    const body = await req.json();

    // Validation
    if (!body.items || body.items.length === 0) {
      return NextResponse.json(
        { error: "يجب إضافة خدمة واحدة على الأقل" },
        { status: 400 },
      );
    }

    // Session check
    const sessionUser = await getSession();
    const userID = sessionUser?.UserID ?? 0;

    const db = await getPool();

    // Start transaction
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

      // 2. Delete existing details
      await transaction
        .request()
        .input("invID", sql.Int, invID)
        .query(
          `DELETE FROM [dbo].[TblinvServDetail] WHERE invID = @invID AND invType = N'مبيعات'`,
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

      // 8. Re-insert cash movement(s) - handle both single payment and split payment
      const paymentAllocations = body.paymentAllocations || [];
      const hasSplitPayment =
        Array.isArray(paymentAllocations) && paymentAllocations.length > 0;

      if (hasSplitPayment) {
        // Automatic Settlement for split payments:
        // 1. Record full amount as CASH income
        // 2. For each non-cash payment: record CASH expense + that method income

        const cashPaymentMethodId = 1; // Assuming ID 1 is cash

        // Step 1: Record full grandTotal as CASH income (in)
        if (grandTotal > 0) {
          const cashIncomeReq = transaction.request();
          cashIncomeReq
            .input("invID", sql.Int, invID)
            .input("invType", sql.NVarChar(20), "مبيعات")
            .input("GrandTotal", sql.Decimal(10, 2), grandTotal)
            .input("PaymentMethodID", sql.Int, cashPaymentMethodId)
            .input(
              "Notes",
              sql.NVarChar(sql.MAX),
              (body.notes || "مبيعات") + " [تسوية - وارد كاش]",
            );

          await cashIncomeReq.query(`
            INSERT INTO [dbo].[TblCashMove]
              (invID, invType, invDate, invTime, GrandTolal, PaymentMethodID, inOut, Notes)
            VALUES
              (@invID, @invType, CONVERT(date, GETDATE()), CONVERT(time, GETDATE()),
               @GrandTotal, @PaymentMethodID, N'in', @Notes)
          `);
        }

        // Step 2: For each non-cash payment, create settlement entries
        for (const alloc of paymentAllocations) {
          const allocAmount = Math.max(0, alloc.amount || 0);
          const allocMethodId = alloc.paymentMethodId || 1;

          // Skip if cash or zero amount
          if (allocAmount <= 0 || allocMethodId === cashPaymentMethodId)
            continue;

          // 2a. Record CASH expense (out) - money leaving cash to go to other method
          const cashOutReq = transaction.request();
          cashOutReq
            .input("invID", sql.Int, invID)
            .input("invType", sql.NVarChar(20), "مبيعات")
            .input("GrandTotal", sql.Decimal(10, 2), allocAmount)
            .input("PaymentMethodID", sql.Int, cashPaymentMethodId)
            .input(
              "Notes",
              sql.NVarChar(sql.MAX),
              (body.notes || "مبيعات") +
                ` [تسوية - صادر كاش -> طريقة ${allocMethodId}]`,
            );

          await cashOutReq.query(`
            INSERT INTO [dbo].[TblCashMove]
              (invID, invType, invDate, invTime, GrandTolal, PaymentMethodID, inOut, Notes)
            VALUES
              (@invID, @invType, CONVERT(date, GETDATE()), CONVERT(time, GETDATE()),
               @GrandTotal, @PaymentMethodID, N'out', @Notes)
          `);

          // 2b. Record income (in) for the actual payment method
          const methodIncomeReq = transaction.request();
          methodIncomeReq
            .input("invID", sql.Int, invID)
            .input("invType", sql.NVarChar(20), "مبيعات")
            .input("GrandTotal", sql.Decimal(10, 2), allocAmount)
            .input("PaymentMethodID", sql.Int, allocMethodId)
            .input(
              "Notes",
              sql.NVarChar(sql.MAX),
              (body.notes || "مبيعات") + " [تسوية - وارد]",
            );

          await methodIncomeReq.query(`
            INSERT INTO [dbo].[TblCashMove]
              (invID, invType, invDate, invTime, GrandTolal, PaymentMethodID, inOut, Notes)
            VALUES
              (@invID, @invType, CONVERT(date, GETDATE()), CONVERT(time, GETDATE()),
               @GrandTotal, @PaymentMethodID, N'in', @Notes)
          `);
        }
      } else {
        // Single payment method - fallback to original logic
        const cashMoveReq = transaction.request();
        cashMoveReq
          .input("invID", sql.Int, invID)
          .input("invType", sql.NVarChar(20), "مبيعات")
          .input("GrandTotal", sql.Decimal(10, 2), grandTotal)
          .input("PaymentMethodID", sql.Int, body.paymentMethodId || 1)
          .input("Notes", sql.NVarChar(sql.MAX), body.notes || "مبيعات");

        await cashMoveReq.query(`
          INSERT INTO [dbo].[TblCashMove]
            (invID, invType, invDate, invTime, GrandTolal, PaymentMethodID, inOut, Notes)
          SELECT
            @invID,
            @invType,
            CONVERT(date, GETDATE()),
            CONVERT(time, GETDATE()),
            @GrandTotal,
            @PaymentMethodID,
            N'in',
            @Notes
          WHERE @GrandTotal > 0
        `);
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

// DELETE /api/sales/[id] — Delete sale invoice (admin only)
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const authCheck = await requireRole(['admin']);
  if (!isAuthResult(authCheck)) return authCheck;

  try {
    const { id } = await params;
    const invID = parseInt(id);
    if (isNaN(invID)) {
      return NextResponse.json({ error: "Invalid invID" }, { status: 400 });
    }

    const db = await getPool();

    // Start transaction
    const transaction = db.transaction();
    await transaction.begin();

    try {
      // Delete cash movements (related to this invoice) - always clean these up
      const cashResult = await transaction
        .request()
        .input("invID", sql.Int, invID)
        .query(
          `DELETE FROM [dbo].[TblCashMove] WHERE invID = @invID AND invType = N'مبيعات'`,
        );

      // Delete loyalty points ledger entries first (FK constraint)
      // TODO: SECURITY & AUDIT - Replace DELETE with sp_Loyalty_ReverseSalePoints
      // Current: Directly deletes ledger entries (loses audit trail)
      // Should be: Call sp_Loyalty_ReverseSalePoints to create REVERSAL entry
      // This preserves audit trail when invoice is deleted
      // Location: DELETE /api/sales/[id] - Line ~391
      await transaction
        .request()
        .input("invID", sql.Int, invID)
        .query(
          `DELETE FROM [dbo].[TblLoyaltyPointLedger] WHERE SourceInvID = @invID`,
        );

      // Delete invoice details (child records)
      await transaction
        .request()
        .input("invID", sql.Int, invID)
        .query(
          `DELETE FROM [dbo].[TblinvServDetail] WHERE invID = @invID AND invType = N'مبيعات'`,
        );

      // Delete invoice header (if still exists)
      const headResult = await transaction
        .request()
        .input("invID", sql.Int, invID)
        .query(
          `DELETE FROM [dbo].[TblinvServHead] WHERE invID = @invID AND invType = N'مبيعات'`,
        );

      const invoiceExisted = headResult.rowsAffected[0] > 0;
      const cashDeleted = (cashResult.rowsAffected?.[0] ?? 0) > 0;

      // If neither invoice nor cash movement existed, then it's truly not found
      if (!invoiceExisted && !cashDeleted) {
        await transaction.rollback();
        return NextResponse.json(
          { error: "الفاتورة غير موجودة" },
          { status: 404 },
        );
      }

      await transaction.commit();

      if (!invoiceExisted && cashDeleted) {
        // Cleanup case: invoice was already gone, but we cleaned up orphaned cash record
        return NextResponse.json({
          success: true,
          message: "تم تنظيف السجل اليتيم من حركة الخزنة",
          cleanedUp: true,
        });
      }

      return NextResponse.json({
        success: true,
        message: "تم حذف الفاتورة بنجاح",
      });
    } catch (err) {
      await transaction.rollback();
      throw err;
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[api/sales/id] DELETE error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

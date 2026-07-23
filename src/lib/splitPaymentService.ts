import { sql, allocateInvID } from "@/lib/db";
import type { Transaction } from "mssql";

export interface PaymentTransferParams {
  transaction: Transaction;
  /** Never trust browser branchId — always resolved from gated session context. */
  branchId: number;
  /** Nullable only for legacy invoices predating the business-day migration. */
  businessDayId: number | null;
  invDate: Date | string;
  invTime: string;
  clientId: number | null;
  shiftMoveId: number | null;
  fromPaymentMethodId: number;
  toPaymentMethodId: number;
  amount: number;
  expenseCatId: number;
  incomeCatId: number;
  notes: string;
}

/**
 * Insert a paired treasury transfer inside an existing SQL transaction.
 *
 * Creates:
 *   1. An expense row (inOut='out') on fromPaymentMethodId  — money leaves
 *   2. An income  row (inOut='in')  on toPaymentMethodId    — money arrives
 *
 * Both rows use invType = 'مصروفات' / 'ايرادات' respectively so they appear
 * in the treasury balance queries but are excluded from operating revenue/expense
 * totals when the dedicated transfer categories are filtered out.
 *
 * This function is reused by:
 *   - Invoice split-payment redistribution (no approval required)
 *   - Manual treasury transfers via /api/treasury/transfer (approval required)
 */
export async function insertPaymentTransferPair(
  p: PaymentTransferParams,
): Promise<{ expenseId: number; incomeId: number }> {
  // Allocate invIDs safely using application locks (no TABLOCKX)
  const expenseInvID = await allocateInvID(p.transaction as sql.Transaction, 'TblCashMove', 'مصروفات', 5000);
  const incomeInvID = await allocateInvID(p.transaction as sql.Transaction, 'TblCashMove', 'ايرادات', 5000);

  // 1. Expense (out) — money leaves the source method
  const expReq = new sql.Request(p.transaction);
  expReq
    .input("invID", sql.Int, expenseInvID)
    .input("invType", sql.NVarChar(20), "مصروفات")
    .input("invDate", sql.Date, p.invDate)
    .input("invTime", sql.NVarChar(50), p.invTime)
    .input("ClientID", sql.Int, p.clientId)
    .input("ExpINID", sql.Int, p.expenseCatId)
    .input("GrandTolal", sql.Decimal(10, 2), p.amount)
    .input("inOut", sql.NVarChar(5), "out")
    .input("Notes", sql.NVarChar(sql.MAX), p.notes)
    .input("ShiftMoveID", sql.Int, p.shiftMoveId)
    .input("PaymentMethodID", sql.Int, p.fromPaymentMethodId)
    .input("BranchID", sql.Int, p.branchId)
    .input("BusinessDayID", sql.Int, p.businessDayId);

  const expRes = await expReq.query(`
    INSERT INTO [dbo].[TblCashMove]
      (invID, invType, invDate, invTime, ClientID, ExpINID, GrandTolal, inOut, Notes, ShiftMoveID, PaymentMethodID, BranchID, BusinessDayID)
    OUTPUT INSERTED.ID
    VALUES
      (@invID, @invType, @invDate, @invTime, @ClientID, @ExpINID, @GrandTolal, @inOut, @Notes, @ShiftMoveID, @PaymentMethodID, @BranchID, @BusinessDayID)
  `);
  const expenseId: number = expRes.recordset[0].ID;

  // 2. Income (in) — money arrives at the destination method
  const incReq = new sql.Request(p.transaction);
  incReq
    .input("invID", sql.Int, incomeInvID)
    .input("invType", sql.NVarChar(20), "ايرادات")
    .input("invDate", sql.Date, p.invDate)
    .input("invTime", sql.NVarChar(50), p.invTime)
    .input("ClientID", sql.Int, p.clientId)
    .input("ExpINID", sql.Int, p.incomeCatId)
    .input("GrandTolal", sql.Decimal(10, 2), p.amount)
    .input("inOut", sql.NVarChar(5), "in")
    .input("Notes", sql.NVarChar(sql.MAX), p.notes)
    .input("ShiftMoveID", sql.Int, p.shiftMoveId)
    .input("PaymentMethodID", sql.Int, p.toPaymentMethodId)
    .input("BranchID", sql.Int, p.branchId)
    .input("BusinessDayID", sql.Int, p.businessDayId);

  const incRes = await incReq.query(`
    INSERT INTO [dbo].[TblCashMove]
      (invID, invType, invDate, invTime, ClientID, ExpINID, GrandTolal, inOut, Notes, ShiftMoveID, PaymentMethodID, BranchID, BusinessDayID)
    OUTPUT INSERTED.ID
    VALUES
      (@invID, @invType, @invDate, @invTime, @ClientID, @ExpINID, @GrandTolal, @inOut, @Notes, @ShiftMoveID, @PaymentMethodID, @BranchID, @BusinessDayID)
  `);
  const incomeId: number = incRes.recordset[0].ID;

  return { expenseId, incomeId };
}

export interface SplitAllocation {
  paymentMethodId: number;
  amount: number;
}

/**
 * Redistribute the full invoice amount from the clearing account to each real
 * payment method, inserting paired transfer rows for every allocation.
 *
 * Called inside the invoice creation / edit transaction only.
 * Does NOT require any approval workflow.
 */
export async function redistributeFromClearing(params: {
  transaction: Transaction;
  /** Never trust browser branchId — always resolved from gated session context or invoice head. */
  branchId: number;
  businessDayId: number | null;
  clearingMethodId: number;
  allocations: SplitAllocation[];
  invDate: Date | string;
  invTime: string;
  clientId: number | null;
  shiftMoveId: number | null;
  invoiceId: number;
  expenseCatId: number;
  incomeCatId: number;
}): Promise<void> {
  const {
    transaction,
    branchId,
    businessDayId,
    clearingMethodId,
    allocations,
    invDate,
    invTime,
    clientId,
    shiftMoveId,
    invoiceId,
    expenseCatId,
    incomeCatId,
  } = params;

  // Look up payment method names once for all allocations
  const methodIds = allocations.map((a) => a.paymentMethodId).filter((id) => id > 0);
  let methodNames: Map<number, string> = new Map();
  if (methodIds.length > 0) {
    try {
      const nmRes = await new sql.Request(transaction).query(`
        SELECT PaymentID, PaymentMethod
        FROM [dbo].[TblPaymentMethods]
        WHERE PaymentID IN (${methodIds.join(",")})
      `);
      for (const row of nmRes.recordset) {
        methodNames.set(row.PaymentID, row.PaymentMethod || String(row.PaymentID));
      }
    } catch {
      // Non-critical — fall back to IDs in notes
    }
  }

  for (const alloc of allocations) {
    if (alloc.amount <= 0) continue;

    const methodName = methodNames.get(alloc.paymentMethodId) || String(alloc.paymentMethodId);
    const transferNote = `تسوية فاتورة ${invoiceId} - حساب التسوية إلى ${methodName}`;

    await insertPaymentTransferPair({
      transaction,
      branchId,
      businessDayId,
      invDate,
      invTime,
      clientId,
      shiftMoveId,
      fromPaymentMethodId: clearingMethodId,
      toPaymentMethodId: alloc.paymentMethodId,
      amount: alloc.amount,
      expenseCatId,
      incomeCatId,
      notes: transferNote,
    });
  }
}

/**
 * Reverse split-payment clearing transfers for a cancelled / deleted invoice.
 * Reads the original TblinvServPayment rows and inserts counter-transfers.
 */
export async function reverseSplitPaymentTransfers(params: {
  transaction: Transaction;
  /** Never trust browser branchId — always resolved from gated session context or invoice head. */
  branchId: number;
  businessDayId: number | null;
  invoiceId: number;
  invoiceType: string;
  clearingMethodId: number;
  invDate: Date | string;
  invTime: string;
  clientId: number | null;
  shiftMoveId: number | null;
  expenseCatId: number;
  incomeCatId: number;
}): Promise<void> {
  const {
    transaction,
    branchId,
    businessDayId,
    invoiceId,
    invoiceType,
    clearingMethodId,
    invDate,
    invTime,
    clientId,
    shiftMoveId,
    expenseCatId,
    incomeCatId,
  } = params;

  // Read original real payment allocations
  const payRows = await new sql.Request(transaction)
    .input("invID", sql.Int, invoiceId)
    .input("invType", sql.NVarChar(20), invoiceType)
    .query(`
      SELECT PaymentMethodID, ISNULL(PayValue, 0) AS PayValue
      FROM [dbo].[TblinvServPayment]
      WHERE invID = @invID AND invType = @invType AND ISNULL(PayValue, 0) > 0
    `);

  for (const row of payRows.recordset) {
    if (!row.PaymentMethodID || row.PayValue <= 0) continue;

    // Reverse: money flows BACK from real method INTO clearing
    await insertPaymentTransferPair({
      transaction,
      branchId,
      businessDayId,
      invDate,
      invTime,
      clientId,
      shiftMoveId,
      fromPaymentMethodId: row.PaymentMethodID,
      toPaymentMethodId: clearingMethodId,
      amount: row.PayValue,
      expenseCatId,
      incomeCatId,
      notes: `إلغاء فاتورة ${invoiceId} - عكس تسوية الدفع المختلط`,
    });
  }
}

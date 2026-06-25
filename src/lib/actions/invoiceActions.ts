/**
 * Invoice (sales) domain actions — single execution path.
 */

import { sql } from '@/lib/db';
import { resolveSplitPaymentConfig } from '@/lib/clearingMethod';
import { redistributeFromClearing } from '@/lib/splitPaymentService';

export interface InvoiceItemInput {
  proId: number;
  empId: number;
  serviceId?: number;
  sPrice: number;
  qty: number;
  disVal?: number;
  discount?: number;
  sValue?: number;
  total?: number;
  bonus?: number;
  notes?: string;
}

export interface InvoicePaymentAllocationInput {
  paymentMethodId: number;
  amount: number;
}

export interface UpdateInvoiceInput {
  clientId?: number;
  subTotal: number;
  dis?: number;
  disVal: number;
  grandTotal: number;
  totalBonus?: number;
  payCash?: number;
  payVisa?: number;
  paymentMethodId?: number;
  notes?: string;
  items: InvoiceItemInput[];
  paymentAllocations?: InvoicePaymentAllocationInput[];
}

export interface InvoiceHeaderSnapshot {
  invID: number;
  invType: string;
  invDate: Date | string;
  ClientID: number | null;
  SubTotal: number;
  Dis: number;
  DisVal: number;
  Tax: number;
  TaxVal: number;
  GrandTotal: number;
  TotalBonus: number;
  PayCash: number;
  PayVisa: number;
  PaymentMethodID: number;
  Notes: string;
  customerName?: string;
  customerPhone?: string;
}

export interface InvoiceDetailSnapshot {
  ProID: number;
  EmpID: number;
  SPrice: number;
  SValue: number;
  SPriceAfterDis: number | null;
  Qty: number;
  Bonus: number;
  Notes: string | null;
  ProName?: string;
  EmpName?: string;
}

export interface InvoicePaymentSnapshot {
  PaymentMethodID: number;
  PaymentMethodName: string;
  PayValue: number;
}

export interface InvoiceCashMoveSnapshot {
  ID: number;
  PaymentMethodID: number;
  GrandTolal: number;
  inOut: string;
  Notes: string | null;
}

export interface InvoiceSnapshot {
  header: InvoiceHeaderSnapshot;
  details: InvoiceDetailSnapshot[];
  payments: InvoicePaymentSnapshot[];
  cashMoves: InvoiceCashMoveSnapshot[];
  loyaltyEntries: unknown[];
}

export interface UpdateInvoiceResult {
  invID: number;
  invType: string;
  updated: true;
  paymentMethodId: number;
  isSplitPayment: boolean;
}

export async function getInvoiceSnapshot(
  transaction: sql.Transaction,
  invID: number,
): Promise<InvoiceSnapshot | null> {
  const head = await new sql.Request(transaction)
    .input('invID', sql.Int, invID)
    .query(`
      SELECT
        h.invID, h.invType, h.invDate, h.ClientID, h.SubTotal, h.Dis, h.DisVal,
        h.Tax, h.TaxVal, h.GrandTotal, h.TotalBonus, h.PayCash, h.PayVisa,
        h.PaymentMethodID, h.Notes,
        c.[Name] AS customerName, c.Mobile AS customerPhone
      FROM dbo.TblinvServHead h
      LEFT JOIN dbo.TblClient c ON h.ClientID = c.ClientID
      WHERE h.invID = @invID AND h.invType = N'مبيعات'
    `);

  if (head.recordset.length === 0) return null;

  const [details, payments, cashMoves, loyalty] = await Promise.all([
    new sql.Request(transaction)
      .input('invID', sql.Int, invID)
      .query(`
        SELECT d.ProID, d.EmpID, d.SPrice, d.SValue, d.SPriceAfterDis, d.Qty, d.Bonus, d.Notes,
               p.ProName, e.EmpName
        FROM dbo.TblinvServDetail d
        LEFT JOIN dbo.TblPro p ON d.ProID = p.ProID
        LEFT JOIN dbo.TblEmp e ON d.EmpID = e.EmpID
        WHERE d.invID = @invID AND d.invType = N'مبيعات'
      `),
    new sql.Request(transaction)
      .input('invID', sql.Int, invID)
      .query(`
        SELECT p.PaymentMethodID, pm.PaymentMethod AS PaymentMethodName, p.PayValue
        FROM dbo.TblinvServPayment p
        LEFT JOIN dbo.TblPaymentMethods pm ON p.PaymentMethodID = pm.PaymentID
        WHERE p.invID = @invID AND p.invType = N'مبيعات' AND ISNULL(p.PayValue, 0) > 0
      `),
    new sql.Request(transaction)
      .input('invID', sql.Int, invID)
      .query(`
        SELECT ID, PaymentMethodID, GrandTolal, inOut, Notes
        FROM dbo.TblCashMove WHERE invID = @invID
      `),
    new sql.Request(transaction)
      .input('invID', sql.Int, invID)
      .query(`SELECT * FROM dbo.TblLoyaltyPointLedger WHERE SourceInvID = @invID`),
  ]);

  return {
    header: head.recordset[0],
    details: details.recordset,
    payments: payments.recordset,
    cashMoves: cashMoves.recordset,
    loyaltyEntries: loyalty.recordset,
  };
}

export async function deleteInvoice(
  transaction: sql.Transaction,
  invID: number,
): Promise<void> {
  await new sql.Request(transaction)
    .input('id', sql.Int, invID)
    .query(`DELETE FROM dbo.TblCashMove WHERE InvID = @id`);
  await new sql.Request(transaction)
    .input('id', sql.Int, invID)
    .query(`DELETE FROM dbo.TblLoyaltyPointLedger WHERE SourceInvID = @id`);
  await new sql.Request(transaction)
    .input('id', sql.Int, invID)
    .query(`DELETE FROM dbo.TblinvServDetail WHERE invID = @id AND invType = N'مبيعات'`);
  await new sql.Request(transaction)
    .input('id', sql.Int, invID)
    .query(`DELETE FROM dbo.TblinvServPayment WHERE invID = @id AND invType = N'مبيعات'`);
  await new sql.Request(transaction)
    .input('id', sql.Int, invID)
    .query(`DELETE FROM dbo.TblinvServHead WHERE invID = @id`);
}

export async function updateInvoice(
  transaction: sql.Transaction,
  invID: number,
  input: UpdateInvoiceInput,
  userID: number,
): Promise<UpdateInvoiceResult> {
  const existing = await new sql.Request(transaction)
    .input('invID', sql.Int, invID)
    .query(`SELECT invID FROM dbo.TblinvServHead WHERE invID = @invID AND invType = N'مبيعات'`);

  if (existing.recordset.length === 0) {
    throw new Error('الفاتورة غير موجودة');
  }

  // 1. Delete old children
  await new sql.Request(transaction)
    .input('invID', sql.Int, invID)
    .query(`DELETE FROM dbo.TblinvServDetail WHERE invID = @invID AND invType = N'مبيعات'`);
  await new sql.Request(transaction)
    .input('invID', sql.Int, invID)
    .query(`DELETE FROM dbo.TblinvServPayment WHERE invID = @invID AND invType = N'مبيعات'`);
  await new sql.Request(transaction)
    .input('invID', sql.Int, invID)
    .query(`DELETE FROM dbo.TblLoyaltyPointLedger WHERE SourceInvID = @invID`);
  await new sql.Request(transaction)
    .input('invID', sql.Int, invID)
    .query(`DELETE FROM dbo.TblCashMove WHERE invID = @invID`);

  // 2. Calculate totals
  const subTotal = Math.max(0, input.subTotal || 0);
  const disVal = Math.max(0, input.disVal || 0);
  const grandTotal = Math.max(0, subTotal - disVal);
  const totalBonus = input.totalBonus || 0;

  // 3. Update header
  await new sql.Request(transaction)
    .input('invID', sql.Int, invID)
    .input('ClientID', sql.Int, input.clientId || null)
    .input('SubTotal', sql.Decimal(10, 2), subTotal)
    .input('Dis', sql.Decimal(5, 2), input.dis || 0)
    .input('DisVal', sql.Decimal(10, 2), disVal)
    .input('GrandTotal', sql.Decimal(10, 2), grandTotal)
    .input('TotalBonus', sql.Decimal(10, 2), totalBonus)
    .input('PayCash', sql.Decimal(10, 2), input.payCash || 0)
    .input('PayVisa', sql.Decimal(10, 2), input.payVisa || 0)
    .input('PaymentMethodID', sql.Int, input.paymentMethodId || 1)
    .input('Notes', sql.NVarChar(sql.MAX), input.notes || 'مبيعات')
    .input('UserID', sql.Int, userID)
    .query(`
      UPDATE dbo.TblinvServHead SET
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

  // 4. Insert new details
  for (const item of input.items) {
    const itemValue = (item.sPrice || 0) * (item.qty || 1);
    const empId = Number(item.empId) || 0;
    await new sql.Request(transaction)
      .input('invID', sql.Int, invID)
      .input('invType', sql.NVarChar(20), 'مبيعات')
      .input('ProID', sql.Int, item.proId)
      .input('EmpID', sql.Int, empId)
      .input('SPrice', sql.Decimal(10, 2), item.sPrice || 0)
      .input('SValue', sql.Decimal(10, 2), itemValue)
      .input('Qty', sql.Int, item.qty || 1)
      .input('Bonus', sql.Decimal(10, 2), item.bonus || 0)
      .input('Notes', sql.NVarChar(sql.MAX), item.notes || '')
      .query(`
        INSERT INTO dbo.TblinvServDetail (invID, invType, ProID, EmpID, Qty, SPrice, SValue, Notes, Bonus)
        VALUES (@invID, @invType, @ProID, @EmpID, @Qty, @SPrice, @SValue, @Notes, @Bonus)
      `);
  }

  // 5. Resolve split payment config
  const db = transaction; // use same transaction for split payment resolution
  const splitCfg = await resolveSplitPaymentConfig(db);

  const rawAllocations = input.paymentAllocations || [];
  const activeAllocations = rawAllocations.filter(
    (pa: InvoicePaymentAllocationInput) => {
      const amt = Number(pa.amount);
      return isFinite(amt) && amt > 0 && pa.paymentMethodId !== splitCfg.clearingMethodId;
    },
  );

  const isSplitPayment = activeAllocations.length > 1;
  const headerPaymentMethodId = isSplitPayment
    ? splitCfg.clearingMethodId
    : (activeAllocations[0]?.paymentMethodId || input.paymentMethodId || 1);

  await new sql.Request(transaction)
    .input('invID', sql.Int, invID)
    .input('PaymentMethodID', sql.Int, headerPaymentMethodId)
    .query(`UPDATE dbo.TblinvServHead SET PaymentMethodID = @PaymentMethodID WHERE invID = @invID AND invType = N'مبيعات'`);

  // 6. Insert payment allocations
  const now = new Date();
  const payHours = now.getHours();
  const payAmPm = payHours >= 12 ? 'PM' : 'AM';
  const payH12 = payHours % 12 || 12;
  const payTimeStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(payH12).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')} ${payAmPm}`;
  const editInvDate = now;
  const editInvTime = `${String(now.getHours()).padStart(2, '0')}.${String(now.getMinutes()).padStart(2, '0')}`;

  for (const alloc of activeAllocations) {
    await new sql.Request(transaction)
      .input('invID', sql.Int, invID)
      .input('invType', sql.NVarChar(20), 'مبيعات')
      .input('PayDate', sql.Date, editInvDate)
      .input('PayTime', sql.NVarChar(50), payTimeStr)
      .input('PayValue', sql.Decimal(10, 2), Number(alloc.amount))
      .input('Notes', sql.NVarChar(4000), (input.notes || 'مبيعات').substring(0, 4000))
      .input('PaymentMethodID', sql.Int, alloc.paymentMethodId)
      .input('ShiftMoveID', sql.Int, null)
      .query(`
        INSERT INTO dbo.TblinvServPayment (invID, invType, PayDate, PayTime, PayValue, Notes, PaymentMethodID, ShiftMoveID)
        VALUES (@invID, @invType, @PayDate, @PayTime, @PayValue, @Notes, @PaymentMethodID, @ShiftMoveID)
      `);
  }

  // 7. Re-insert cash movement
  if (!isSplitPayment) {
    if (grandTotal > 0) {
      await new sql.Request(transaction)
        .input('invID', sql.Int, invID)
        .input('invType', sql.NVarChar(20), 'مبيعات')
        .input('GrandTotal', sql.Decimal(10, 2), grandTotal)
        .input('PaymentMethodID', sql.Int, headerPaymentMethodId)
        .input('Notes', sql.NVarChar(sql.MAX), input.notes || 'مبيعات')
        .input('ShiftMoveID', sql.Int, null)
        .query(`
          INSERT INTO dbo.TblCashMove (invID, invType, invDate, invTime, GrandTolal, PaymentMethodID, inOut, Notes, ShiftMoveID)
          VALUES (@invID, @invType, CONVERT(date, GETDATE()), CONVERT(varchar(5), GETDATE(), 8),
                  @GrandTotal, @PaymentMethodID, N'in', @Notes, @ShiftMoveID)
        `);
    }
  } else {
    if (grandTotal > 0) {
      await new sql.Request(transaction)
        .input('invID', sql.Int, invID)
        .input('invType', sql.NVarChar(20), 'مبيعات')
        .input('GrandTotal', sql.Decimal(10, 2), grandTotal)
        .input('PaymentMethodID', sql.Int, splitCfg.clearingMethodId)
        .input('Notes', sql.NVarChar(sql.MAX), input.notes || 'مبيعات')
        .input('ShiftMoveID', sql.Int, null)
        .query(`
          INSERT INTO dbo.TblCashMove (invID, invType, invDate, invTime, GrandTolal, PaymentMethodID, inOut, Notes, ShiftMoveID)
          VALUES (@invID, @invType, CONVERT(date, GETDATE()), CONVERT(varchar(5), GETDATE(), 8),
                  @GrandTotal, @PaymentMethodID, N'in', @Notes, @ShiftMoveID)
        `);
    }

    await redistributeFromClearing({
      transaction,
      clearingMethodId: splitCfg.clearingMethodId,
      allocations: activeAllocations.map((a) => ({
        paymentMethodId: a.paymentMethodId,
        amount: Number(a.amount),
      })),
      invDate: editInvDate,
      invTime: editInvTime,
      clientId: input.clientId || null,
      shiftMoveId: null,
      invoiceId: invID,
      expenseCatId: splitCfg.expenseCatId,
      incomeCatId: splitCfg.incomeCatId,
    });
  }

  return {
    invID,
    invType: 'مبيعات',
    updated: true,
    paymentMethodId: headerPaymentMethodId,
    isSplitPayment,
  };
}

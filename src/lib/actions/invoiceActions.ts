/**
 * Invoice (sales) domain actions — single execution path.
 */

import { sql } from '@/lib/db';
import { resolveSplitPaymentConfig } from '@/lib/clearingMethod';
import { redistributeFromClearing } from '@/lib/splitPaymentService';
import {
  computeInvoiceItemsTotals,
  hasNonZeroHeaderDiscount,
} from '@/lib/sales/service-line-totals';
import { roundMoney } from '@/lib/reportMonthUtils';

export interface InvoiceItemInput {
  proId: number;
  empId: number;
  serviceId?: number;
  sPrice: number;
  qty: number;
  dis?: number;
  disVal?: number;
  discount?: number;
  sValue?: number;
  total?: number;
  bonus?: number;
  notes?: string;
  sPriceAfterDis?: number;
}

export interface InvoicePaymentAllocationInput {
  paymentMethodId: number;
  amount: number;
}

export interface UpdateInvoiceInput {
  clientId?: number;
  subTotal?: number;
  dis?: number;
  disVal?: number;
  grandTotal?: number;
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
  Dis: number | null;
  DisVal: number | null;
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

  const details = await new sql.Request(transaction)
    .input('invID', sql.Int, invID)
    .query(`
      SELECT d.ProID, d.EmpID, d.SPrice, d.SValue, d.SPriceAfterDis, d.Dis, d.DisVal, d.Qty, d.Bonus, d.Notes,
             p.ProName, e.EmpName
      FROM dbo.TblinvServDetail d
      LEFT JOIN dbo.TblPro p ON d.ProID = p.ProID
      LEFT JOIN dbo.TblEmp e ON d.EmpID = e.EmpID
      WHERE d.invID = @invID AND d.invType = N'مبيعات'
    `);
  const payments = await new sql.Request(transaction)
    .input('invID', sql.Int, invID)
    .query(`
      SELECT p.PaymentMethodID, pm.PaymentMethod AS PaymentMethodName, p.PayValue
      FROM dbo.TblinvServPayment p
      LEFT JOIN dbo.TblPaymentMethods pm ON p.PaymentMethodID = pm.PaymentID
      WHERE p.invID = @invID AND p.invType = N'مبيعات' AND ISNULL(p.PayValue, 0) > 0
    `);
  const cashMoves = await new sql.Request(transaction)
    .input('invID', sql.Int, invID)
    .query(`
      SELECT ID, PaymentMethodID, GrandTolal, inOut, Notes
      FROM dbo.TblCashMove WHERE invID = @invID
    `);
  const loyalty = await new sql.Request(transaction)
    .input('invID', sql.Int, invID)
    .query(`SELECT * FROM dbo.TblLoyaltyPointLedger WHERE SourceInvID = @invID`);

  return {
    header: head.recordset[0],
    details: details.recordset,
    payments: payments.recordset,
    cashMoves: cashMoves.recordset,
    loyaltyEntries: loyalty.recordset,
  };
}

/**
 * Delete an invoice. `activeBranchId` must come from the caller's gated
 * session context — never from the request payload — and must match the
 * invoice's own BranchID or the delete is rejected.
 */
export async function deleteInvoice(
  transaction: sql.Transaction,
  invID: number,
  activeBranchId: number,
): Promise<void> {
  const head = await new sql.Request(transaction)
    .input('invID', sql.Int, invID)
    .query(`SELECT BranchID FROM dbo.TblinvServHead WHERE invID = @invID AND invType = N'مبيعات'`);
  const headRow = head.recordset[0];
  if (!headRow) {
    throw new Error('الفاتورة غير موجودة');
  }
  if (Number(headRow.BranchID) !== Number(activeBranchId)) {
    throw new Error('الفاتورة لا تنتمي للفرع النشط — لا يمكن حذفها');
  }

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
    .query(`
      SELECT invID, BranchID, BusinessDayID, Dis, DisVal, SubTotal, GrandTotal
      FROM dbo.TblinvServHead
      WHERE invID = @invID AND invType = N'مبيعات'
    `);

  if (existing.recordset.length === 0) {
    throw new Error('الفاتورة غير موجودة');
  }

  const existingHead = existing.recordset[0] as {
    BranchID: number;
    BusinessDayID: number | null;
    Dis: number | null;
    DisVal: number | null;
  };

  // Ownership is always read from the existing head — never accepted from the payload.
  const headBranchId: number = Number(existingHead.BranchID);
  const headBusinessDayId: number | null =
    existingHead.BusinessDayID == null ? null : Number(existingHead.BusinessDayID);

  const preservedHeaderDis = roundMoney(Math.max(0, Number(existingHead.Dis ?? 0)));
  const preservedHeaderDisVal = roundMoney(Math.max(0, Number(existingHead.DisVal ?? 0)));
  const isLegacyHeaderDiscount = preservedHeaderDisVal > 0;

  // New invoices must not gain a header discount via update.
  if (!isLegacyHeaderDiscount && hasNonZeroHeaderDiscount(input)) {
    throw new Error('خصم إجمالي الفاتورة غير مسموح — استخدم خصم كل خدمة على حدة');
  }

  const computed = computeInvoiceItemsTotals(
    input.items.map((item) => ({
      sPrice: item.sPrice,
      qty: item.qty,
      discountPercent: item.dis ?? item.discount,
      discountValue: item.disVal,
      bonus: item.bonus,
    })),
  );

  const subTotal = computed.subTotal;
  // Legacy: keep header Dis/DisVal; GrandTotal = SubTotal − header DisVal (classic).
  // New: header Dis/DisVal = 0; GrandTotal = Σ line nets.
  const headerDis = isLegacyHeaderDiscount ? preservedHeaderDis : 0;
  const headerDisVal = isLegacyHeaderDiscount ? preservedHeaderDisVal : 0;
  const grandTotal = isLegacyHeaderDiscount
    ? roundMoney(Math.max(0, subTotal - headerDisVal))
    : computed.grandTotal;
  const totalBonus = computed.totalBonus;

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

  // 2. Update header
  await new sql.Request(transaction)
    .input('invID', sql.Int, invID)
    .input('ClientID', sql.Int, input.clientId || null)
    .input('SubTotal', sql.Decimal(10, 2), subTotal)
    .input('Dis', sql.Decimal(5, 2), headerDis)
    .input('DisVal', sql.Decimal(10, 2), headerDisVal)
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

  // 3. Insert new details — same price/discount columns as create
  for (let i = 0; i < input.items.length; i++) {
    const item = input.items[i]!;
    const line = computed.lines[i]!;
    const empId = Number(item.empId) || 0;
    await new sql.Request(transaction)
      .input('invID', sql.Int, invID)
      .input('invType', sql.NVarChar(20), 'مبيعات')
      .input('ProID', sql.Int, item.proId)
      .input('EmpID', sql.Int, empId)
      .input('Dis', sql.Decimal(8, 2), line.discountPercent)
      .input('DisVal', sql.Decimal(8, 2), line.discountValue)
      .input('SPrice', sql.Decimal(10, 2), item.sPrice || 0)
      .input('SValue', sql.Decimal(10, 2), line.grossAmount)
      .input('SPriceAfterDis', sql.Decimal(10, 2), line.netAmount)
      .input('PPrice', sql.Decimal(10, 2), 0)
      .input('PValue', sql.Decimal(10, 2), 0)
      .input('Qty', sql.Decimal(8, 2), item.qty > 0 ? item.qty : 1)
      .input('Notes', sql.NVarChar(50), (item.notes || '').substring(0, 50))
      .input('Bonus', sql.Decimal(8, 2), item.bonus || 0)
      .query(`
        INSERT INTO dbo.TblinvServDetail (
          invID, invType, EmpID, ProID,
          Dis, DisVal, SPrice, SValue, SPriceAfterDis,
          PPrice, PValue, Qty, ProType, Notes, Bonus, ReservDate
        ) VALUES (
          @invID, @invType, @EmpID, @ProID,
          @Dis, @DisVal, @SPrice, @SValue, @SPriceAfterDis,
          @PPrice, @PValue, @Qty, NULL, @Notes, @Bonus, NULL
        )
      `);
  }

  // 4. Resolve split payment config
  const db = transaction;
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

  // 7. Re-insert cash movement — ownership always stamped from the invoice head
  if (!isSplitPayment) {
    if (grandTotal > 0) {
      await new sql.Request(transaction)
        .input('invID', sql.Int, invID)
        .input('invType', sql.NVarChar(20), 'مبيعات')
        .input('GrandTotal', sql.Decimal(10, 2), grandTotal)
        .input('PaymentMethodID', sql.Int, headerPaymentMethodId)
        .input('Notes', sql.NVarChar(sql.MAX), input.notes || 'مبيعات')
        .input('ShiftMoveID', sql.Int, null)
        .input('BranchID', sql.Int, headBranchId)
        .input('BusinessDayID', sql.Int, headBusinessDayId)
        .query(`
          INSERT INTO dbo.TblCashMove (invID, invType, invDate, invTime, GrandTolal, PaymentMethodID, inOut, Notes, ShiftMoveID, BranchID, BusinessDayID)
          VALUES (@invID, @invType, CONVERT(date, GETDATE()), CONVERT(varchar(5), GETDATE(), 8),
                  @GrandTotal, @PaymentMethodID, N'in', @Notes, @ShiftMoveID, @BranchID, @BusinessDayID)
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
        .input('BranchID', sql.Int, headBranchId)
        .input('BusinessDayID', sql.Int, headBusinessDayId)
        .query(`
          INSERT INTO dbo.TblCashMove (invID, invType, invDate, invTime, GrandTolal, PaymentMethodID, inOut, Notes, ShiftMoveID, BranchID, BusinessDayID)
          VALUES (@invID, @invType, CONVERT(date, GETDATE()), CONVERT(varchar(5), GETDATE(), 8),
                  @GrandTotal, @PaymentMethodID, N'in', @Notes, @ShiftMoveID, @BranchID, @BusinessDayID)
        `);
    }

    await redistributeFromClearing({
      transaction,
      branchId: headBranchId,
      businessDayId: headBusinessDayId,
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

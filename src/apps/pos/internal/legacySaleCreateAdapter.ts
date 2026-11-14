import 'server-only';

import type { Transaction } from 'mssql';
import { sql, allocateInvID } from '@/lib/db';
import type { SplitPaymentConfig } from '@/lib/clearingMethod';
import { redistributeFromClearing } from '@/lib/splitPaymentService';
import type { InvoiceItemsTotals } from '@/lib/sales/service-line-totals';
import { getCairoInvTimeDotStr, getCairoPayTimeStr } from '@/lib/businessDate';
import { lockOperationalWrite } from '@/lib/branch/operationalGates';
import type { TargetRecalcScope } from '@/lib/payroll/employee-target/employee-target-recalc-scope';
import type { SaleCashMovePoster } from '../public/saleCashMovePoster';
import type { InvoicePaymentAllocationInput } from './legacySaleRepository';

export type LegacySaleCreateItemInput = {
  proId: number;
  /** 0/null = retail product line (no barber commission). */
  empId: number | null;
  sPrice: number;
  bonus: number;
  qty: number;
  dis: number;
  disVal: number;
  notes: string;
};

export type LegacySaleCreateTransactionInput = {
  items: LegacySaleCreateItemInput[];
  clientId: number | null;
  /** Tenant from signed staff session (not browser authority). */
  tenantId?: string;
  referralCode?: string | null;
  referralVoucherId?: number | null;
  idempotency?: import('@/lib/sales/saleRequestIdempotency.service').SaleIdempotencyIntent | null;
  notes: string;
  notes2?: string;
  payCash: number;
  payVisa: number;
  paymentAllocations: InvoicePaymentAllocationInput[];
  computed: InvoiceItemsTotals;
  branchId: number;
  businessDayId: number;
  shiftMoveID: number;
  invDate: string | Date;
  userID: number;
  splitCfg: SplitPaymentConfig;
  activeAllocations: InvoicePaymentAllocationInput[];
  isSplitPayment: boolean;
  headerPaymentMethodId: number;
  /** When set, Treasury posts the initial sale CashMove before head insert (DRVO-009). */
  postSaleCashMove?: SaleCashMovePoster | null;
};

export type LegacySaleCreateTransactionResult = {
  invID: number;
  invType: string;
  targetRecalcScopes: TargetRecalcScope[];
};

export async function executeLegacySaleCreateTransaction(
  transaction: Transaction,
  input: LegacySaleCreateTransactionInput,
): Promise<LegacySaleCreateTransactionResult> {
  const {
    items,
    clientId,
    notes,
    notes2,
    payCash,
    payVisa,
    computed,
    branchId,
    businessDayId,
    shiftMoveID,
    invDate,
    userID,
    splitCfg,
    activeAllocations,
    isSplitPayment,
    headerPaymentMethodId,
  } = input;

  const subTotal = computed.subTotal;
  const disPercent = computed.headerDiscountPercent;
  const disVal = computed.headerDiscountValue;
  const grandTotal = computed.grandTotal;
  const totalBonus = computed.totalBonus;
  const totalQty = computed.totalQty;

  await lockOperationalWrite(transaction, {
    branchId,
    businessDayId,
    shiftSessionId: shiftMoveID,
    requireShift: true,
  });

  const newInvID = await allocateInvID(transaction, 'TblinvServHead', 'مبيعات', 5000);
  console.log(`[pos-api]   Generated invID=${newInvID} for invType=مبيعات`);

  const now = new Date();
  const invTime = getCairoInvTimeDotStr(now);
  const invType = 'مبيعات';
  const notesText = notes || 'مبيعات';
  const payTimeStr = getCairoPayTimeStr(now);

  if (input.postSaleCashMove) {
    await input.postSaleCashMove(transaction, {
      saleInvId: newInvID,
      invType,
      invDate,
      invTime,
      clientId: clientId || null,
      amount: grandTotal,
      shiftMoveId: shiftMoveID,
      paymentMethodId: headerPaymentMethodId,
      branchId,
      businessDayId,
      notes: notesText.substring(0, 50),
    });
    console.log(
      `[pos-api]   ✅ Treasury sale CashMove posted: invID=${newInvID}, PaymentMethodID=${headerPaymentMethodId}`,
    );
  }

  const headReq = new sql.Request(transaction);
  headReq
    .input('invID', sql.Int, newInvID)
    .input('invType', sql.NVarChar(20), invType)
    .input('invDate', sql.Date, invDate)
    .input('invTime', sql.NVarChar(50), invTime)
    .input('ClientID', sql.Int, clientId || null)
    .input('UserID', sql.Int, userID)
    .input('TotalQty', sql.Decimal(10, 2), totalQty)
    .input('SubTotal', sql.Decimal(10, 2), subTotal)
    .input('Dis', sql.Decimal(6, 2), disPercent)
    .input('DisVal', sql.Decimal(10, 2), disVal)
    .input('Tax', sql.Decimal(6, 2), 0)
    .input('TaxVal', sql.Decimal(10, 2), 0)
    .input('GrandTotal', sql.Decimal(10, 2), grandTotal)
    .input('invNotes', sql.NVarChar(50), notesText.substring(0, 50))
    .input('TotalBonus', sql.Decimal(10, 2), totalBonus)
    .input('ShiftMoveID', sql.Int, shiftMoveID)
    .input('Notes', sql.NVarChar(100), notesText.substring(0, 100))
    .input('isActive', sql.NVarChar(5), 'no')
    .input(
      'Notes2',
      sql.NVarChar(sql.MAX),
      String(notes2 || '').substring(0, 4000),
    )
    .input('Payment', sql.Decimal(10, 2), grandTotal)
    .input('PayDue', sql.Decimal(10, 2), 0)
    .input('PayCash', sql.Decimal(10, 2), payCash)
    .input('PayVisa', sql.Decimal(10, 2), payVisa)
    .input('PaymentMethodID', sql.Int, headerPaymentMethodId)
    .input('BranchID', sql.Int, branchId)
    .input('BusinessDayID', sql.Int, businessDayId);

  await headReq.query(`
    INSERT INTO [dbo].[TblinvServHead] (
      invID, invType, invDate, invTime, ClientID, UserID,
      TotalQty, SubTotal, Dis, DisVal, Tax, TaxVal, GrandTotal,
      invNotes, TotalBonus, ShiftMoveID,
      ReservDate, ReservTime, Notes,
      PayCash, PayVisa, isActive, Notes2, Payment, PayDue, PaymentMethodID,
      BranchID, BusinessDayID
    ) VALUES (
      @invID, @invType, @invDate, @invTime, @ClientID, @UserID,
      @TotalQty, @SubTotal, @Dis, @DisVal, @Tax, @TaxVal, @GrandTotal,
      @invNotes, @TotalBonus, @ShiftMoveID,
      NULL, NULL, @Notes,
      @PayCash, @PayVisa, @isActive, @Notes2, @Payment, @PayDue, @PaymentMethodID,
      @BranchID, @BusinessDayID
    )
  `);
  console.log(
    `[pos-api]   ✅ TblinvServHead inserted: invID=${newInvID}, ClientID=${clientId || 'NULL'}, GrandTotal=${grandTotal}, PaymentMethodID=${headerPaymentMethodId} (${isSplitPayment ? 'CLEARING' : 'DIRECT'}), UserID=${userID}`,
  );

  let detailCount = 0;
  for (let i = 0; i < items.length; i++) {
    const item = items[i]!;
    const line = computed.lines[i]!;
    const qty = item.qty > 0 ? item.qty : 1;
    const retailEmp = item.empId == null || item.empId <= 0;
    // Snapshot catalog purchase cost into line PPrice/PValue at sale time.
    const costRes = await new sql.Request(transaction)
      .input('ProID', sql.Int, item.proId)
      .query(`SELECT ISNULL(PPrice, 0) AS unitCost FROM dbo.TblPro WHERE ProID = @ProID`);
    const unitCost = Number(costRes.recordset[0]?.unitCost ?? 0);

    await new sql.Request(transaction)
      .input('invID', sql.Int, newInvID)
      .input('invType', sql.NVarChar(20), invType)
      .input('EmpID', sql.Int, retailEmp ? null : item.empId)
      .input('ProID', sql.Int, item.proId)
      .input('Dis', sql.Decimal(8, 2), line.discountPercent)
      .input('DisVal', sql.Decimal(8, 2), line.discountValue)
      .input('SPrice', sql.Decimal(10, 2), item.sPrice)
      .input('SValue', sql.Decimal(10, 2), line.grossAmount)
      .input('SPriceAfterDis', sql.Decimal(10, 2), line.netAmount)
      .input('PPrice', sql.Decimal(10, 2), unitCost)
      .input('PValue', sql.Decimal(10, 2), unitCost * qty)
      .input('Qty', sql.Decimal(8, 2), qty)
      .input('Notes', sql.NVarChar(50), (item.notes || '').substring(0, 50))
      .input('Bonus', sql.Decimal(8, 2), retailEmp ? 0 : item.bonus)
      .input('ReservDate', sql.Date, null)
      .input('unitCost', sql.Decimal(10, 2), unitCost)
      .query(`
        INSERT INTO [dbo].[TblinvServDetail] (
          invID, invType, EmpID, ProID,
          Dis, DisVal, SPrice, SValue, SPriceAfterDis,
          PPrice, PValue, Qty, ProType, Notes, Bonus, ReservDate
        ) VALUES (
          @invID, @invType, @EmpID, @ProID,
          @Dis, @DisVal, @SPrice, @SValue, @SPriceAfterDis,
          @PPrice, @PValue, @Qty, NULL, @Notes, @Bonus, @ReservDate
        );

        IF COL_LENGTH(N'dbo.TblinvServDetail', N'UnitCostSnapshot') IS NOT NULL
        BEGIN
          UPDATE TOP (1) dbo.TblinvServDetail
          SET UnitCostSnapshot = @unitCost
          WHERE invID = @invID AND invType = @invType AND ProID = @ProID
            AND UnitCostSnapshot IS NULL;
        END
      `);
    detailCount++;
  }
  console.log(
    `[pos-api]   ✅ TblinvServDetail inserted: ${detailCount} row(s)`,
  );

  {
    const { applySaleStockDecrements, InventoryDomainError } = await import(
      '@/lib/inventory/inventoryMutation.service'
    );
    try {
      await applySaleStockDecrements(transaction, {
        branchId,
        invId: newInvID,
        invType,
        businessDayId,
        shiftMoveId: shiftMoveID,
        userId: userID,
        lines: items.map((item, idx) => ({
          proId: item.proId,
          qty: item.qty > 0 ? item.qty : 1,
          lineKey: `${idx}:${item.proId}`,
        })),
      });
    } catch (stockErr) {
      if (stockErr instanceof InventoryDomainError) {
        throw stockErr;
      }
      throw stockErr;
    }
  }

  const existingPayRows = await new sql.Request(transaction)
    .input('chkInvID', sql.Int, newInvID)
    .input('chkInvType', sql.NVarChar(20), invType)
    .query(`
      SELECT COUNT(*) AS cnt FROM [dbo].[TblinvServPayment]
      WHERE invID = @chkInvID AND invType = @chkInvType
    `);
  if (existingPayRows.recordset[0].cnt === 0) {
    for (const alloc of activeAllocations) {
      const payReq = new sql.Request(transaction);
      payReq
        .input('invID', sql.Int, newInvID)
        .input('invType', sql.NVarChar(20), invType)
        .input('PayDate', sql.Date, invDate)
        .input('PayTime', sql.NVarChar(50), payTimeStr)
        .input('PayValue', sql.Decimal(10, 2), Number(alloc.amount))
        .input('Notes', sql.NVarChar(4000), notesText.substring(0, 4000))
        .input('PaymentMethodID', sql.Int, alloc.paymentMethodId)
        .input('ShiftMoveID', sql.Int, shiftMoveID);

      await payReq.query(`
        INSERT INTO [dbo].[TblinvServPayment] (
          invID, invType, PayDate, PayTime, PayValue, Notes, PaymentMethodID, ShiftMoveID
        ) VALUES (
          @invID, @invType, @PayDate, @PayTime, @PayValue, @Notes, @PaymentMethodID, @ShiftMoveID
        )
      `);
      console.log(
        `[pos-api]   ✅ TblinvServPayment inserted: PayValue=${alloc.amount}, PaymentMethodID=${alloc.paymentMethodId}`,
      );
    }
  } else {
    console.log(`[pos-api]   ⚠️  TblinvServPayment rows already exist for invID=${newInvID} — skipping (idempotency)`);
  }

  if (!input.postSaleCashMove) {
    console.log(
      `[pos-api]   ℹ️  TblCashMove initial entry created by trigger InsCashMoveSales (paymentMethodId=${headerPaymentMethodId})`,
    );
  } else {
    console.log(
      `[pos-api]   ℹ️  TblCashMove initial entry Treasury-owned; InsCashMoveSales guard will skip (paymentMethodId=${headerPaymentMethodId})`,
    );
  }

  if (isSplitPayment) {
    console.log(`[pos-api]   � Redistributing clearing account to real payment methods...`);

    const existingSplitTransfers = await new sql.Request(transaction)
      .input('chkInvID2', sql.Int, newInvID)
      .input('chkCatId', sql.Int, splitCfg.expenseCatId)
      .query(`
        SELECT COUNT(*) AS cnt FROM [dbo].[TblCashMove]
        WHERE ExpINID = @chkCatId
          AND Notes LIKE N'%فاتورة ' + CAST(@chkInvID2 AS NVARCHAR) + N'%'
      `);
    if (existingSplitTransfers.recordset[0].cnt === 0) {
      await redistributeFromClearing({
        transaction,
        branchId,
        businessDayId,
        clearingMethodId: splitCfg.clearingMethodId,
        allocations: activeAllocations.map((a) => ({
          paymentMethodId: a.paymentMethodId,
          amount: Number(a.amount),
        })),
        invDate,
        invTime,
        clientId: clientId || null,
        shiftMoveId: shiftMoveID,
        invoiceId: newInvID,
        expenseCatId: splitCfg.expenseCatId,
        incomeCatId: splitCfg.incomeCatId,
      });
      console.log(`[pos-api]   ✅ Split payment redistribution complete`);
    } else {
      console.log(`[pos-api]   ⚠️  Split transfers already exist for invID=${newInvID} — skipping (idempotency)`);
    }
  }

  let targetRecalcScopes: TargetRecalcScope[] = [];
  try {
    const { enqueueTargetRecalcFromInvoiceSnapshots } = await import(
      '@/lib/payroll/employee-target/employee-target-invoice-sync'
    );
    const workDateStr = String(invDate).slice(0, 10);
    targetRecalcScopes = await enqueueTargetRecalcFromInvoiceSnapshots({
      transaction,
      beforeSnapshot: null,
      afterSnapshot: {
        header: { invDate: workDateStr },
        details: items.map((it) => ({ empId: it.empId })),
      },
      reason: 'invoice_create',
      sourceType: 'TblinvServHead',
      sourceRef: String(newInvID),
    });
  } catch (enqueueErr) {
    console.error(
      '[pos-api] target recalc enqueue failed — rolling back sale:',
      enqueueErr instanceof Error ? enqueueErr.message : enqueueErr,
    );
    throw enqueueErr;
  }

  return { invID: newInvID, invType, targetRecalcScopes };
}

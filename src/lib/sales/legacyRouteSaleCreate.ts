import 'server-only';

/**
 * Pre-extraction POST /api/sales transaction.
 *
 * DRVO-008 keeps this copy so manifest rollout=legacy and
 * DRVO_FORCE_POS_PATH=legacy run the previous in-route sale create.
 * It must not call POS createSale. The extracted path is createSale.
 */
import type { Transaction } from 'mssql';
import { getPool, sql, allocateInvID } from '@/lib/db';
import type { SplitPaymentConfig } from '@/lib/clearingMethod';
import { redistributeFromClearing } from '@/lib/splitPaymentService';
import type { InvoiceItemsTotals } from '@/lib/sales/service-line-totals';
import { getCairoInvTimeDotStr, getCairoPayTimeStr } from '@/lib/businessDate';
import { lockOperationalWrite } from '@/lib/branch/operationalGates';
import type { TargetRecalcScope } from '@/lib/payroll/employee-target/employee-target-recalc-scope';
import { runSalePostCommitEffects } from '@/apps/pos/internal/salePostCommitEffects';

type InvoicePaymentAllocationInput = {
  paymentMethodId: number;
  amount: number;
};

type LegacySaleCreateItemInput = {
  proId: number;
  empId: number;
  sPrice: number;
  bonus: number;
  qty: number;
  dis: number;
  disVal: number;
  notes: string;
};

type LegacySaleCreateTransactionInput = {
  items: LegacySaleCreateItemInput[];
  clientId: number | null;
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
};

type LegacySaleCreateTransactionResult = {
  invID: number;
  invType: string;
  targetRecalcScopes: TargetRecalcScope[];
};

async function executeInRouteSaleCreateTransaction(
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
    const detReq = new sql.Request(transaction);
    detReq
      .input('invID', sql.Int, newInvID)
      .input('invType', sql.NVarChar(20), invType)
      .input('EmpID', sql.Int, item.empId)
      .input('ProID', sql.Int, item.proId)
      .input('Dis', sql.Decimal(8, 2), line.discountPercent)
      .input('DisVal', sql.Decimal(8, 2), line.discountValue)
      .input('SPrice', sql.Decimal(10, 2), item.sPrice)
      .input('SValue', sql.Decimal(10, 2), line.grossAmount)
      .input('SPriceAfterDis', sql.Decimal(10, 2), line.netAmount)
      .input('PPrice', sql.Decimal(10, 2), 0)
      .input('PValue', sql.Decimal(10, 2), 0)
      .input('Qty', sql.Decimal(8, 2), item.qty > 0 ? item.qty : 1)
      .input('Notes', sql.NVarChar(50), (item.notes || '').substring(0, 50))
      .input('Bonus', sql.Decimal(8, 2), item.bonus)
      .input('ReservDate', sql.Date, null);

    await detReq.query(`
      INSERT INTO [dbo].[TblinvServDetail] (
        invID, invType, EmpID, ProID,
        Dis, DisVal, SPrice, SValue, SPriceAfterDis,
        PPrice, PValue, Qty, ProType, Notes, Bonus, ReservDate
      ) VALUES (
        @invID, @invType, @EmpID, @ProID,
        @Dis, @DisVal, @SPrice, @SValue, @SPriceAfterDis,
        @PPrice, @PValue, @Qty, NULL, @Notes, @Bonus, @ReservDate
      )
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

  console.log(
    `[pos-api]   ℹ️  TblCashMove initial entry created by trigger InsCashMoveSales (paymentMethodId=${headerPaymentMethodId})`,
  );

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

export type LegacyRouteSaleCreateInput = LegacySaleCreateTransactionInput & {
  branchName: string;
};

/**
 * Legacy route sale create. Owns its SERIALIZABLE transaction.
 * Does not delegate to the extracted POS createSale command.
 */
export async function createSaleLegacyFromRoute(
  input: LegacyRouteSaleCreateInput,
): Promise<{ invID: number; invType: string }> {
  const db = await getPool();
  const transaction = new sql.Transaction(db);
  await transaction.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
  console.log('[pos-api]   Transaction started (SERIALIZABLE) [legacy route]');

  const { branchName, ...txInput } = input;

  try {
    const { invID, invType, targetRecalcScopes } = await executeInRouteSaleCreateTransaction(
      transaction,
      txInput,
    );
    await transaction.commit();
    console.log(`[pos-api]   ✅ COMMITTED — invID=${invID}, invType=${invType} [legacy route]`);

    runSalePostCommitEffects({
      invID,
      invType,
      clientId: input.clientId,
      userID: input.userID,
      grandTotal: input.computed.grandTotal,
      isSplitPayment: input.isSplitPayment,
      headerPaymentMethodId: input.headerPaymentMethodId,
      activeAllocations: input.activeAllocations,
      branchId: input.branchId,
      branchName,
      targetRecalcScopes,
    });

    return { invID, invType };
  } catch (err) {
    const rollbackReason = err instanceof Error ? err.message : String(err);
    console.error(`[pos-api]   ❌ ROLLING BACK [legacy route] — reason: ${rollbackReason}`);
    try {
      await transaction.rollback();
    } catch (rbErr) {
      console.error(
        `[pos-api]   Rollback also failed: ${rbErr instanceof Error ? rbErr.message : rbErr}`,
      );
    }
    throw err;
  }
}

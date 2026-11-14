#!/usr/bin/env npx tsx
/**
 * CUT Referral 50/20 real-SQL transactional staging proof (#248).
 * Executes BOTH actual POS transactional writer cores, claim/voucher logic,
 * payment/treasury/inventory assertions and refund transition logic inside
 * ONE SERIALIZABLE SQL transaction. Unconditionally ROLLBACK: no persistent
 * invoice, client, voucher, cash movement or request marker is written.
 *
 * This is NOT a full browser HTTP POST, independent review or audited-API E2E.
 * It is a stronger prerequisite than mocked service/unit tests.
 */
import Module from 'module';
import { randomUUID } from 'node:crypto';
import mssql from 'mssql';

const loader = Module as unknown as {
  _load: (name: string, parent: unknown, isMain: boolean) => unknown;
};
const original = loader._load;
loader._load = function testingServerOnly(name, parent, isMain) {
  if (name === 'server-only') return {};
  return original.call(loader, name, parent, isMain);
};

function check(ok: unknown, label: string): asserts ok {
  if (!ok) throw new Error('CUT-248-TRANSACTION-E2E: ' + label);
  console.log('PASS: ' + label);
}

async function main(): Promise<void> {
  const password = process.env.DRVO_STAGING_DB_PASSWORD;
  check(password, 'dedicated staging credentials supplied');
  check(process.env.DB_DATABASE !== 'last132' &&
    process.env.CLOUD_DB_NAME !== 'last132', 'production environment refused');
  Object.assign(process.env, {
    DB_SERVER: '127.0.0.1', DB_PORT: '14330',
    DB_DATABASE: 'last132_agent', DB_USER: 'drvo_agent', DB_PASSWORD: password,
    DB_ENCRYPT: 'false', DB_TRUST_SERVER_CERTIFICATE: 'true',
    CLOUD_DB_SERVER: '127.0.0.1', CLOUD_DB_PORT: '14330',
    CLOUD_DB_NAME: 'last132_agent', CLOUD_DB_USER: 'drvo_agent',
    CLOUD_DB_PASSWORD: password, CLOUD_DB_ENCRYPT: 'false', CLOUD_DB_TRUST_CERT: 'true',
    POS_REFERRAL_CHECKOUT_ENABLED: 'true',
    POS_REFERRAL_REDEEM_ENABLED: 'true',
    POS_REFERRAL_REVERSAL_ENABLED: 'true',
    POS_SALE_IDEMPOTENCY_ENABLED: 'true',
    WHATSAPP_INTEGRATION_ENABLED: 'false',
    WHATSAPP_SALE_ENABLED: 'false',
    WHATSAPP_EMPLOYEE_SALE_ENABLED: 'false',
    WHATSAPP_FIRST_TIME_ENABLED: 'false',
  });

  const { getPool, closePool, sql } = await import('../../src/lib/db');
  const { executeLegacySaleCreateTransaction } =
    await import('../../src/apps/pos/internal/legacySaleCreateAdapter');
  const { executeInRouteSaleCreateTransaction } =
    await import('../../src/lib/sales/legacyRouteSaleCreate');
  const { computeInvoiceItemsTotals } = await import('../../src/lib/sales/service-line-totals');
  const { resolveSplitPaymentConfig } = await import('../../src/lib/clearingMethod');
  const { priceFirstVisitReferral, priceReferralRewardVoucher } =
    await import('../../src/lib/referrals/referralCheckoutPolicy');
  const { prepareReferralSaleTransaction, finalizeReferralSaleTransaction } =
    await import('../../src/lib/referrals/referralSaleTransaction.service');
  const { reverseReferralInvoiceOnFullRefund } =
    await import('../../src/lib/referrals/referralInvoiceRefund.service');
  const { reserveSaleRequest, completeSaleRequest, createSaleIdempotencyIntent,
    lookupCommittedSaleReplay } = await import('../../src/lib/sales/saleRequestIdempotency.service');
  const { deleteSale } = await import('../../src/apps/pos/public');

  const db = await getPool();
  let tx: mssql.Transaction | null = null;
  let wasRolledBack = false;
  const insertedClientIds: number[] = [];
  const writtenInvIds: number[] = [];
  const requestIds: string[] = [];
  let tenantId = '';
  try {
    const identity = await db.request().query('SELECT DB_NAME() AS DbName, SUSER_SNAME() AS LoginName;');
    check(identity.recordset[0]?.DbName === 'last132_agent' &&
      String(identity.recordset[0]?.LoginName).toLowerCase() === 'drvo_agent',
      'staging SQL identity matches exact database and user');

    const fixture = await db.request().query(`
      SELECT TOP (1)
        sm.ID AS ShiftMoveID, sm.BranchID, sm.BusinessDayID,
        sm.UserID, t.TenantId,
        CONVERT(varchar(10), nd.NewDay, 23) AS BusinessDate,
        b.BranchName
      FROM dbo.TblShiftMove sm
      JOIN dbo.TblNewDay nd ON nd.ID = sm.BusinessDayID AND nd.BranchID = sm.BranchID
      JOIN dbo.TblBranch b ON b.BranchID = sm.BranchID
      JOIN dbo.Location l ON l.LegacyBranchId = sm.BranchID
      JOIN dbo.Tenant t ON t.TenantId = l.TenantId
      WHERE sm.Status = 1 AND nd.Status = 1
        AND EXISTS (
          SELECT 1 FROM dbo.TblPro p
          WHERE p.TenantId = t.TenantId AND ISNULL(p.isDeleted, 0) = 0
            AND ISNULL(p.SPrice1, 0) > 0
        )
      ORDER BY sm.ID DESC;
    `);
    const owned = fixture.recordset[0];
    check(owned && Number(owned.ShiftMoveID) > 0, 'staging has an open tenant-owned shift');
    tenantId = String(owned.TenantId);
    const branchId = Number(owned.BranchID);
    const userId = Number(owned.UserID);
    const shiftMoveId = Number(owned.ShiftMoveID);
    const businessDayId = Number(owned.BusinessDayID);
    const businessDate = String(owned.BusinessDate);
    const branchName = String(owned.BranchName || 'staging');

    const catalog = await db.request()
      .input('tenantId', sql.UniqueIdentifier, tenantId)
      .query(`
        SELECT TOP 1 p.ProID, CAST(p.SPrice1 AS decimal(10, 2)) AS Price,
          e.EmpID
        FROM dbo.TblPro p
        JOIN dbo.TblCat c ON c.CatID = p.CatID
        JOIN dbo.TblEmp e ON e.TenantId = p.TenantId AND ISNULL(e.isActive, 0) = 1
        WHERE p.TenantId = @tenantId AND ISNULL(p.isDeleted, 0) = 0
          AND p.SPrice1 > 0
          AND LOWER(LTRIM(RTRIM(ISNULL(c.CatType, N'')))) <> N'pro'
          AND LOWER(LTRIM(RTRIM(ISNULL(p.ProType, N'')))) NOT IN (N'pro', N'product')
        ORDER BY p.ProID, e.EmpID;
      `);
    check(catalog.recordset.length === 1, 'staging tenant has real non-retail service and employee');
    const service = catalog.recordset[0];
    const price = Number(service.Price);
    const proId = Number(service.ProID);
    const empId = Number(service.EmpID);
    check(Number.isFinite(price) && price > 0, 'positive catalog list price');

    const splitCfg = await resolveSplitPaymentConfig(db);
    const methods = await db.request()
      .input('clearing', sql.Int, splitCfg.clearingMethodId)
      .query(`SELECT TOP 2 PaymentID FROM dbo.TblPaymentMethods
        WHERE PaymentID <> @clearing ORDER BY PaymentID;`);
    check(methods.recordset.length === 2, 'two real payment methods for split-payment proof');
    const paymentA = Number(methods.recordset[0].PaymentID);
    const paymentB = Number(methods.recordset[1].PaymentID);

    tx = new sql.Transaction(db);
    await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
    const localTx = tx;
    const marker = 'CUT248-' + randomUUID().slice(0, 8);
    async function newTestClient(suffix: string): Promise<number> {
      const created = await new sql.Request(localTx)
        .input('tenantId', sql.UniqueIdentifier, tenantId)
        .input('name', sql.NVarChar(50), marker + '-' + suffix)
        .query(`
          INSERT INTO dbo.TblClient (TenantId, Name, Notes, RegisterDate)
          OUTPUT INSERTED.ClientID AS ClientID
          VALUES (@tenantId, @name, N'CUT-248-ROLLBACK-ONLY', CAST(GETDATE() AS DATE));
        `);
      const id = Number(created.recordset[0]?.ClientID);
      check(Number.isSafeInteger(id) && id > 0, 'synthetic client allocated within rollback');
      insertedClientIds.push(id);
      return id;
    }
    const referrer = await newTestClient('owner');
    const referred = await newTestClient('referred');

    function pricing(discount: 'none' | 'first' | 'reward') {
      const lines = [{ sPrice: price, qty: 1, discountPercent: 0,
        discountValue: 0, bonus: 0 }];
      return discount === 'first'
        ? priceFirstVisitReferral(lines, { discountPercent: 0, discountValue: 0 })
        : discount === 'reward'
        ? priceReferralRewardVoucher(lines, { discountPercent: 0, discountValue: 0 })
        : computeInvoiceItemsTotals(lines, { discountPercent: 0, discountValue: 0 });
    }

    type SaleSpec = { clientId: number; writer: 'legacy' | 'extracted';
      discount: 'none' | 'first' | 'reward'; code?: string; voucherId?: number;
      split?: boolean };
    async function paidSale(spec: SaleSpec) {
      const computed = pricing(spec.discount);
      const amount = computed.grandTotal;
      const half = Math.round((amount / 2) * 100) / 100;
      const paymentAllocations = spec.split
        ? [{ paymentMethodId: paymentA, amount: half },
          { paymentMethodId: paymentB, amount: Math.round((amount - half) * 100) / 100 }]
        : [{ paymentMethodId: paymentA, amount }];
      const inputPayload = {
        clientId: spec.clientId,
        items: [{ proId, empId, sPrice: price, qty: 1, bonus: 0,
          dis: 0, disVal: 0, notes: marker }],
        paymentAllocations, referralCode: spec.code ?? null,
        referralVoucherId: spec.voucherId ?? null,
      };
      const rawRequestId = randomUUID();
      const intent = createSaleIdempotencyIntent({
        tenantId, userId, branchId, rawRequestId, payload: inputPayload,
      });
      check(intent, 'request ID and immutable tenant/actor/branch fingerprint exist');
      requestIds.push(rawRequestId);
      const reserved = await reserveSaleRequest(localTx, intent);
      check(reserved?.kind === 'new', 'new sale request reserves unique tenant key');
      const prepared = await prepareReferralSaleTransaction(localTx, {
        tenantId, clientId: spec.clientId,
        referralCode: spec.code ?? null, referralVoucherId: spec.voucherId ?? null,
        items: [{ proId, sPrice: price, qty: 1, bonus: 0 }],
      });
      const input = {
        ...inputPayload,
        idempotency: intent, tenantId, notes: marker, notes2: marker,
        payCash: spec.split ? half : amount,
        payVisa: spec.split ? Math.round((amount - half) * 100) / 100 : 0,
        computed, branchId, businessDayId, shiftMoveID: shiftMoveId,
        invDate: businessDate, userID: userId, splitCfg,
        activeAllocations: paymentAllocations, isSplitPayment: !!spec.split,
        headerPaymentMethodId: spec.split ? splitCfg.clearingMethodId : paymentA,
        branchName,
      };
      // Actual two separate production POS transaction executors, supplied
      // the single guarded outer transaction instead of committing themselves.
      const result = spec.writer === 'legacy'
        ? await executeInRouteSaleCreateTransaction(localTx, input)
        : await executeLegacySaleCreateTransaction(localTx, input);
      writtenInvIds.push(result.invID);
      await finalizeReferralSaleTransaction(localTx, prepared, {
        invID: result.invID, invType: result.invType,
        expectedGrandTotal: amount,
      });
      await completeSaleRequest(localTx, reserved, {
        invID: result.invID, invType: result.invType,
      });

      const persisted = await new sql.Request(localTx)
        .input('invId', sql.Int, result.invID)
        .query(`
          SELECT h.GrandTotal, h.Dis, h.Payment, h.PayDue,
            (SELECT SUM(p.PayValue) FROM dbo.TblinvServPayment p
             WHERE p.invID = h.invID AND p.invType = h.invType) AS PaymentRows,
            (SELECT COUNT(*) FROM dbo.TblinvServPayment p
             WHERE p.invID = h.invID AND p.invType = h.invType) AS PaymentCount,
            (SELECT COUNT(*) FROM dbo.TblCashMove m
             WHERE m.invID = h.invID AND m.invType = h.invType) AS CashRows
          FROM dbo.TblinvServHead h
          WHERE h.invID = @invId AND h.invType = N'مبيعات';
        `);
      const row = persisted.recordset[0];
      check(row && Number(row.GrandTotal) === amount &&
        Number(row.Payment) === amount && Number(row.PaymentRows) === amount &&
        Number(row.PayDue) <= 0, 'full paid invoice financial totals match exactly');
      check(Number(row.PaymentCount) === (spec.split ? 2 : 1),
        'single/split payment rows exactly match submitted allocation');
      check(Number(row.CashRows) > 0, 'sale creates cash movement in same SQL transaction');
      const duplicate = await reserveSaleRequest(localTx, intent);
      check(duplicate?.kind === 'replay' && duplicate.result.invID === result.invID,
        'same request key returns original invoice without another posting');
      return result.invID;
    }

    const source = await paidSale({
      clientId: referrer, writer: 'extracted', discount: 'none',
    });
    const codeRes = await new sql.Request(localTx)
      .input('tenantId', sql.UniqueIdentifier, tenantId)
      .input('owner', sql.Int, referrer)
      .query(`
        SELECT Code, ActivatedAtUtc FROM dbo.TblReferralCustomerCode
        WHERE TenantId = @tenantId AND ReferrerClientID = @owner;
      `);
    check(codeRes.recordset.length === 1 &&
      codeRes.recordset[0].ActivatedAtUtc != null, 'first paid sale activates genuine CUT referral code');
    const code = String(codeRes.recordset[0].Code);

    const referralInv = await paidSale({
      clientId: referred, writer: 'legacy', discount: 'first', code, split: true,
    });
    const award = await new sql.Request(localTx)
      .input('tenantId', sql.UniqueIdentifier, tenantId)
      .input('referredId', sql.Int, referred)
      .query(`
        SELECT c.ClaimID, c.Status AS ClaimStatus, v.VoucherID, v.Status AS VoucherStatus,
          c.FirstPaidInvID
        FROM dbo.TblReferralVisitClaim c
        INNER JOIN dbo.TblReferralDiscountVoucher v
          ON v.TenantId = c.TenantId AND v.ClaimID = c.ClaimID
        WHERE c.TenantId = @tenantId AND c.ReferredClientID = @referredId;
      `);
    check(award.recordset.length === 1 &&
      award.recordset[0].ClaimStatus === 'APPLIED' &&
      award.recordset[0].VoucherStatus === 'ACTIVE' &&
      Number(award.recordset[0].FirstPaidInvID) === referralInv,
      '50% paid sale creates exactly one APPLIED claim and ACTIVE 20% voucher');
    const voucherId = Number(award.recordset[0].VoucherID);

    const voucherInv = await paidSale({
      clientId: referrer, writer: 'extracted', discount: 'reward', voucherId,
    });
    const spent = await new sql.Request(localTx)
      .input('tenantId', sql.UniqueIdentifier, tenantId)
      .input('voucherId', sql.BigInt, voucherId)
      .query(`
        SELECT Status, UsedInvID FROM dbo.TblReferralDiscountVoucher
        WHERE TenantId = @tenantId AND VoucherID = @voucherId;
      `);
    check(spent.recordset[0]?.Status === 'USED' &&
      Number(spent.recordset[0]?.UsedInvID) === voucherInv,
      'referrer spends same 20% voucher once on a subsequent paid invoice');

    async function fullRefund(invId: number) {
      const result = await reverseReferralInvoiceOnFullRefund(localTx, {
        tenantId, invoiceId: invId,
      });
      await deleteSale(localTx, invId, branchId, userId);
      check(result, 'refund transitions and stock/cash reversal share SQL transaction');
    }
    await fullRefund(referralInv);
    const preserved = await new sql.Request(localTx)
      .input('tenantId', sql.UniqueIdentifier, tenantId)
      .input('id', sql.BigInt, voucherId)
      .query(`SELECT v.Status AS VoucherStatus, c.Status AS ClaimStatus
        FROM dbo.TblReferralDiscountVoucher v
        INNER JOIN dbo.TblReferralVisitClaim c ON c.ClaimID = v.ClaimID
        WHERE v.TenantId = @tenantId AND v.VoucherID = @id;`);
    check(preserved.recordset[0]?.VoucherStatus === 'USED' &&
      preserved.recordset[0]?.ClaimStatus === 'REVERSED',
      'refund source sale reverses claim but keeps already-earned voucher');
    await fullRefund(voucherInv);
    const restored = await new sql.Request(localTx)
      .input('tenantId', sql.UniqueIdentifier, tenantId)
      .input('id', sql.BigInt, voucherId)
      .query(`SELECT Status, UsedInvID FROM dbo.TblReferralDiscountVoucher
        WHERE TenantId = @tenantId AND VoucherID = @id;`);
    check(restored.recordset[0]?.Status === 'ACTIVE' &&
      restored.recordset[0]?.UsedInvID == null,
      'refund redeemed sale restores same voucher exactly once');
    await fullRefund(source);

    await localTx.rollback();
    wasRolledBack = true;
    tx = null;
    const after = await db.request()
      .input('owner', sql.Int, referrer)
      .input('referred', sql.Int, referred)
      .input('tenantId', sql.UniqueIdentifier, tenantId)
      .query(`
        SELECT
          (SELECT COUNT(*) FROM dbo.TblClient
           WHERE ClientID IN (@owner, @referred)) AS Clients,
          (SELECT COUNT(*) FROM dbo.TblReferralCustomerCode
           WHERE TenantId = @tenantId AND ReferrerClientID = @owner) AS Codes,
          (SELECT COUNT(*) FROM dbo.TblReferralVisitClaim
           WHERE TenantId = @tenantId AND ReferredClientID = @referred) AS Claims,
          (SELECT COUNT(*) FROM dbo.TblReferralDiscountVoucher
           WHERE TenantId = @tenantId AND ReferrerClientID = @owner) AS Vouchers;
      `);
    const residual = after.recordset[0];
    check(Object.values(residual).every(x => Number(x) === 0),
      'all synthetic client/code/claim/voucher rows rolled back');
    for (const invId of writtenInvIds) {
      const result = await db.request()
        .input('invId', sql.Int, invId)
        .query(`SELECT
          (SELECT COUNT(*) FROM dbo.TblinvServHead WHERE invID=@invId AND invType=N'مبيعات') AS Heads,
          (SELECT COUNT(*) FROM dbo.TblCashMove WHERE invID=@invId AND invType=N'مبيعات') AS Cash;`);
      check(Number(result.recordset[0].Heads) === 0 &&
        Number(result.recordset[0].Cash) === 0,
        'synthetic sale and cash records rolled back');
    }
    for (const requestId of requestIds) {
      const r = await db.request()
        .input('tenantId', sql.UniqueIdentifier, tenantId)
        .input('requestId', sql.UniqueIdentifier, requestId)
        .query(`SELECT COUNT(*) AS Cnt FROM dbo.TblPosSaleRequest
          WHERE TenantId=@tenantId AND RequestID=@requestId;`);
      check(Number(r.recordset[0].Cnt) === 0, 'synthetic request ledger key rolled back');
    }
    console.log('CUT-248 REAL SQL TRANSACTION 50/20, 2 WRITERS, PAYMENTS, REFUNDS PASS');
    console.log('No production writes, no persistent staging invoice/client/voucher/cash data.');
  } finally {
    if (tx && !wasRolledBack) {
      try { await tx.rollback(); } catch (err) {
        console.error('IMPORTANT: staging transaction rollback failed:',
          err instanceof Error ? err.message : 'unknown');
        process.exitCode = 1;
      }
    }
    await closePool();
  }
}
main().catch(err => {
  console.error('CUT-248 real SQL staging proof FAILED:',
    err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});

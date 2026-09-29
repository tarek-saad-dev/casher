#!/usr/bin/env npx tsx
/**
 * DRVO-008 staging smoke — last132_agent / drvo_agent only.
 * Creates one service sale through the extracted POS boundary, updates it,
 * deletes it, and rolls back a booking-conversion invoice.
 */
import path from 'path';
import Module from 'module';
import dotenv from 'dotenv';

dotenv.config({ path: path.join(__dirname, '..', '.env') });
dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

const STAGING_DB = 'last132_agent';
const STAGING_USER = 'drvo_agent';
const PRODUCTION_DB = 'last132';

const moduleWithLoad = Module as unknown as {
  _load: (request: string, parent: unknown, isMain: boolean) => unknown;
};
const originalModuleLoad = moduleWithLoad._load;
moduleWithLoad._load = function patchedLoad(request: string, ...rest: unknown[]) {
  if (request === 'server-only') return {};
  return originalModuleLoad.call(moduleWithLoad, request, ...rest);
};

function forceStagingEnv(password: string) {
  const values: Record<string, string> = {
    DB_SERVER: '127.0.0.1',
    DB_PORT: '14330',
    DB_DATABASE: STAGING_DB,
    DB_NAME: STAGING_DB,
    DB_USER: STAGING_USER,
    DB_PASSWORD: password,
    DB_ENCRYPT: 'false',
    DB_TRUST_SERVER_CERTIFICATE: 'true',
  };
  for (const [key, value] of Object.entries(values)) process.env[key] = value;
}

function fail(message: string): never {
  throw new Error(message);
}

async function main() {
  const password = process.env.DRVO_STAGING_DB_PASSWORD;
  if (!password) fail('DRVO_STAGING_DB_PASSWORD not set');
  forceStagingEnv(password);

  const { getPool, closePool, sql } = await import('../src/lib/db');
  const { posPrerequisitesMigration } = await import('./drvo/migrations/008-pos-prerequisites');
  const { getDrvoModuleRolloutSpec } = await import('../src/platform/drvo/moduleManifest');
  const { isPosPortEnabled } = await import('../src/apps/pos/internal/posPortFlag');
  const { createSale, updateSale, deleteSale, getSaleSnapshot } = await import(
    '../src/apps/pos/public'
  );
  const { computeInvoiceItemsTotals } = await import('../src/lib/sales/service-line-totals');
  const { resolveSplitPaymentConfig } = await import('../src/lib/clearingMethod');
  const { createLegacyBookingConversionAdapter } = await import(
    '../src/apps/pos/internal/legacyBookingConversionAdapter'
  );

  const pool = await getPool();
  let createdInvId: number | null = null;
  let createdBranchId: number | null = null;
  try {
    const guard = await pool.request().query(`SELECT DB_NAME() AS db, SUSER_SNAME() AS login`);
    const db = String(guard.recordset[0]?.db ?? '');
    const login = String(guard.recordset[0]?.login ?? '');
    if (db === PRODUCTION_DB) fail('refusing production last132');
    if (db !== STAGING_DB || login !== STAGING_USER) {
      fail(`expected ${STAGING_DB}/${STAGING_USER}, got ${db}/${login}`);
    }
    console.log('PASS: staging DB guard');

    delete process.env.POS_SCHEDULING_PORT;
    delete process.env.DRVO_FORCE_POS_PATH;
    const posSpec = getDrvoModuleRolloutSpec('pos');
    if (posSpec.rollout !== 'legacy') fail('expected POS rollout legacy for DRVO-008');
    if (posSpec.forcePathEnv !== 'DRVO_FORCE_POS_PATH') fail('POS force-path env missing');
    if (posSpec.compatEnvFlag !== 'POS_SCHEDULING_PORT') fail('POS compat env missing');
    if (isPosPortEnabled()) fail('default POS path must stay legacy');
    process.env.POS_SCHEDULING_PORT = 'true';
    if (!isPosPortEnabled()) fail('compat true must enable extracted path');
    process.env.DRVO_FORCE_POS_PATH = 'legacy';
    if (isPosPortEnabled()) fail('force legacy must beat compat true');
    delete process.env.DRVO_FORCE_POS_PATH;
    console.log('PASS: POS manifest legacy with break-glass override');

    const trigger = await pool.request().query(`
      SELECT t.name, t.is_disabled, OBJECT_DEFINITION(t.object_id) AS def
      FROM sys.triggers t
      WHERE t.name = N'InsCashMoveSales'
    `);
    if (!trigger.recordset[0]) fail('InsCashMoveSales trigger not found');
    if (trigger.recordset[0].is_disabled) fail('InsCashMoveSales must remain enabled');
    const triggerDef = String(trigger.recordset[0].def ?? '');
    if (!triggerDef.includes('مبيعات')) fail('InsCashMoveSales definition does not mention sale invType');
    console.log('PASS: InsCashMoveSales live');

    const verify = await posPrerequisitesMigration.verify!({
      pool,
      databaseName: STAGING_DB,
      appCommitSha: 'drvo-008-smoke',
    });
    if (!verify.ok) fail(`pos-prerequisites verify failed: ${verify.failures?.join('; ')}`);
    console.log('PASS: pos-prerequisites verification');

    const shift = await pool.request().query(`
      SELECT TOP 1
        sm.ID AS shiftMoveId,
        sm.UserID AS userId,
        sm.BranchID AS branchId,
        sm.BusinessDayID AS businessDayId,
        CONVERT(varchar(10), nd.NewDay, 23) AS businessDate,
        b.BranchName AS branchName
      FROM dbo.TblShiftMove sm
      JOIN dbo.TblNewDay nd ON nd.ID = sm.BusinessDayID
      JOIN dbo.TblBranch b ON b.BranchID = sm.BranchID
      WHERE sm.Status = 1
      ORDER BY sm.ID DESC
    `);
    const open = shift.recordset[0];
    if (!open) fail('no open shift on staging');
    const branchId = Number(open.branchId);
    const userId = Number(open.userId);
    const shiftMoveId = Number(open.shiftMoveId);
    const businessDayId = Number(open.businessDayId);
    const businessDate = String(open.businessDate);
    const branchName = String(open.branchName ?? 'staging');
    createdBranchId = branchId;

    const service = await pool.request().input('branchId', sql.Int, branchId).query(`
      SELECT TOP 1
        p.ProID AS proId,
        CAST(ISNULL(p.SPrice1, 0) AS decimal(10, 2)) AS price,
        e.EmpID AS empId
      FROM dbo.TblPro p
      LEFT JOIN dbo.TblCat c ON c.CatID = p.CatID
      JOIN dbo.TblEmp e ON e.isActive = 1
      WHERE ISNULL(p.isDeleted, 0) = 0
        AND CAST(ISNULL(p.SPrice1, 0) AS decimal(10, 2)) > 0
        AND LOWER(LTRIM(RTRIM(ISNULL(c.CatType, N'')))) <> N'pro'
        AND LOWER(LTRIM(RTRIM(ISNULL(p.ProType, N'')))) NOT IN (N'pro', N'product')
      ORDER BY p.ProID, e.EmpID
    `);
    const line = service.recordset[0];
    if (!line) fail('no non-stock service with a price and an active employee');
    const proId = Number(line.proId);
    const empId = Number(line.empId);
    const price = Number(line.price);

    const splitCfg = await resolveSplitPaymentConfig(pool);
    const payMethod = await pool
      .request()
      .input('clearing', sql.Int, splitCfg.clearingMethodId)
      .query(`
        SELECT TOP 1 PaymentID AS paymentMethodId
        FROM dbo.TblPaymentMethods
        WHERE PaymentID <> @clearing
        ORDER BY PaymentID
      `);
    const paymentMethodId = Number(payMethod.recordset[0]?.paymentMethodId ?? 0);
    if (!paymentMethodId) fail('no payment method');

    const client = await pool.request().query(`
      SELECT TOP 1 ClientID AS clientId
      FROM dbo.TblClient
      ORDER BY ClientID
    `);
    const clientId = Number(client.recordset[0]?.clientId ?? 0);
    if (!clientId) fail('no client for required ClientID');

    const beforeRecalc = await pool
      .request()
      .input('empId', sql.Int, empId)
      .input('branchId', sql.Int, branchId)
      .input('workDate', sql.Date, businessDate)
      .query(`
        SELECT RequestedVersion
        FROM dbo.TblEmpTargetRecalcRequest
        WHERE EmpID = @empId AND BranchID = @branchId AND WorkDate = @workDate
      `);
    const versionBefore = Number(beforeRecalc.recordset[0]?.RequestedVersion ?? 0);

    const computed = computeInvoiceItemsTotals(
      [{ sPrice: price, qty: 1, discountPercent: 0, discountValue: 0, bonus: 0 }],
      { discountPercent: 0, discountValue: 0 },
    );

    const created = await createSale({
      items: [
        {
          proId,
          empId,
          sPrice: price,
          bonus: 0,
          qty: 1,
          dis: 0,
          disVal: 0,
          notes: 'DRVO-008 smoke',
        },
      ],
      clientId,
      notes: 'DRVO-008 smoke',
      notes2: 'drvo-008-pos-staging-smoke',
      payCash: computed.grandTotal,
      payVisa: 0,
      paymentAllocations: [],
      computed,
      branchId,
      businessDayId,
      shiftMoveID: shiftMoveId,
      invDate: businessDate,
      userID: userId,
      splitCfg,
      activeAllocations: [{ paymentMethodId, amount: computed.grandTotal }],
      isSplitPayment: false,
      headerPaymentMethodId: paymentMethodId,
      branchName,
    });
    createdInvId = created.invID;
    console.log('PASS: extracted createSale', created);

    const snapTx = new sql.Transaction(pool);
    await snapTx.begin();
    const snapshot = await getSaleSnapshot(snapTx, created.invID);
    await snapTx.rollback();
    if (!snapshot) fail('missing sale snapshot');
    if (Math.abs(Number(snapshot.header.GrandTotal) - computed.grandTotal) > 0.01) {
      fail(`header grand total ${snapshot.header.GrandTotal} != ${computed.grandTotal}`);
    }
    if (snapshot.details.length !== 1) fail(`expected 1 detail, got ${snapshot.details.length}`);
    if (snapshot.payments.length !== 1) fail(`expected 1 payment, got ${snapshot.payments.length}`);
    const saleCash = snapshot.cashMoves.filter(
      (row) => String(row.inOut ?? '').toLowerCase() === 'in' || row.inOut == null,
    );
    if (snapshot.cashMoves.length < 1) fail('expected trigger CashMove row');
    console.log('PASS: header/detail/payment/cash snapshot', {
      details: snapshot.details.length,
      payments: snapshot.payments.length,
      cashMoves: snapshot.cashMoves.length,
      saleCash: saleCash.length,
    });

    const dup = await pool.request().input('invID', sql.Int, created.invID).query(`
      SELECT COUNT(*) AS cnt
      FROM dbo.TblCashMove
      WHERE invID = @invID AND invType = N'مبيعات'
    `);
    const cashCount = Number(dup.recordset[0]?.cnt ?? 0);
    if (cashCount !== 1) fail(`expected exactly 1 sale CashMove, got ${cashCount}`);
    console.log('PASS: single trigger CashMove');

    const stockMoves = await pool.request().input('invID', sql.Int, created.invID).query(`
      SELECT COUNT(*) AS cnt
      FROM dbo.TblInventoryMovement
      WHERE ReferenceType = N'SALE_INVOICE'
        AND ReferenceID = CONVERT(nvarchar(64), @invID)
        AND MovementType = N'SALE'
    `);
    if (Number(stockMoves.recordset[0]?.cnt ?? 0) !== 0) {
      fail('service line created a stock SALE movement');
    }
    console.log('PASS: service line did not decrement stock');

    const afterRecalc = await pool
      .request()
      .input('empId', sql.Int, empId)
      .input('branchId', sql.Int, branchId)
      .input('workDate', sql.Date, businessDate)
      .query(`
        SELECT RequestedVersion
        FROM dbo.TblEmpTargetRecalcRequest
        WHERE EmpID = @empId AND BranchID = @branchId AND WorkDate = @workDate
      `);
    const versionAfter = Number(afterRecalc.recordset[0]?.RequestedVersion ?? 0);
    if (versionAfter !== versionBefore) {
      fail(`create changed target version (${versionBefore} -> ${versionAfter})`);
    }
    console.log('PASS: create target scope unchanged (snapshot has no branch)');

    const updateTx = new sql.Transaction(pool);
    await updateTx.begin();
    try {
      await updateSale(
        updateTx,
        created.invID,
        {
          clientId,
          notes: 'DRVO-008 smoke updated',
          payCash: computed.grandTotal,
          payVisa: 0,
          paymentMethodId,
          items: [
            {
              proId,
              empId,
              sPrice: price,
              qty: 1,
              dis: 0,
              disVal: 0,
              bonus: 0,
              notes: 'DRVO-008 smoke updated',
            },
          ],
          paymentAllocations: [{ paymentMethodId, amount: computed.grandTotal }],
        },
        userId,
      );
      const updated = await getSaleSnapshot(updateTx, created.invID);
      if (!updated) fail('snapshot missing after update');
      if (!String(updated.header.Notes ?? '').includes('updated')) {
        fail(`update notes not stored: ${updated.header.Notes}`);
      }
      if (updated.payments.length !== 1) fail('update payment count changed');
      await updateTx.commit();
    } catch (err) {
      try {
        await updateTx.rollback();
      } catch {
        /* already closed */
      }
      throw err;
    }
    const cashAfterUpdate = await pool.request().input('invID', sql.Int, created.invID).query(`
      SELECT COUNT(*) AS cnt
      FROM dbo.TblCashMove
      WHERE invID = @invID AND invType = N'مبيعات'
    `);
    if (Number(cashAfterUpdate.recordset[0]?.cnt ?? 0) !== 1) {
      fail('update duplicated sale CashMove');
    }
    console.log('PASS: extracted updateSale');

    const deleteTx = new sql.Transaction(pool);
    await deleteTx.begin();
    try {
      await deleteSale(deleteTx, created.invID, branchId);
      await deleteTx.commit();
    } catch (err) {
      try {
        await deleteTx.rollback();
      } catch {
        /* already closed */
      }
      throw err;
    }
    const gone = await pool.request().input('invID', sql.Int, created.invID).query(`
      SELECT
        (SELECT COUNT(*) FROM dbo.TblinvServHead WHERE invID = @invID) AS heads,
        (SELECT COUNT(*) FROM dbo.TblinvServDetail WHERE invID = @invID) AS details,
        (SELECT COUNT(*) FROM dbo.TblCashMove WHERE invID = @invID) AS cash
    `);
    const left = gone.recordset[0];
    if (Number(left.heads) !== 0 || Number(left.details) !== 0 || Number(left.cash) !== 0) {
      fail(`delete left rows ${JSON.stringify(left)}`);
    }
    createdInvId = null;
    await new Promise((resolve) => setTimeout(resolve, 1500));
    await pool.request().input('invID', sql.Int, created.invID).query(`
      DELETE FROM dbo.TblLoyaltyPointLedger WHERE SourceInvID = @invID
    `);
    console.log('PASS: extracted deleteSale cleaned header, detail, and CashMove');

    const convTx = new sql.Transaction(pool);
    await convTx.begin();
    try {
      const port = createLegacyBookingConversionAdapter();
      const converted = await port.createServiceInvoice(
        convTx,
        {
          actorType: 'staff',
          actorId: 'drvo-008-smoke',
          tenantId: 'smoke',
          membershipId: null,
          viewLocationId: null,
        },
        {
          tenantId: 'smoke',
          locationId: branchId,
          bookingId: 0,
          clientId,
          userId,
          businessDayId,
          shiftInstanceId: shiftMoveId,
          businessDate,
          lines: [
            {
              catalogItemId: proId,
              employeeId: empId,
              quantity: 1,
              unitPrice: price,
              reservationDate: businessDate,
            },
          ],
          paymentMethodId,
          notes: 'DRVO-008 conversion smoke',
          idempotencyKey: `drvo-008-smoke-${Date.now()}`,
        },
      );
      const convCash = await new sql.Request(convTx)
        .input('invID', sql.Int, converted.legacyInvId)
        .input('invType', sql.NVarChar(20), converted.legacyInvType)
        .query(`
          SELECT COUNT(*) AS cnt
          FROM dbo.TblCashMove
          WHERE invID = @invID AND invType = @invType
        `);
      if (Number(convCash.recordset[0]?.cnt ?? 0) !== 0) {
        fail('booking conversion created a CashMove');
      }
      if (converted.legacyInvType !== 'خدمة') fail(`unexpected conversion type ${converted.legacyInvType}`);
      await convTx.rollback();
      console.log('PASS: booking conversion rolled back with no CashMove', {
        legacyInvId: converted.legacyInvId,
      });
    } catch (err) {
      try {
        await convTx.rollback();
      } catch {
        /* already closed */
      }
      throw err;
    }

    console.log('DRVO-008 POS staging smoke complete');
  } finally {
    if (createdInvId != null && createdBranchId != null) {
      try {
        const cleanup = new sql.Transaction(pool);
        await cleanup.begin();
        await deleteSale(cleanup, createdInvId, createdBranchId);
        await cleanup.commit();
        console.log('CLEANUP: deleted smoke invoice', createdInvId);
      } catch (cleanupErr) {
        console.error('CLEANUP failed', cleanupErr);
      }
    }
    await closePool();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

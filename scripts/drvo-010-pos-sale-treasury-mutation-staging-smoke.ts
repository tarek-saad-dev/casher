#!/usr/bin/env npx tsx
/**
 * DRVO-010 staging smoke — last132_agent / drvo_agent only.
 * Proves Treasury replace/remove sale mutation seams inside rolled-back transactions.
 */
import path from 'path';
import Module from 'module';
import dotenv from 'dotenv';

dotenv.config({ path: path.join(__dirname, '..', '.env') });
dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

const STAGING_DB = 'last132_agent';
const STAGING_USER = 'drvo_agent';
const PRODUCTION_DB = 'last132';
const MARKER = 'DRVO010-SMOKE';

const moduleWithLoad = Module as unknown as {
  _load: (request: string, parent: unknown, isMain: boolean) => unknown;
};
const originalModuleLoad = moduleWithLoad._load;
moduleWithLoad._load = function patchedLoad(request: string, ...rest: unknown[]) {
  if (request === 'server-only') return {};
  return originalModuleLoad.call(moduleWithLoad, request, ...rest);
};

function forceStagingEnv(password: string) {
  process.env.DRVO_FORCE_POS_SALE_TREASURY_MUTATION_PATH = 'extracted';
  const values: Record<string, string> = {
    CLOUD_DB_SERVER: '127.0.0.1',
    CLOUD_DB_PORT: '14330',
    CLOUD_DB_NAME: STAGING_DB,
    CLOUD_DB_USER: STAGING_USER,
    CLOUD_DB_PASSWORD: password,
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
  throw new Error(`FAIL: ${message}`);
}

async function main() {
  const password = process.env.DRVO_STAGING_DB_PASSWORD;
  if (!password) fail('DRVO_STAGING_DB_PASSWORD not set');
  forceStagingEnv(password);

  const mssql = await import('mssql');
  const sql = mssql.default;
  const { getPool, closePool } = await import('../src/lib/db');
  const { createSale, updateSale, deleteSale } = await import('../src/apps/pos/public');
  const { defaultSaleIdempotencyKey } = await import(
    '../src/apps/treasury/internal/saleCommandFingerprint'
  );
  const { computeInvoiceItemsTotals } = await import('../src/lib/sales/service-line-totals');
  const { resolveSplitPaymentConfig } = await import('../src/lib/clearingMethod');

  type Tx = sql.Transaction;

  async function assertIdentity(queryable: Tx | sql.ConnectionPool) {
    const guard = await new sql.Request(queryable).query(
      `SELECT DB_NAME() AS db, SUSER_SNAME() AS login`,
    );
    const db = String(guard.recordset[0]?.db ?? '');
    const login = String(guard.recordset[0]?.login ?? '');
    if (db === PRODUCTION_DB) fail('refusing production last132');
    if (db !== STAGING_DB || login !== STAGING_USER) {
      fail(`expected ${STAGING_DB}/${STAGING_USER}, got ${db}/${login}`);
    }
  }

  async function registryForSale(tx: Tx | sql.ConnectionPool, invId: number) {
    const key = defaultSaleIdempotencyKey(invId, 'مبيعات');
    const res = await new sql.Request(tx).input('key', sql.NVarChar(256), key).query(`
      SELECT r.CashMoveId, r.Fingerprint, cm.ID AS liveId, ISNULL(cm.IsReversed, 0) AS IsReversed
      FROM dbo.TreasuryMovementRegistry r
      LEFT JOIN dbo.TblCashMove cm ON cm.ID = r.CashMoveId
      WHERE r.IdempotencyKey = @key AND r.Kind = N'sale'
    `);
    return res.recordset[0] as
      | { CashMoveId: number; Fingerprint: string; liveId: number | null; IsReversed: number }
      | undefined;
  }

  async function activeSaleCashMoveCount(tx: Tx | sql.ConnectionPool, invId: number) {
    const res = await new sql.Request(tx).input('invID', sql.Int, invId).query(`
      SELECT COUNT(*) AS cnt
      FROM dbo.TblCashMove
      WHERE invID = @invID AND invType = N'مبيعات'
        AND ISNULL(IsReversed, 0) = 0 AND inOut = N'in'
    `);
    return Number(res.recordset[0]?.cnt ?? 0);
  }

  async function withTx<T>(pool: sql.ConnectionPool, fn: (tx: Tx) => Promise<T>): Promise<T> {
    const tx = new sql.Transaction(pool);
    await tx.begin();
    try {
      await assertIdentity(tx);
      const result = await fn(tx);
      await tx.rollback();
      return result;
    } catch (err) {
      try {
        await tx.rollback();
      } catch {
        /* already closed */
      }
      throw err;
    }
  }

  const pool = await getPool();
  await assertIdentity(pool);

  const shift = await pool.request().query(`
    SELECT TOP 1
      sm.UserID AS userId,
      sm.BranchID AS branchId,
      sm.ID AS shiftMoveId,
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

  const userId = Number(open.userId);
  const branchId = Number(open.branchId);
  const shiftMoveId = Number(open.shiftMoveId);
  const businessDayId = Number(open.businessDayId);
  const businessDate = String(open.businessDate);
  const branchName = String(open.branchName ?? 'staging');
  const splitCfg = await resolveSplitPaymentConfig(pool);

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
    INSERT INTO dbo.TblClient (Name, Notes, RegisterDate)
    OUTPUT INSERTED.ClientID AS clientId
    VALUES (N'${MARKER}', N'${MARKER}', CAST(GETDATE() AS date))
  `);
  const clientRow = client.recordset[0] as { clientId?: number; ClientID?: number } | undefined;
  const clientId = Number(clientRow?.clientId ?? clientRow?.ClientID ?? 0);
  if (!clientId) fail(`could not create smoke client: ${JSON.stringify(clientRow)}`);

  const baseItem = {
    proId,
    empId,
    sPrice: 100,
    qty: 1,
    bonus: 0,
    dis: 0,
    disVal: 0,
    notes: MARKER,
  };

  async function createSmokeSale(amount: number) {
    const item = { ...baseItem, sPrice: amount };
    const computed = computeInvoiceItemsTotals([item], {});
    return createSale({
      items: [item],
      clientId,
      notes: `${MARKER}-create`,
      notes2: MARKER,
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
  }

  async function purgeTreasurySaleArtifacts(invId: number) {
    const saleKey = defaultSaleIdempotencyKey(invId, 'مبيعات');
    await pool.request()
      .input('invID', sql.Int, invId)
      .input('saleKey', sql.NVarChar(256), saleKey)
      .input('outboxKey', sql.NVarChar(256), `treasury.sale.posted:${saleKey}`)
      .query(`
        DELETE FROM dbo.TreasuryMovementRegistry
        WHERE CashMoveId IN (SELECT ID FROM dbo.TblCashMove WHERE invID = @invID AND invType = N'مبيعات')
           OR CashMoveId IN (
             SELECT ID FROM dbo.TblCashMove
             WHERE ReversalOfCashMoveId IN (
               SELECT ID FROM dbo.TblCashMove WHERE invID = @invID AND invType = N'مبيعات'
             )
           )
           OR IdempotencyKey = @saleKey
           OR IdempotencyKey LIKE N'pos-sale:%:' + CAST(@invID AS nvarchar(20));
        DELETE FROM dbo.PlatformOutbox
        WHERE IdempotencyKey = @outboxKey
           OR IdempotencyKey LIKE N'treasury.sale.%:pos-sale:%:' + CAST(@invID AS nvarchar(20))
           OR IdempotencyKey LIKE N'treasury.movement.reversed:pos-sale:%:' + CAST(@invID AS nvarchar(20))
           OR IdempotencyKey LIKE N'treasury.movement.reversed:pos-sale:delete-reverse:%:' + CAST(@invID AS nvarchar(20))
           OR IdempotencyKey LIKE N'treasury.movement.reversed:pos-sale:replace-reverse:%:' + CAST(@invID AS nvarchar(20));
        DELETE FROM dbo.TblCashMove
        WHERE ReversalOfCashMoveId IN (
          SELECT ID FROM dbo.TblCashMove WHERE invID = @invID AND invType = N'مبيعات'
        );
        DELETE FROM dbo.TblCashMove WHERE invID = @invID AND invType = N'مبيعات';
      `);
  }

  async function cleanupMarkerInvoices() {
    const rows = await pool.request().query(`
      SELECT invID, BranchID FROM dbo.TblinvServHead
      WHERE Notes LIKE N'%${MARKER}%' OR Notes2 = N'${MARKER}'
    `);
    for (const row of rows.recordset) {
      const invId = Number(row.invID);
      try {
        await cleanupInvoice(invId, Number(row.BranchID));
      } catch {
        await purgeTreasurySaleArtifacts(invId);
      }
    }
    const orphanCash = await pool.request().query(`
      SELECT DISTINCT invID FROM dbo.TblCashMove
      WHERE Notes LIKE N'%${MARKER}%' AND invType = N'مبيعات'
    `);
    for (const row of orphanCash.recordset) {
      await purgeTreasurySaleArtifacts(Number(row.invID));
    }
  }

  async function cleanupInvoice(invId: number, branch = branchId) {
    await purgeTreasurySaleArtifacts(invId);
    const cleanup = new sql.Transaction(pool);
    await cleanup.begin();
    try {
      await deleteSale(cleanup, invId, branch, userId);
      await cleanup.commit();
    } catch (err) {
      try {
        await cleanup.rollback();
      } catch {
        /* ignore */
      }
      await purgeTreasurySaleArtifacts(invId);
      await pool.request().input('id', sql.Int, invId).query(`
        DELETE FROM dbo.TblinvServDetail WHERE invID = @id AND invType = N'مبيعات';
        DELETE FROM dbo.TblinvServPayment WHERE invID = @id AND invType = N'مبيعات';
        DELETE FROM dbo.TblLoyaltyPointLedger WHERE SourceInvID = @id;
        DELETE FROM dbo.TblinvServHead WHERE invID = @id;
      `);
      console.warn('WARN: fallback cleanup for invID', invId, err instanceof Error ? err.message : err);
    }
  }

  await cleanupMarkerInvoices();

  // Scenario 1: create → update single payment (update rolled back)
  {
    const created = await createSmokeSale(100);
    try {
      await withTx(pool, async (tx) => {
        await updateSale(
          tx,
          created.invID,
          {
            clientId,
            items: [{ ...baseItem, sPrice: 150 }],
            paymentMethodId,
            paymentAllocations: [{ paymentMethodId, amount: 150 }],
            notes: `${MARKER}-update-single`,
          },
          userId,
        );
        if (await activeSaleCashMoveCount(tx, created.invID) !== 1) {
          fail('update single payment should leave exactly one active sale CashMove in tx');
        }
      });
      const grand = await pool.request().input('id', sql.Int, created.invID).query(`
        SELECT GrandTotal FROM dbo.TblinvServHead WHERE invID = @id
      `);
      if (Number(grand.recordset[0]?.GrandTotal) !== 100) {
        fail('rolled-back update must not persist header change');
      }
      console.log('PASS: create → update single payment (rollback)');
    } finally {
      await cleanupInvoice(created.invID);
    }
  }

  // Scenario 2: create → delete (delete rolled back — invoice remains)
  {
    const created = await createSmokeSale(80);
    try {
      await withTx(pool, async (tx) => {
        await deleteSale(tx, created.invID, branchId, userId);
        const head = await new sql.Request(tx)
          .input('id', sql.Int, created.invID)
          .query(`SELECT COUNT(*) AS cnt FROM dbo.TblinvServHead WHERE invID = @id`);
        if (Number(head.recordset[0]?.cnt ?? 0) !== 0) {
          fail('delete in tx should remove invoice head before rollback');
        }
      });
      const still = await pool.request().input('id', sql.Int, created.invID).query(`
        SELECT COUNT(*) AS cnt FROM dbo.TblinvServHead WHERE invID = @id
      `);
      if (Number(still.recordset[0]?.cnt ?? 0) !== 1) {
        fail('rolled-back delete must leave invoice in place');
      }
      console.log('PASS: create → delete (rollback)');
    } finally {
      await cleanupInvoice(created.invID);
    }
  }

  // Scenario 3: committed update → delete (registry consistency)
  {
    const created = await createSmokeSale(90);
    const updateTx = new sql.Transaction(pool);
    await updateTx.begin();
    await updateSale(
      updateTx,
      created.invID,
      {
        clientId,
        items: [{ ...baseItem, sPrice: 110 }],
        paymentMethodId,
        paymentAllocations: [{ paymentMethodId, amount: 110 }],
        notes: `${MARKER}-committed-update`,
      },
      userId,
    );
    await updateTx.commit();

    const reg = await registryForSale(pool, created.invID);
    if (!reg?.liveId || reg.IsReversed) {
      fail('registry must point to live CashMove after committed update');
    }

    const deleteTx = new sql.Transaction(pool);
    await deleteTx.begin();
    await deleteSale(deleteTx, created.invID, branchId, userId);
    await deleteTx.commit();

    const regAfter = await registryForSale(pool, created.invID);
    if (regAfter) fail('registry must be removed after committed treasury delete');
    console.log('PASS: update → delete registry consistency');
  }

  console.log('DRVO-010 sale mutation staging smoke complete');
  await closePool();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

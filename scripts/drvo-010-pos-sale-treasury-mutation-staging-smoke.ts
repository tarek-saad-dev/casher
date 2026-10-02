#!/usr/bin/env npx tsx
/**
 * DRVO-010 staging smoke — last132_agent / drvo_agent only.
 * Proves Treasury replace/remove sale mutation seams on last132_agent only.
 * Covers single/split transitions, a second update, replay, zero-total,
 * zero-total replace then delete, create/update delete, non-registry fallback,
 * and the flag-off split INSERT.
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
  const { replaceSaleCashMove } = await import('../src/apps/treasury/internal/replaceSaleCashMove');
  const { buildPosPortsForStaffUser } = await import('../src/lib/posComposition');
  const {
    defaultSaleIdempotencyKey,
    saleReplacedOutboxIdempotencyKey,
    saleReplaceReverseIdempotencyKey,
  } = await import('../src/apps/treasury/internal/saleCommandFingerprint');
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
      SELECT TOP 2 PaymentID AS paymentMethodId
      FROM dbo.TblPaymentMethods
      WHERE PaymentID <> @clearing
      ORDER BY PaymentID
    `);
  const paymentMethodIds = payMethod.recordset.map((row) => Number(row.paymentMethodId));
  if (paymentMethodIds.length < 2) fail('need two non-clearing payment methods');
  const paymentMethodId = paymentMethodIds[0]!;

  async function deleteSmokeClients() {
    const owned = await pool.request().query(`
      SELECT ClientID FROM dbo.TblClient WHERE Name = N'${MARKER}'
    `);
    for (const row of owned.recordset) {
      const id = Number(row.ClientID);
      const heads = await pool.request().input('id', sql.Int, id).query(`
        SELECT COUNT(*) AS cnt FROM dbo.TblinvServHead WHERE ClientID = @id
      `);
      if (Number(heads.recordset[0]?.cnt ?? 0) !== 0) continue;
      await pool.request().input('id', sql.Int, id).query(`
        UPDATE dbo.TblCashMove SET ClientID = NULL WHERE ClientID = @id;
        IF OBJECT_ID(N'dbo.TblClientLoyalty', N'U') IS NOT NULL
          DELETE FROM dbo.TblClientLoyalty WHERE ClientID = @id;
        DELETE FROM dbo.TblLoyaltyPointLedger WHERE ClientID = @id;
        DELETE FROM dbo.TblClient WHERE ClientID = @id AND Name = N'${MARKER}';
      `);
    }
  }

  await deleteSmokeClients();

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

  function allocationsFor(amount: number, split: boolean) {
    if (!split) return [{ paymentMethodId, amount }];
    const first = Math.round(amount * 60) / 100;
    const second = Math.round((amount - first) * 100) / 100;
    return [
      { paymentMethodId: paymentMethodIds[0]!, amount: first },
      { paymentMethodId: paymentMethodIds[1]!, amount: second },
    ];
  }

  async function createSmokeSale(amount: number, split = false) {
    const item = { ...baseItem, sPrice: amount };
    const computed = computeInvoiceItemsTotals([item], {});
    const allocations = allocationsFor(computed.grandTotal, split);
    return createSale({
      items: [item],
      clientId,
      notes: `${MARKER}-create`,
      notes2: MARKER,
      payCash: computed.grandTotal,
      payVisa: 0,
      paymentAllocations: allocations,
      computed,
      branchId,
      businessDayId,
      shiftMoveID: shiftMoveId,
      invDate: businessDate,
      userID: userId,
      splitCfg,
      activeAllocations: allocations,
      isSplitPayment: split,
      headerPaymentMethodId: split ? splitCfg.clearingMethodId : paymentMethodId,
      branchName,
    });
  }

  function updateInput(amount: number, split: boolean, note: string) {
    return {
      clientId,
      items: [{ ...baseItem, sPrice: amount }],
      paymentMethodId,
      paymentAllocations: amount > 0 ? allocationsFor(amount, split) : [],
      notes: note,
    };
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
           OR IdempotencyKey LIKE N'pos-sale:%:' + CAST(@invID AS nvarchar(20))
           OR IdempotencyKey LIKE N'pos-sale:%:' + CAST(@invID AS nvarchar(20)) + N':%';
        DELETE FROM dbo.PlatformOutbox
        WHERE IdempotencyKey = @outboxKey
           OR IdempotencyKey LIKE N'treasury.sale.%:pos-sale:%:' + CAST(@invID AS nvarchar(20))
           OR IdempotencyKey LIKE N'treasury.sale.%:pos-sale:%:' + CAST(@invID AS nvarchar(20)) + N':%'
           OR IdempotencyKey LIKE N'treasury.movement.reversed:pos-sale:%:' + CAST(@invID AS nvarchar(20))
           OR IdempotencyKey LIKE N'treasury.movement.reversed:pos-sale:%:' + CAST(@invID AS nvarchar(20)) + N':%';
        DELETE FROM dbo.TblCashMove
        WHERE Notes LIKE N'%فاتورة ' + CAST(@invID AS nvarchar(20)) + N' -%';
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
    const head = await pool.request().input('id', sql.Int, invId).query(`
      SELECT COUNT(*) AS cnt FROM dbo.TblinvServHead WHERE invID = @id
    `);
    if (Number(head.recordset[0]?.cnt ?? 0) > 0) {
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
        await pool.request().input('id', sql.Int, invId).query(`
          DELETE FROM dbo.TblinvServDetail WHERE invID = @id AND invType = N'مبيعات';
          DELETE FROM dbo.TblinvServPayment WHERE invID = @id AND invType = N'مبيعات';
          DELETE FROM dbo.TblLoyaltyPointLedger WHERE SourceInvID = @id;
          DELETE FROM dbo.TblinvServHead WHERE invID = @id;
        `);
        console.warn('WARN: fallback cleanup for invID', invId, err instanceof Error ? err.message : err);
      }
    }
    // After delete, purge reversal rows and split-transfer notes that delete inserted.
    await purgeTreasurySaleArtifacts(invId);
  }

  async function paymentBalance(
    queryable: Tx | sql.ConnectionPool,
    methodId: number,
    shiftId?: number,
  ) {
    const req = new sql.Request(queryable).input('pm', sql.Int, methodId);
    let shiftSql = '';
    if (shiftId != null) {
      req.input('shift', sql.Int, shiftId);
      shiftSql = ' AND ShiftMoveID = @shift';
    }
    const res = await req.query(`
      SELECT COALESCE(SUM(CASE WHEN inOut = N'in' THEN GrandTolal ELSE -GrandTolal END), 0) AS balance
      FROM dbo.TblCashMove
      WHERE PaymentMethodID = @pm${shiftSql}
    `);
    return Number(res.recordset[0]?.balance ?? 0);
  }

  async function assertTriggerEnabled(label: string) {
    const res = await pool.request().query(`
      SELECT is_disabled AS disabled
      FROM sys.triggers
      WHERE name = N'InsCashMoveSales'
    `);
    if (!res.recordset[0] || Number(res.recordset[0].disabled) !== 0) {
      fail(`InsCashMoveSales missing or disabled (${label})`);
    }
  }

  async function liveSaleMoves(queryable: Tx | sql.ConnectionPool, invId: number) {
    const res = await new sql.Request(queryable).input('invID', sql.Int, invId).query(`
      SELECT ID, PaymentMethodID, GrandTolal, BranchID, BusinessDayID
      FROM dbo.TblCashMove
      WHERE invID = @invID AND invType = N'مبيعات'
        AND ISNULL(IsReversed, 0) = 0 AND inOut = N'in'
    `);
    return res.recordset as Array<{
      ID: number;
      PaymentMethodID: number;
      GrandTolal: number;
      BranchID: number | null;
      BusinessDayID: number | null;
    }>;
  }

  async function saleMoveCount(queryable: Tx | sql.ConnectionPool, invId: number) {
    const res = await new sql.Request(queryable).input('invID', sql.Int, invId).query(`
      SELECT COUNT(*) AS cnt
      FROM dbo.TblCashMove
      WHERE invID = @invID AND invType = N'مبيعات'
    `);
    return Number(res.recordset[0]?.cnt ?? 0);
  }

  async function assertNoResidue(invId: number, label: string) {
    const moves = await saleMoveCount(pool, invId);
    const head = await pool.request().input('id', sql.Int, invId).query(`
      SELECT COUNT(*) AS cnt FROM dbo.TblinvServHead WHERE invID = @id AND invType = N'مبيعات'
    `);
    const key = defaultSaleIdempotencyKey(invId, 'مبيعات');
    const leftover = await pool.request()
      .input('invID', sql.Int, invId)
      .input('key', sql.NVarChar(256), key)
      .query(`
        SELECT
          (SELECT COUNT(*) FROM dbo.TreasuryMovementRegistry
            WHERE IdempotencyKey = @key
               OR IdempotencyKey LIKE N'pos-sale:%:' + CAST(@invID AS nvarchar(20))
               OR IdempotencyKey LIKE N'pos-sale:%:' + CAST(@invID AS nvarchar(20)) + N':%') AS registryRows,
          (SELECT COUNT(*) FROM dbo.PlatformOutbox
            WHERE IdempotencyKey = N'treasury.sale.posted:' + @key
               OR IdempotencyKey LIKE N'treasury.sale.%:' + @key + N'%'
               OR IdempotencyKey LIKE N'treasury.movement.reversed:pos-sale:%:' + CAST(@invID AS nvarchar(20)) + N'%') AS outboxRows,
          (SELECT COUNT(*) FROM dbo.TblCashMove
            WHERE Notes LIKE N'%فاتورة ' + CAST(@invID AS nvarchar(20)) + N' -%') AS transferRows
      `);
    const registryRows = Number(leftover.recordset[0]?.registryRows ?? 0);
    const outboxRows = Number(leftover.recordset[0]?.outboxRows ?? 0);
    const transferRows = Number(leftover.recordset[0]?.transferRows ?? 0);
    const headRows = Number(head.recordset[0]?.cnt ?? 0);
    if (moves || headRows || registryRows || outboxRows || transferRows) {
      fail(
        `residue after ${label}: moves=${moves} head=${headRows} registry=${registryRows} outbox=${outboxRows} transfers=${transferRows}`,
      );
    }
  }

  function useExtractedMutation() {
    process.env.DRVO_FORCE_POS_SALE_TREASURY_MUTATION_PATH = 'extracted';
  }

  async function commitTx(fn: (tx: Tx) => Promise<void>) {
    const tx = new sql.Transaction(pool);
    await tx.begin();
    try {
      await assertIdentity(tx);
      await fn(tx);
      await tx.commit();
    } catch (err) {
      try {
        await tx.rollback();
      } catch {
        /* already closed */
      }
      throw err;
    }
  }

  async function expectOneLive(
    queryable: Tx | sql.ConnectionPool,
    invId: number,
    label: string,
    expectedPaymentMethodId: number,
  ) {
    const rows = await liveSaleMoves(queryable, invId);
    if (rows.length !== 1) {
      fail(`${label}: expected 1 active sale CashMove, got ${rows.length}`);
    }
    const row = rows[0]!;
    if (Number(row.PaymentMethodID) !== expectedPaymentMethodId) {
      fail(`${label}: payment method ${row.PaymentMethodID} !== ${expectedPaymentMethodId}`);
    }
    if (Number(row.BranchID) !== branchId) {
      fail(`${label}: BranchID ${row.BranchID} !== ${branchId}`);
    }
    const reg = await registryForSale(queryable, invId);
    if (!reg?.liveId || Number(reg.IsReversed) !== 0) {
      fail(`${label}: registry must point at the live sale movement`);
    }
    if (Number(reg.CashMoveId) !== Number(row.ID)) {
      fail(`${label}: registry CashMoveId does not match the live row`);
    }
  }

  async function scenario(
    name: string,
    splitCreate: boolean,
    amount: number,
    run: (invId: number) => Promise<void>,
  ) {
    useExtractedMutation();
    const created = await createSmokeSale(amount, splitCreate);
    try {
      await run(created.invID);
      console.log(`PASS: ${name}`);
    } finally {
      useExtractedMutation();
      await cleanupInvoice(created.invID);
      await assertNoResidue(created.invID, name);
    }
  }

  try {
  await cleanupMarkerInvoices();
  await assertTriggerEnabled('before');

  await scenario('single → single', false, 100, async (invId) => {
    await commitTx(async (tx) => {
      await updateSale(tx, invId, updateInput(150, false, `${MARKER}-single-single`), userId);
      await expectOneLive(tx, invId, 'single → single', paymentMethodId);
    });
    await expectOneLive(pool, invId, 'single → single committed', paymentMethodId);
  });

  await scenario('single → single rollback', false, 100, async (invId) => {
    await withTx(pool, async (tx) => {
      await updateSale(tx, invId, updateInput(150, false, `${MARKER}-single-rollback`), userId);
      await expectOneLive(tx, invId, 'single → single in tx', paymentMethodId);
    });
    const grand = await pool.request().input('id', sql.Int, invId).query(`
      SELECT GrandTotal FROM dbo.TblinvServHead WHERE invID = @id
    `);
    if (Number(grand.recordset[0]?.GrandTotal) !== 100) {
      fail('rolled-back single update must not persist the header change');
    }
    await expectOneLive(pool, invId, 'single → single after rollback', paymentMethodId);
  });

  await scenario('single → split', false, 100, async (invId) => {
    await commitTx(async (tx) => {
      await updateSale(tx, invId, updateInput(150, true, `${MARKER}-single-split`), userId);
      await expectOneLive(tx, invId, 'single → split', splitCfg.clearingMethodId);
    });
    await expectOneLive(pool, invId, 'single → split committed', splitCfg.clearingMethodId);
  });

  await scenario('split → single', true, 100, async (invId) => {
    await commitTx(async (tx) => {
      await updateSale(tx, invId, updateInput(130, false, `${MARKER}-split-single`), userId);
      await expectOneLive(tx, invId, 'split → single', paymentMethodId);
    });
    await expectOneLive(pool, invId, 'split → single committed', paymentMethodId);
  });

  await scenario('split → split', true, 100, async (invId) => {
    await commitTx(async (tx) => {
      await updateSale(tx, invId, updateInput(140, true, `${MARKER}-split-split`), userId);
      await expectOneLive(tx, invId, 'split → split', splitCfg.clearingMethodId);
    });
    await expectOneLive(pool, invId, 'split → split committed', splitCfg.clearingMethodId);
  });

  await scenario('repeated second update', false, 100, async (invId) => {
    await commitTx(async (tx) => {
      await updateSale(tx, invId, updateInput(150, false, `${MARKER}-edit-1`), userId);
    });
    await commitTx(async (tx) => {
      await updateSale(tx, invId, updateInput(180, false, `${MARKER}-edit-2`), userId);
      await expectOneLive(tx, invId, 'second update', paymentMethodId);
    });
    await expectOneLive(pool, invId, 'second update committed', paymentMethodId);
    const keys = await pool.request().input('invID', sql.Int, invId).query(`
      SELECT
        (SELECT COUNT(DISTINCT IdempotencyKey) FROM dbo.TreasuryMovementRegistry
          WHERE Kind = N'reverse'
            AND IdempotencyKey LIKE N'pos-sale:replace-reverse:%:' + CAST(@invID AS nvarchar(20)) + N':%') AS reverses,
        (SELECT COUNT(DISTINCT IdempotencyKey) FROM dbo.PlatformOutbox
          WHERE IdempotencyKey LIKE N'treasury.sale.replaced:pos-sale:%:' + CAST(@invID AS nvarchar(20)) + N':%') AS replaced
    `);
    if (Number(keys.recordset[0]?.reverses) !== 2) {
      fail(`second update expected 2 reversal keys, got ${keys.recordset[0]?.reverses}`);
    }
    if (Number(keys.recordset[0]?.replaced) !== 2) {
      fail(`second update expected 2 replacement outbox keys, got ${keys.recordset[0]?.replaced}`);
    }
  });

  await scenario('replay idempotency', false, 100, async (invId) => {
    const before = await registryForSale(pool, invId);
    if (!before?.CashMoveId) fail('replay setup missing registry');
    const priorId = Number(before.CashMoveId);
    const ports = await buildPosPortsForStaffUser(userId);
    const saleKey = defaultSaleIdempotencyKey(invId, 'مبيعات');
    const command = {
      tenantId: ports.tenantId,
      saleInvId: invId,
      invType: 'مبيعات' as const,
      invDate: businessDate,
      invTime: '15.45',
      clientId,
      amount: 160,
      inOut: 'in' as const,
      notes: `${MARKER}-replay`,
      shiftMoveId: null,
      paymentMethodId,
      branchId,
      businessDayId,
      sourceRef: `pos-sale:${invId}`,
      idempotencyKey: saleKey,
    };
    await commitTx(async (tx) => {
      const first = await replaceSaleCashMove(tx, ports.actor, command);
      const second = await replaceSaleCashMove(tx, ports.actor, command);
      if (first == null || first !== second) fail('replay returned a different CashMove');
      await expectOneLive(tx, invId, 'replay', paymentMethodId);
      const revKey = saleReplaceReverseIdempotencyKey(invId, 'مبيعات', priorId);
      const outboxKey = saleReplacedOutboxIdempotencyKey(saleKey, priorId);
      const counts = await new sql.Request(tx)
        .input('revKey', sql.NVarChar(256), revKey)
        .input('outboxKey', sql.NVarChar(256), outboxKey)
        .query(`
          SELECT
            (SELECT COUNT(*) FROM dbo.TreasuryMovementRegistry WHERE IdempotencyKey = @revKey) AS reverses,
            (SELECT COUNT(*) FROM dbo.PlatformOutbox WHERE IdempotencyKey = @outboxKey) AS outbox
        `);
      if (Number(counts.recordset[0]?.reverses) !== 1 || Number(counts.recordset[0]?.outbox) !== 1) {
        fail(
          `replay duplicated keys reverses=${counts.recordset[0]?.reverses} outbox=${counts.recordset[0]?.outbox}`,
        );
      }
    });
  });

  await (async () => {
    const name = 'zero-total replace then delete';
    useExtractedMutation();
    const beforeMethod = await paymentBalance(pool, paymentMethodId);
    const beforeShift = await paymentBalance(pool, paymentMethodId, shiftMoveId);
    const created = await createSmokeSale(100, false);
    const invId = created.invID;
    try {
      await commitTx(async (tx) => {
        await updateSale(tx, invId, updateInput(0, false, `${MARKER}-zero-then-delete`), userId);
        if ((await activeSaleCashMoveCount(tx, invId)) !== 0) {
          fail('zero-total before delete left an active sale CashMove');
        }
        if (await registryForSale(tx, invId)) fail('zero-total before delete left a sale registry row');
      });
      await commitTx(async (tx) => {
        await deleteSale(tx, invId, branchId, userId);
      });
      const head = await pool.request().input('id', sql.Int, invId).query(`
        SELECT COUNT(*) AS cnt FROM dbo.TblinvServHead WHERE invID = @id
      `);
      if (Number(head.recordset[0]?.cnt ?? 0) !== 0) fail('zero-total delete left the invoice');
      const pair = await pool.request().input('invID', sql.Int, invId).query(`
        SELECT
          o.ID AS originalId,
          ISNULL(o.IsReversed, 0) AS isReversed,
          o.GrandTolal AS originalAmount,
          o.inOut AS originalInOut,
          o.PaymentMethodID AS paymentMethodId,
          c.ID AS childId,
          c.GrandTolal AS childAmount,
          c.inOut AS childInOut,
          c.ReversalOfCashMoveId AS reversalOf
        FROM dbo.TblCashMove o
        JOIN dbo.TblCashMove c ON c.ReversalOfCashMoveId = o.ID
        WHERE o.invID = @invID AND o.invType = N'مبيعات'
      `);
      if (pair.recordset.length !== 1) {
        fail(`zero-total delete must keep one reversal pair, got ${pair.recordset.length}`);
      }
      const row = pair.recordset[0]!;
      if (Number(row.isReversed) !== 1) fail('preserved original must stay marked reversed');
      if (Number(row.reversalOf) !== Number(row.originalId)) {
        fail('reversal child does not point at the preserved original');
      }
      if (Number(row.paymentMethodId) !== paymentMethodId) {
        fail('preserved pair is on a different payment method');
      }
      const originalSigned =
        String(row.originalInOut) === 'in' ? Number(row.originalAmount) : -Number(row.originalAmount);
      const childSigned =
        String(row.childInOut) === 'in' ? Number(row.childAmount) : -Number(row.childAmount);
      if (Math.abs(originalSigned + childSigned) > 0.001) {
        fail(`reversal pair is not balanced (${originalSigned} + ${childSigned})`);
      }
      const afterMethod = await paymentBalance(pool, paymentMethodId);
      const afterShift = await paymentBalance(pool, paymentMethodId, shiftMoveId);
      if (afterMethod !== beforeMethod) {
        fail(`payment-method balance changed ${beforeMethod} -> ${afterMethod}`);
      }
      if (afterShift !== beforeShift) {
        fail(`payment-method shift balance changed ${beforeShift} -> ${afterShift}`);
      }
      console.log(`PASS: ${name}`);
    } finally {
      useExtractedMutation();
      await cleanupInvoice(invId);
      await assertNoResidue(invId, name);
    }
  })();

  await scenario('zero-total then positive', false, 100, async (invId) => {
    await commitTx(async (tx) => {
      await updateSale(tx, invId, updateInput(0, false, `${MARKER}-zero`), userId);
      if (await activeSaleCashMoveCount(tx, invId) !== 0) {
        fail('zero-total must leave no active sale CashMove');
      }
      if (await registryForSale(tx, invId)) fail('zero-total must remove the sale registry row');
    });
    await commitTx(async (tx) => {
      await updateSale(tx, invId, updateInput(120, false, `${MARKER}-after-zero`), userId);
      await expectOneLive(tx, invId, 'positive after zero', paymentMethodId);
    });
    await expectOneLive(pool, invId, 'positive after zero committed', paymentMethodId);
  });

  await scenario('create → delete single', false, 80, async (invId) => {
    await commitTx(async (tx) => {
      await deleteSale(tx, invId, branchId, userId);
    });
    if (await registryForSale(pool, invId)) fail('delete single left a sale registry row');
    if (await activeSaleCashMoveCount(pool, invId) !== 0) fail('delete single left an active sale CashMove');
  });

  await scenario('create → delete split', true, 80, async (invId) => {
    await commitTx(async (tx) => {
      await deleteSale(tx, invId, branchId, userId);
    });
    if (await registryForSale(pool, invId)) fail('delete split left a sale registry row');
    if (await activeSaleCashMoveCount(pool, invId) !== 0) fail('delete split left an active sale CashMove');
  });

  await scenario('update → delete', false, 90, async (invId) => {
    await commitTx(async (tx) => {
      await updateSale(tx, invId, updateInput(110, false, `${MARKER}-before-delete`), userId);
      await expectOneLive(tx, invId, 'update before delete', paymentMethodId);
    });
    await commitTx(async (tx) => {
      await deleteSale(tx, invId, branchId, userId);
    });
    if (await registryForSale(pool, invId)) fail('update → delete left a sale registry row');
    if (await activeSaleCashMoveCount(pool, invId) !== 0) {
      fail('update → delete left an active sale CashMove');
    }
  });

  await scenario('non-registry legacy update', false, 100, async (invId) => {
    const before = await registryForSale(pool, invId);
    const oldId = Number(before?.CashMoveId ?? 0);
    if (!oldId) fail('non-registry setup missing cash move');
    await withTx(pool, async (tx) => {
      const saleKey = defaultSaleIdempotencyKey(invId, 'مبيعات');
      await new sql.Request(tx).input('key', sql.NVarChar(256), saleKey).query(`
        DELETE FROM dbo.TreasuryMovementRegistry
        WHERE IdempotencyKey = @key AND Kind = N'sale'
      `);
      await updateSale(tx, invId, updateInput(140, false, `${MARKER}-legacy-positive`), userId);
      const still = await new sql.Request(tx).input('id', sql.Int, oldId).query(`
        SELECT COUNT(*) AS cnt FROM dbo.TblCashMove WHERE ID = @id
      `);
      if (Number(still.recordset[0]?.cnt ?? 0) !== 0) {
        fail('non-registry update left the legacy sale CashMove in place');
      }
      await expectOneLive(tx, invId, 'non-registry positive', paymentMethodId);
    });
    await withTx(pool, async (tx) => {
      const saleKey = defaultSaleIdempotencyKey(invId, 'مبيعات');
      await new sql.Request(tx).input('key', sql.NVarChar(256), saleKey).query(`
        DELETE FROM dbo.TreasuryMovementRegistry
        WHERE IdempotencyKey = @key AND Kind = N'sale'
      `);
      await updateSale(tx, invId, updateInput(0, false, `${MARKER}-legacy-zero`), userId);
      if (await saleMoveCount(tx, invId) !== 0) {
        fail('non-registry zero-total left a sale CashMove');
      }
      if (await registryForSale(tx, invId)) fail('non-registry zero-total created a registry row');
    });
  });

  await scenario('flag-off split update SQL', false, 100, async (invId) => {
    process.env.DRVO_FORCE_POS_SALE_TREASURY_MUTATION_PATH = 'legacy';
    try {
      await withTx(pool, async (tx) => {
        const saleKey = defaultSaleIdempotencyKey(invId, 'مبيعات');
        // The legacy rewrite hard-deletes TblCashMove. Drop the registry row in this
        // rolled-back transaction first so the treasury FK does not block the INSERT.
        await new sql.Request(tx).input('key', sql.NVarChar(256), saleKey).query(`
          DELETE FROM dbo.TreasuryMovementRegistry
          WHERE IdempotencyKey = @key AND Kind = N'sale'
        `);
        await updateSale(tx, invId, updateInput(150, true, `${MARKER}-flag-off-split`), userId);
        const rows = await liveSaleMoves(tx, invId);
        if (rows.length !== 1) fail(`flag-off split insert produced ${rows.length} active sale rows`);
        const row = rows[0]!;
        if (Number(row.BranchID) !== branchId) fail('flag-off split insert did not store BranchID');
        if (Number(row.BusinessDayID) !== businessDayId) {
          fail('flag-off split insert did not store BusinessDayID');
        }
        if (Number(row.PaymentMethodID) !== splitCfg.clearingMethodId) {
          fail('flag-off split insert was not posted on the clearing method');
        }
      });
    } finally {
      useExtractedMutation();
    }
  });

  await deleteSmokeClients();
  const markerLeft = await pool.request().query(`
    SELECT
      (SELECT COUNT(*) FROM dbo.TblCashMove WHERE Notes LIKE N'%${MARKER}%') AS cashMoves,
      (SELECT COUNT(*) FROM dbo.TblinvServHead WHERE Notes LIKE N'%${MARKER}%' OR Notes2 = N'${MARKER}') AS heads,
      (SELECT COUNT(*) FROM dbo.TblClient WHERE Name = N'${MARKER}') AS clients
  `);
  if (
    Number(markerLeft.recordset[0]?.cashMoves) ||
    Number(markerLeft.recordset[0]?.heads) ||
    Number(markerLeft.recordset[0]?.clients)
  ) {
    fail(
      `marker residue cashMoves=${markerLeft.recordset[0]?.cashMoves} heads=${markerLeft.recordset[0]?.heads} clients=${markerLeft.recordset[0]?.clients}`,
    );
  }

  await assertTriggerEnabled('after');
  console.log('DRVO-010 sale mutation staging smoke complete');
  } finally {
    try {
      await deleteSmokeClients();
    } catch (cleanupErr) {
      console.error('CLEANUP client failed', cleanupErr);
    }
    await closePool();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

#!/usr/bin/env npx tsx
/**
 * DRVO-007 staging smoke — last132_agent / drvo_agent only.
 * Applies the idempotent registry migration, then posts, replays, reverses,
 * and rolls back. Never targets production last132.
 */
import path from 'path';
import Module from 'module';
import dotenv from 'dotenv';
import type { ConnectionPool } from 'mssql';

dotenv.config({ path: path.join(__dirname, '..', '.env') });
dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

const STAGING_DB = 'last132_agent';
const STAGING_USER = 'drvo_agent';
const PRODUCTION_DB = 'last132';
const MARKER = 'DRVO007-SMOKE';

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
    CLOUD_DB_SERVER: '127.0.0.1',
    CLOUD_DB_PORT: '14330',
    CLOUD_DB_NAME: STAGING_DB,
    CLOUD_DB_USER: STAGING_USER,
    CLOUD_DB_PASSWORD: password,
    CLOUD_DB_ENCRYPT: 'false',
    CLOUD_DB_TRUST_CERT: 'true',
    DB_SERVER: '127.0.0.1',
    DB_PORT: '14330',
    DB_DATABASE: STAGING_DB,
    DB_NAME: STAGING_DB,
    DB_USER: STAGING_USER,
    DB_PASSWORD: password,
    DB_ENCRYPT: 'false',
    DB_TRUST_SERVER_CERTIFICATE: 'true',
    LOCAL_DB_SERVER: '127.0.0.1',
    LOCAL_DB_PORT: '14330',
    LOCAL_DB_NAME: STAGING_DB,
    LOCAL_DB_USER: STAGING_USER,
    LOCAL_DB_PASSWORD: password,
    LOCAL_DB_ENCRYPT: 'false',
    LOCAL_DB_TRUST_CERT: 'true',
  };
  for (const [key, value] of Object.entries(values)) process.env[key] = value;
  delete process.env.HAWAI_DB_CLASS;
  delete process.env.BOOKING_V2_DB_CLASS;
  delete process.env.BOOKING_V2_FORCE_LOCAL_DB;
  delete process.env.BOOKING_V2_USE_TRUSTED_CONNECTION;
  delete process.env.DB_TRUSTED_CONNECTION;
  delete process.env.LOCAL_DB_TRUSTED_CONNECTION;
}

function fail(message: string): never {
  console.error(`FAIL: ${message}`);
  process.exit(1);
}

async function assertIdentity(queryable: { request: () => { query: (q: string) => Promise<{ recordset: Array<Record<string, unknown>> }> } }) {
  const guard = await queryable.request().query(`SELECT DB_NAME() AS db, SUSER_SNAME() AS login`);
  const db = String(guard.recordset[0]?.db ?? '');
  const login = String(guard.recordset[0]?.login ?? '');
  if (db === PRODUCTION_DB) fail('refusing production last132');
  if (db !== STAGING_DB || login !== STAGING_USER) {
    fail(`expected ${STAGING_DB}/${STAGING_USER}, got ${db}/${login}`);
  }
  return { db, login };
}

async function main() {
  const password = process.env.DRVO_STAGING_DB_PASSWORD;
  if (!password) fail('DRVO_STAGING_DB_PASSWORD not set');
  forceStagingEnv(password);

  const mssql = await import('mssql');
  const sql = mssql.default;
  const { getPool, closePool } = await import('../src/lib/db');
  const { applyDrvo007TreasuryMigration } = await import('./drvo007Migration');
  const { resolveLegacyBootstrapTenantId } = await import('../src/platform/tenant/legacyBootstrapSeam');
  const resolveBootstrapTenantId = () => resolveLegacyBootstrapTenantId('casher-boot-staging-smoke');
  const { buildTreasuryWritePorts } = await import('../src/lib/treasuryComposition');
  const { createIncomeThroughTreasury } = await import('../src/apps/treasury/application/createIncome');
  const { createExpenseThroughTreasury } = await import('../src/apps/treasury/application/createExpense');
  const { postTransferPair } = await import('../src/apps/treasury/internal/postTransferPair');
  const { reverseMoneyMovementByCashMoveId } = await import('../src/apps/treasury/internal/reverseMovement');
  const { withUnitOfWork } = await import('../src/platform/public');

  const pool = await getPool();
  const createdIds: number[] = [];
  try {
    await assertIdentity(pool);
    console.log('PASS: staging DB guard');

    const triggerBefore = await pool.request().query(`
      SELECT t.name, t.is_disabled, OBJECT_NAME(t.parent_id) AS parentName,
             CHECKSUM(OBJECT_DEFINITION(t.object_id)) AS defHash
      FROM sys.triggers t
      WHERE t.name = N'InsCashMoveSales'
    `);
    const trigger = triggerBefore.recordset[0];
    if (!trigger) fail('InsCashMoveSales trigger not found');
    if (trigger.is_disabled) fail('InsCashMoveSales must remain enabled');
    console.log(`PASS: InsCashMoveSales live on ${trigger.parentName}`);

    await applyDrvo007TreasuryMigration(pool);
    console.log('PASS: TreasuryMovementRegistry migration');

    const fixture = await pool.request().query(`
      SELECT TOP 1
        sm.UserID AS userId,
        sm.BranchID AS branchId,
        sm.ID AS shiftId,
        sm.BusinessDayID AS businessDayId,
        CONVERT(varchar(10), d.NewDay, 23) AS businessDate
      FROM dbo.TblShiftMove sm
      INNER JOIN dbo.TblNewDay d ON d.ID = sm.BusinessDayID
      WHERE sm.Status = 1
      ORDER BY sm.ID DESC
    `);
    const openShift = fixture.recordset[0] as {
      userId: number;
      branchId: number;
      shiftId: number;
      businessDayId: number;
      businessDate: string;
    } | undefined;

    const day = openShift ?? (await pool.request().query(`
      SELECT TOP 1
        d.BranchID AS branchId,
        d.ID AS businessDayId,
        CONVERT(varchar(10), d.NewDay, 23) AS businessDate,
        (SELECT TOP 1 UserID FROM dbo.TblUser WHERE UserID > 0 ORDER BY UserID) AS userId
      FROM dbo.TblNewDay d
      ORDER BY d.ID DESC
    `)).recordset[0];
    if (!day) fail('no business day fixture on staging');

    const cats = await pool.request().query(`
      SELECT
        (SELECT TOP 1 ExpINID FROM dbo.TblExpINCat WHERE ExpINType = N'ايرادات' ORDER BY ExpINID) AS incomeCat,
        (SELECT TOP 1 ExpINID FROM dbo.TblExpINCat WHERE ExpINType = N'مصروفات' ORDER BY ExpINID) AS expenseCat,
        (SELECT TOP 1 PaymentID FROM dbo.TblPaymentMethods ORDER BY PaymentID) AS pmA,
        (SELECT TOP 1 PaymentID FROM dbo.TblPaymentMethods WHERE PaymentID <>
          (SELECT TOP 1 PaymentID FROM dbo.TblPaymentMethods ORDER BY PaymentID)
          ORDER BY PaymentID) AS pmB
    `);
    const cat = cats.recordset[0];
    if (!cat?.incomeCat || !cat?.expenseCat || !cat?.pmA || !cat?.pmB) {
      fail('missing income/expense category or two payment methods');
    }

    const tenantId = await resolveBootstrapTenantId();
    const actor = {
      actorType: 'staff' as const,
      actorId: String(day.userId),
      tenantId,
      membershipId: null,
      viewLocationId: null,
    };
    const ports = await buildTreasuryWritePorts(actor);
    const stamp = Date.now();

    async function liveTotal(invType: string, ids: number[]): Promise<number> {
      const req = pool.request();
      ids.forEach((id, i) => req.input(`id${i}`, sql.Int, id));
      const list = ids.map((_, i) => `@id${i}`).join(',');
      const res = await req.input('invType', sql.NVarChar(20), invType).query(`
        SELECT ISNULL(SUM(GrandTolal), 0) AS total
        FROM dbo.TblCashMove
        WHERE invType = @invType
          AND ID IN (${list})
          AND ISNULL(IsReversed, 0) = 0
          AND ReversalOfCashMoveId IS NULL
      `);
      return Number(res.recordset[0].total);
    }

    async function rawSum(ids: number[]): Promise<number> {
      const req = pool.request();
      ids.forEach((id, i) => req.input(`id${i}`, sql.Int, id));
      const list = ids.map((_, i) => `@id${i}`).join(',');
      const res = await req.query(`
        SELECT ISNULL(SUM(GrandTolal), 0) AS total,
               ISNULL(SUM(CASE WHEN inOut = N'in' THEN GrandTolal ELSE -GrandTolal END), 0) AS paymentNet
        FROM dbo.TblCashMove
        WHERE ID IN (${list})
      `);
      return res.recordset[0];
    }

    const historical = openShift ? undefined : {
      businessDayId: Number(day.businessDayId),
      businessDate: String(day.businessDate).slice(0, 10),
      shiftInstanceId: null as number | null,
    };

    const income = await withUnitOfWork(async ({ transaction }) => {
      await assertIdentity(transaction);
      return createIncomeThroughTreasury(transaction, ports, {
        locationId: Number(day.branchId),
        amount: 17.25,
        categoryId: Number(cat.incomeCat),
        paymentMethodId: Number(cat.pmA),
        notes: `${MARKER} income ${stamp}`,
        idempotencyKey: `${MARKER}:income:${stamp}`,
        historical,
      });
    });
    createdIds.push(income.cashMoveId);
    const incomeReplay = await withUnitOfWork(async ({ transaction }) => {
      await assertIdentity(transaction);
      return createIncomeThroughTreasury(transaction, ports, {
        locationId: Number(day.branchId),
        amount: 17.25,
        categoryId: Number(cat.incomeCat),
        paymentMethodId: Number(cat.pmA),
        notes: `${MARKER} income ${stamp}`,
        idempotencyKey: `${MARKER}:income:${stamp}`,
        historical,
      });
    });
    if (!incomeReplay.idempotentReplay || incomeReplay.cashMoveId !== income.cashMoveId) {
      fail('income replay created a second row');
    }
    if (await liveTotal('ايرادات', [income.cashMoveId]) !== 17.25) {
      fail('live income total did not include the posted income');
    }
    console.log(`PASS: ${openShift ? 'current-day' : 'historical'} income post + replay`);

    const expense = await withUnitOfWork(async ({ transaction }) => {
      await assertIdentity(transaction);
      return createExpenseThroughTreasury(transaction, ports, {
        locationId: Number(day.branchId),
        amount: 9.5,
        categoryId: Number(cat.expenseCat),
        paymentMethodId: Number(cat.pmA),
        notes: `${MARKER} expense ${stamp}`,
        idempotencyKey: `${MARKER}:expense:${stamp}`,
        historical,
      });
    });
    createdIds.push(expense.cashMoveId);
    if (await liveTotal('مصروفات', [expense.cashMoveId]) !== 9.5) {
      fail('live expense total did not include the posted expense');
    }
    console.log(`PASS: ${openShift ? 'current-day' : 'historical'} expense post`);

    const incomeReverse = await withUnitOfWork(async ({ transaction }) => {
      await assertIdentity(transaction);
      return reverseMoneyMovementByCashMoveId(transaction, ports.actor, {
        tenantId: ports.tenantId,
        cashMoveId: income.cashMoveId,
        idempotencyKey: `${MARKER}:income-reverse:${stamp}`,
        reason: 'delete',
      });
    });
    const incomeReverseReplay = await withUnitOfWork(async ({ transaction }) => {
      await assertIdentity(transaction);
      return reverseMoneyMovementByCashMoveId(transaction, ports.actor, {
        tenantId: ports.tenantId,
        cashMoveId: income.cashMoveId,
        idempotencyKey: `${MARKER}:income-reverse-again:${stamp}`,
        reason: 'delete',
      });
    });
    if (incomeReverseReplay !== incomeReverse) fail('duplicate income reverse created another row');
    if (await liveTotal('ايرادات', [income.cashMoveId, incomeReverse]) !== 0) {
      fail('reversed income still appears in live income totals');
    }
    const incomeNet = await rawSum([income.cashMoveId, incomeReverse]);
    if (Number(incomeNet.total) !== 0 || Number(incomeNet.paymentNet) !== 0) {
      fail(`income reversal did not net (sum=${incomeNet.total}, payment=${incomeNet.paymentNet})`);
    }
    console.log('PASS: income reversal nets once and drops out of live totals');

    const expenseReverse = await withUnitOfWork(async ({ transaction }) => {
      await assertIdentity(transaction);
      return reverseMoneyMovementByCashMoveId(transaction, ports.actor, {
        tenantId: ports.tenantId,
        cashMoveId: expense.cashMoveId,
        idempotencyKey: `${MARKER}:expense-reverse:${stamp}`,
        reason: 'delete',
      });
    });
    if (await liveTotal('مصروفات', [expense.cashMoveId, expenseReverse]) !== 0) {
      fail('reversed expense still appears in live expense totals');
    }
    const expenseNet = await rawSum([expense.cashMoveId, expenseReverse]);
    if (Number(expenseNet.total) !== 0 || Number(expenseNet.paymentNet) !== 0) {
      fail(`expense reversal did not net (sum=${expenseNet.total}, payment=${expenseNet.paymentNet})`);
    }
    console.log('PASS: expense reversal nets once and drops out of live totals');

    const groupKey = `${MARKER}:transfer:${stamp}`;
    const transferInput = {
      tenantId: ports.tenantId,
      locationId: Number(day.branchId),
      businessDayId: Number(day.businessDayId),
      businessDate: String(day.businessDate).slice(0, 10),
      shiftInstanceId: openShift ? Number(openShift.shiftId) : null,
      amount: 3.25,
      sourceRef: groupKey,
      transferGroupKey: groupKey,
      fromPaymentMethodId: Number(cat.pmA),
      toPaymentMethodId: Number(cat.pmB),
      expenseCategoryId: Number(cat.expenseCat),
      incomeCategoryId: Number(cat.incomeCat),
      expenseNotes: `${MARKER} transfer out ${stamp}`,
      incomeNotes: `${MARKER} transfer in ${stamp}`,
    };
    const pair = await withUnitOfWork(async ({ transaction }) => {
      await assertIdentity(transaction);
      return postTransferPair(transaction, ports.actor, transferInput);
    });
    createdIds.push(pair.expenseCashMoveId, pair.incomeCashMoveId);
    const replay = await withUnitOfWork(async ({ transaction }) => {
      await assertIdentity(transaction);
      return postTransferPair(transaction, ports.actor, transferInput);
    });
    if (!replay.idempotentReplay || replay.expenseCashMoveId !== pair.expenseCashMoveId || replay.incomeCashMoveId !== pair.incomeCashMoveId) {
      fail('transfer replay created a second pair');
    }
    const pairCount = await pool.request().input('groupKey', sql.NVarChar(256), groupKey).query(`
      SELECT COUNT(*) AS cnt FROM dbo.TreasuryMovementRegistry WHERE TransferGroupKey = @groupKey
    `);
    if (Number(pairCount.recordset[0].cnt) !== 2) fail('transfer registry row count is not 2');
    console.log('PASS: transfer pair is atomic and replay does not duplicate');

    await withUnitOfWork(async ({ transaction }) => {
      await assertIdentity(transaction);
      await reverseMoneyMovementByCashMoveId(transaction, ports.actor, {
        tenantId: ports.tenantId,
        cashMoveId: pair.expenseCashMoveId,
        idempotencyKey: `${MARKER}:transfer-out-reverse:${stamp}`,
        reason: 'delete',
      });
      await reverseMoneyMovementByCashMoveId(transaction, ports.actor, {
        tenantId: ports.tenantId,
        cashMoveId: pair.incomeCashMoveId,
        idempotencyKey: `${MARKER}:transfer-in-reverse:${stamp}`,
        reason: 'delete',
      });
    });
    console.log('PASS: transfer legs reversed');

    const rollbackKey = `${MARKER}:rollback:${stamp}`;
    const tx = new sql.Transaction(pool as ConnectionPool);
    await tx.begin();
    try {
      await assertIdentity(tx);
      await createIncomeThroughTreasury(tx, ports, {
        locationId: Number(day.branchId),
        amount: 4,
        categoryId: Number(cat.incomeCat),
        paymentMethodId: Number(cat.pmA),
        notes: `${MARKER} rollback ${stamp}`,
        idempotencyKey: rollbackKey,
        historical,
      });
      throw new Error('forced rollback');
    } catch (err) {
      await tx.rollback();
      if (!(err instanceof Error) || err.message !== 'forced rollback') throw err;
    }
    const leftover = await pool.request().input('key', sql.NVarChar(256), rollbackKey).query(`
      SELECT
        (SELECT COUNT(*) FROM dbo.TreasuryMovementRegistry WHERE IdempotencyKey = @key) AS registry,
        (SELECT COUNT(*) FROM dbo.TblCashMove WHERE Notes LIKE N'%rollback ${stamp}%') AS cash,
        (SELECT COUNT(*) FROM dbo.PlatformOutbox WHERE IdempotencyKey = N'treasury.movement.posted:' + @key) AS outbox
    `);
    const left = leftover.recordset[0];
    if (Number(left.registry) !== 0 || Number(left.cash) !== 0 || Number(left.outbox) !== 0) {
      fail(`forced rollback left rows registry=${left.registry} cash=${left.cash} outbox=${left.outbox}`);
    }
    console.log('PASS: forced rollback left no cash, registry, or outbox row');

    await probeTriggerParity(sql, pool, {
      branchId: Number(day.branchId),
      businessDayId: Number(day.businessDayId),
      businessDate: String(day.businessDate).slice(0, 10),
      shiftId: openShift ? Number(openShift.shiftId) : null,
      userId: Number(day.userId),
      paymentMethodId: Number(cat.pmA),
    });

    const triggerAfter = await pool.request().query(`
      SELECT t.is_disabled, CHECKSUM(OBJECT_DEFINITION(t.object_id)) AS defHash
      FROM sys.triggers t WHERE t.name = N'InsCashMoveSales'
    `);
    if (triggerAfter.recordset[0].is_disabled) fail('InsCashMoveSales was disabled');
    if (Number(triggerAfter.recordset[0].defHash) !== Number(trigger.defHash)) {
      fail('InsCashMoveSales definition changed');
    }
    console.log('PASS: InsCashMoveSales unchanged');
    console.log('SMOKE: PASS');
  } finally {
    await closePool();
  }
}

async function probeTriggerParity(
  sql: typeof import('mssql'),
  pool: ConnectionPool,
  ctx: {
    branchId: number;
    businessDayId: number;
    businessDate: string;
    shiftId: number | null;
    userId: number;
    paymentMethodId: number;
  },
) {
  const tx = new sql.Transaction(pool);
  await tx.begin();
  try {
    await assertIdentity(tx);
    const next = await new sql.Request(tx).query(`
      SELECT
        ISNULL((SELECT MAX(invID) FROM dbo.TblinvServHead WHERE invType = N'مبيعات'), 0) + 1 AS saleInv,
        ISNULL((SELECT MAX(invID) FROM dbo.TblinvServHead WHERE invType = N'خدمة'), 0) + 1 AS serviceInv,
        (SELECT TOP 1 ClientID FROM dbo.TblClient ORDER BY ClientID) AS clientId
    `);
    const saleInv = Number(next.recordset[0].saleInv);
    const serviceInv = Number(next.recordset[0].serviceInv);
    const clientId = Number(next.recordset[0].clientId);
    if (!clientId) fail('no TblClient row for invoice probe');

    async function insertHead(invId: number, invType: string) {
      await new sql.Request(tx)
        .input('invID', sql.Int, invId)
        .input('invType', sql.NVarChar(20), invType)
        .input('invDate', sql.Date, ctx.businessDate)
        .input('clientId', sql.Int, clientId)
        .input('userId', sql.Int, ctx.userId)
        .input('shiftId', sql.Int, ctx.shiftId)
        .input('pmId', sql.Int, ctx.paymentMethodId)
        .input('branchId', sql.Int, ctx.branchId)
        .input('businessDayId', sql.Int, ctx.businessDayId)
        .query(`
          INSERT INTO dbo.TblinvServHead (
            invID, invType, invDate, invTime, ClientID, UserID,
            TotalQty, SubTotal, Dis, DisVal, Tax, TaxVal, GrandTotal,
            invNotes, TotalBonus, ShiftMoveID,
            ReservDate, ReservTime, Notes,
            PayCash, PayVisa, isActive, Notes2, Payment, PayDue, PaymentMethodID,
            BranchID, BusinessDayID
          ) VALUES (
            @invID, @invType, @invDate, N'12:00', @clientId, @userId,
            1, 8, 0, 0, 0, 0, 8,
            N'DRVO007-SMOKE', 0, @shiftId,
            NULL, NULL, N'DRVO007-SMOKE',
            0, 0, N'no', N'', 8, 0, @pmId,
            @branchId, @businessDayId
          )
        `);
    }

    await insertHead(serviceInv, 'خدمة');
    const serviceCash = await new sql.Request(tx)
      .input('invID', sql.Int, serviceInv)
      .query(`SELECT COUNT(*) AS cnt FROM dbo.TblCashMove WHERE invID = @invID AND invType = N'خدمة'`);
    if (Number(serviceCash.recordset[0].cnt) !== 0) {
      fail('booking-style خدمة invoice posted cash');
    }
    console.log('PASS: booking conversion invoice type posts no cash');

    await insertHead(saleInv, 'مبيعات');
    const saleCash = await new sql.Request(tx)
      .input('invID', sql.Int, saleInv)
      .query(`
        SELECT c.ID
        FROM dbo.TblCashMove c
        WHERE c.invID = @invID AND c.invType = N'مبيعات'
      `);
    const saleIds = saleCash.recordset.map((row: { ID: number }) => Number(row.ID));
    if (saleIds.length !== 1) {
      fail(`POS sale trigger expected 1 cash row, got ${saleIds.length}`);
    }
    const registry = await new sql.Request(tx)
      .input('cashId', sql.Int, saleIds[0])
      .query(`SELECT COUNT(*) AS cnt FROM dbo.TreasuryMovementRegistry WHERE CashMoveId = @cashId`);
    if (Number(registry.recordset[0].cnt) !== 0) {
      fail('POS sale cash was also written to TreasuryMovementRegistry');
    }
    console.log('PASS: POS sale cash is trigger-owned and not treasury-duplicated');
  } finally {
    await tx.rollback();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack || err.message : err);
  process.exit(1);
});

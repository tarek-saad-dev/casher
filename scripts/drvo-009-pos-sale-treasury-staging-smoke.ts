#!/usr/bin/env npx tsx
/**
 * DRVO-009 staging smoke — last132_agent / drvo_agent only.
 * Verifies trigger guard + Treasury sale posting coexistence inside rolled-back transactions.
 */
import path from 'path';
import Module from 'module';
import dotenv from 'dotenv';

dotenv.config({ path: path.join(__dirname, '..', '.env') });
dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

const STAGING_DB = 'last132_agent';
const STAGING_USER = 'drvo_agent';
const PRODUCTION_DB = 'last132';
const MARKER = 'DRVO009-SMOKE';

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
  console.error(`FAIL: ${message}`);
  process.exit(1);
}

async function assertIdentity(queryable: {
  request: () => { query: (q: string) => Promise<{ recordset: Array<Record<string, unknown>> }> };
}) {
  const guard = await queryable.request().query(`SELECT DB_NAME() AS db, SUSER_SNAME() AS login`);
  const db = String(guard.recordset[0]?.db ?? '');
  const login = String(guard.recordset[0]?.login ?? '');
  if (db === PRODUCTION_DB) fail('refusing production last132');
  if (db !== STAGING_DB || login !== STAGING_USER) {
    fail(`expected ${STAGING_DB}/${STAGING_USER}, got ${db}/${login}`);
  }
}

async function main() {
  const password = process.env.DRVO_STAGING_DB_PASSWORD;
  if (!password) fail('DRVO_STAGING_DB_PASSWORD not set');
  forceStagingEnv(password);

  const mssql = await import('mssql');
  const sql = mssql.default;
  const { getPool, closePool, allocateInvID } = await import('../src/lib/db');
  const { runDrvoMigrations } = await import('./drvo/runner');
  const { resolveBootstrapTenantId } = await import('../src/lib/bookingSchedulingComposition');
  const { postSaleCashMove } = await import('../src/apps/treasury/internal/postSaleCashMove');
  const { defaultSaleIdempotencyKey } = await import('../src/apps/treasury/internal/saleCommandFingerprint');
  const { verifyInsCashMoveSalesGuard } = await import('./drvo/migrations/008-ins-cash-move-sales-guard');

  const pool = await getPool();
  try {
    await assertIdentity(pool);
    console.log('PASS: staging DB guard');

    const migrateReport = await runDrvoMigrations(pool, { database: STAGING_DB, appCommitSha: null });
    if (!migrateReport.ok) fail(`migration apply failed: ${migrateReport.failures.join('; ')}`);
    console.log('PASS: DRVO migrations applied/skipped');

    const guard = await verifyInsCashMoveSalesGuard(pool);
    if (!guard.ok) fail(`trigger guard verify: ${guard.failures.join('; ')}`);
    console.log('PASS: InsCashMoveSales coexistence guard present');

    const tenantId = await resolveBootstrapTenantId();
    const ctx = await pool.request().query(`
      SELECT TOP 1
        sm.ID AS shiftId,
        sm.BranchID AS branchId,
        sm.BusinessDayID AS businessDayId,
        nd.NewDay AS invDate,
        sm.UserID AS userId
      FROM dbo.TblShiftMove sm
      INNER JOIN dbo.TblNewDay nd ON nd.ID = sm.BusinessDayID
      WHERE sm.Status = 1
      ORDER BY sm.ID DESC
    `);
    if (!ctx.recordset[0]) fail('no open shift on staging for smoke');
    const shiftId = Number(ctx.recordset[0].shiftId);
    const branchId = Number(ctx.recordset[0].branchId);
    const businessDayId = Number(ctx.recordset[0].businessDayId);
    const invDate = String(ctx.recordset[0].invDate).slice(0, 10);
    const userId = Number(ctx.recordset[0].userId);

    const pmRes = await pool.request().query(`
      SELECT TOP 1 ID FROM dbo.TblPaymentMethods ORDER BY ID
    `);
    const pmId = Number(pmRes.recordset[0]?.ID ?? 1);

    const tx = new sql.Transaction(pool);
    await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
    try {
      // Legacy trigger-only path
      const legacyInv = await allocateInvID(tx, 'TblinvServHead', 'مبيعات', 5000);
      await new sql.Request(tx)
        .input('invID', sql.Int, legacyInv)
        .input('invDate', sql.Date, invDate)
        .input('clientId', sql.Int, 1)
        .input('userId', sql.Int, userId)
        .input('shiftId', sql.Int, shiftId)
        .input('pmId', sql.Int, pmId)
        .input('branchId', sql.Int, branchId)
        .input('businessDayId', sql.Int, businessDayId)
        .query(`
          INSERT INTO dbo.TblinvServHead (
            invID, invType, invDate, invTime, ClientID, UserID,
            TotalQty, SubTotal, Dis, DisVal, Tax, TaxVal, GrandTotal,
            invNotes, TotalBonus, ShiftMoveID,
            ReservDate, ReservTime, Notes,
            PayCash, PayVisa, isActive, Notes2, Payment, PayDue, PaymentMethodID,
            BranchID, BusinessDayID
          ) VALUES (
            @invID, N'مبيعات', @invDate, N'12.00', @clientId, @userId,
            1, 10, 0, 0, 0, 0, 10,
            @MARKER, 0, @shiftId,
            NULL, NULL, @MARKER,
            0, 0, N'no', N'', 10, 0, @pmId,
            @branchId, @businessDayId
          )
        `.replace('@MARKER', `N'${MARKER}-LEGACY'`));

      const legacyCash = await new sql.Request(tx)
        .input('invID', sql.Int, legacyInv)
        .query(`
          SELECT COUNT(*) AS cnt FROM dbo.TblCashMove
          WHERE invID = @invID AND invType = N'مبيعات'
        `);
      if (Number(legacyCash.recordset[0].cnt) !== 1) {
        fail(`legacy path expected 1 CashMove, got ${legacyCash.recordset[0].cnt}`);
      }
      console.log('PASS: legacy trigger-only sale → exactly one CashMove');

      // Treasury pre-post + head insert
      const treasuryInv = await allocateInvID(tx, 'TblinvServHead', 'مبيعات', 5000);
      const invType = 'مبيعات' as const;
      const idempotencyKey = defaultSaleIdempotencyKey(treasuryInv, invType);
      await postSaleCashMove(
        tx,
        { actorType: 'staff', actorId: String(userId), tenantId, membershipId: null, viewLocationId: null },
        {
          tenantId,
          saleInvId: treasuryInv,
          invType,
          invDate,
          invTime: '13.00',
          clientId: 1,
          amount: 12,
          inOut: 'in',
          notes: MARKER,
          shiftMoveId: shiftId,
          paymentMethodId: pmId,
          branchId,
          businessDayId,
          sourceRef: `pos-sale:${treasuryInv}`,
          idempotencyKey,
        },
      );

      await new sql.Request(tx)
        .input('invID', sql.Int, treasuryInv)
        .input('invDate', sql.Date, invDate)
        .input('clientId', sql.Int, 1)
        .input('userId', sql.Int, userId)
        .input('shiftId', sql.Int, shiftId)
        .input('pmId', sql.Int, pmId)
        .input('branchId', sql.Int, branchId)
        .input('businessDayId', sql.Int, businessDayId)
        .query(`
          INSERT INTO dbo.TblinvServHead (
            invID, invType, invDate, invTime, ClientID, UserID,
            TotalQty, SubTotal, Dis, DisVal, Tax, TaxVal, GrandTotal,
            invNotes, TotalBonus, ShiftMoveID,
            ReservDate, ReservTime, Notes,
            PayCash, PayVisa, isActive, Notes2, Payment, PayDue, PaymentMethodID,
            BranchID, BusinessDayID
          ) VALUES (
            @invID, N'مبيعات', @invDate, N'13.00', @clientId, @userId,
            1, 12, 0, 0, 0, 0, 12,
            N'${MARKER}-TREASURY', 0, @shiftId,
            NULL, NULL, N'${MARKER}-TREASURY',
            0, 0, N'no', N'', 12, 0, @pmId,
            @branchId, @businessDayId
          )
        `);

      const treasuryCash = await new sql.Request(tx)
        .input('invID', sql.Int, treasuryInv)
        .query(`
          SELECT COUNT(*) AS cnt FROM dbo.TblCashMove
          WHERE invID = @invID AND invType = N'مبيعات'
        `);
      if (Number(treasuryCash.recordset[0].cnt) !== 1) {
        fail(`treasury path expected 1 CashMove, got ${treasuryCash.recordset[0].cnt}`);
      }

      const registry = await new sql.Request(tx)
        .input('invID', sql.Int, treasuryInv)
        .query(`
          SELECT COUNT(*) AS cnt
          FROM dbo.TreasuryMovementRegistry r
          INNER JOIN dbo.TblCashMove c ON c.ID = r.CashMoveId
          WHERE c.invID = @invID AND r.Kind = N'sale'
        `);
      if (Number(registry.recordset[0].cnt) !== 1) {
        fail('treasury path missing registry sale row');
      }
      console.log('PASS: Treasury pre-post + head insert → exactly one CashMove, trigger skipped');
    } finally {
      await tx.rollback();
      console.log('PASS: smoke transaction rolled back (no durable test rows)');
    }
  } finally {
    await closePool();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack || err.message : err);
  process.exit(1);
});

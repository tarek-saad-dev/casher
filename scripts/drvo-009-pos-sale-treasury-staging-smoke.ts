#!/usr/bin/env npx tsx
/**
 * DRVO-009 staging smoke — last132_agent / drvo_agent only.
 * Proves the InsCashMoveSales coexistence guard inside rolled-back transactions:
 * trigger-only directions, Treasury pre-post skip, same-amount invoices,
 * split redistribution, and post-rollback absence.
 * Also commits a sale-post idempotency conflict and checks the committed
 * state is one CashMove and one registry row, then deletes that marker.
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
  const error = new Error(`FAIL: ${message}`);
  console.error(error.message);
  throw error;
}

type SaleInvType = 'مبيعات' | 'مبيعات بالكارت' | 'م.مبيعات' | 'م.مبيعات بالكارت';

const AUDITED_DIRECTION: Record<SaleInvType, 'in' | 'out'> = {
  مبيعات: 'in',
  'مبيعات بالكارت': 'out',
  'م.مبيعات': 'out',
  'م.مبيعات بالكارت': 'in',
};

async function main() {
  const password = process.env.DRVO_STAGING_DB_PASSWORD;
  if (!password) fail('DRVO_STAGING_DB_PASSWORD not set');
  forceStagingEnv(password);

  const mssql = await import('mssql');
  const sql = mssql.default;
  const { getPool, closePool, allocateInvID } = await import('../src/lib/db');
  const { runDrvoMigrations } = await import('./drvo/runner');
  const { resolveLegacyBootstrapTenantId } = await import('../src/platform/tenant/legacyBootstrapSeam');
  const resolveBootstrapTenantId = () => resolveLegacyBootstrapTenantId('casher-boot-staging-smoke');
  const { insertSaleCashMoveResolvingConflict, postSaleCashMove } = await import(
    '../src/apps/treasury/internal/postSaleCashMove'
  );
  const { TreasuryIdempotencyConflictError } = await import(
    '../src/apps/treasury/internal/idempotencyStore'
  );
  const { defaultSaleIdempotencyKey } = await import('../src/apps/treasury/internal/saleCommandFingerprint');
  const { verifyInsCashMoveSalesGuard } = await import('./drvo/migrations/008-ins-cash-move-sales-guard');
  const { resolveSplitPaymentConfig } = await import('../src/lib/clearingMethod');
  const { redistributeFromClearing } = await import('../src/lib/splitPaymentService');

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

  async function insertHead(
    tx: Tx,
    row: {
      invId: number;
      invType: SaleInvType;
      invDate: string;
      invTime: string;
      clientId: number;
      userId: number;
      shiftId: number;
      paymentMethodId: number;
      branchId: number;
      businessDayId: number;
      amount: number;
      notes: string;
    },
  ) {
    await new sql.Request(tx)
      .input('invID', sql.Int, row.invId)
      .input('invType', sql.NVarChar(20), row.invType)
      .input('invDate', sql.Date, row.invDate)
      .input('invTime', sql.NVarChar(30), row.invTime)
      .input('clientId', sql.Int, row.clientId)
      .input('userId', sql.Int, row.userId)
      .input('shiftId', sql.Int, row.shiftId)
      .input('pmId', sql.Int, row.paymentMethodId)
      .input('branchId', sql.Int, row.branchId)
      .input('businessDayId', sql.Int, row.businessDayId)
      .input('amount', sql.Decimal(10, 2), row.amount)
      .input('notes', sql.NVarChar(100), row.notes)
      .query(`
        INSERT INTO dbo.TblinvServHead (
          invID, invType, invDate, invTime, ClientID, UserID,
          TotalQty, SubTotal, Dis, DisVal, Tax, TaxVal, GrandTotal,
          invNotes, TotalBonus, ShiftMoveID,
          ReservDate, ReservTime, Notes,
          PayCash, PayVisa, isActive, Notes2, Payment, PayDue, PaymentMethodID,
          BranchID, BusinessDayID
        ) VALUES (
          @invID, @invType, @invDate, @invTime, @clientId, @userId,
          1, @amount, 0, 0, 0, 0, @amount,
          @notes, 0, @shiftId,
          NULL, NULL, @notes,
          0, 0, N'no', N'', @amount, 0, @pmId,
          @branchId, @businessDayId
        )
      `);
  }

  async function saleCashMoves(queryable: Tx | sql.ConnectionPool, invId: number, invType: string) {
    const res = await new sql.Request(queryable)
      .input('invID', sql.Int, invId)
      .input('invType', sql.NVarChar(20), invType)
      .query(`
        SELECT ID, inOut, PaymentMethodID, GrandTolal
        FROM dbo.TblCashMove
        WHERE invID = @invID AND invType = @invType
      `);
    return res.recordset as Array<{
      ID: number;
      inOut: string;
      PaymentMethodID: number;
      GrandTolal: number;
    }>;
  }

  function expectOneDirection(
    rows: Array<{ ID: number; inOut: string }>,
    expected: 'in' | 'out',
    label: string,
  ) {
    if (rows.length !== 1) fail(`${label} expected 1 CashMove, got ${rows.length}`);
    const actual = String(rows[0].inOut).trim().toLowerCase();
    if (actual !== expected) fail(`${label} expected inOut=${expected}, got ${actual}`);
    return Number(rows[0].ID);
  }

  const pool = await getPool();
  const touched: Array<{ invId: number; invType: SaleInvType; sourceRef: string | null }> = [];
  try {
    await assertIdentity(pool);
    console.log('PASS: staging DB guard');

    const migrateReport = await runDrvoMigrations(pool, {
      allowProduction: false,
      expectedDatabase: STAGING_DB,
      appCommitSha: null,
    });
    if (!migrateReport.ok) fail(`migration apply failed: ${migrateReport.failures.join('; ')}`);
    console.log(
      `PASS: DRVO migrations applied=${migrateReport.applied.join(',') || 'none'} skipped=${migrateReport.skipped.join(',') || 'none'}`,
    );

    const guard = await verifyInsCashMoveSalesGuard(pool);
    if (!guard.ok) fail(`trigger guard verify: ${guard.failures.join('; ')}`);
    console.log('PASS: InsCashMoveSales guard directions and coexistence check');

    const triggerState = await pool.request().query(`
      SELECT is_disabled AS disabled
      FROM sys.triggers
      WHERE name = N'InsCashMoveSales'
    `);
    if (Number(triggerState.recordset[0]?.disabled) !== 0) {
      fail('InsCashMoveSales is missing or disabled');
    }
    console.log('PASS: InsCashMoveSales trigger remains enabled');

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

    const splitCfg = await resolveSplitPaymentConfig(pool);
    const pmRes = await pool
      .request()
      .input('clearing', sql.Int, splitCfg.clearingMethodId)
      .query(`
        SELECT TOP 2 PaymentID AS paymentMethodId
        FROM dbo.TblPaymentMethods
        WHERE PaymentID <> @clearing
        ORDER BY PaymentID
      `);
    const paymentMethodIds = pmRes.recordset.map((row) => Number(row.paymentMethodId));
    if (paymentMethodIds.length < 2) fail('need two non-clearing payment methods for split smoke');
    const pmId = paymentMethodIds[0];

    const actor = {
      actorType: 'staff' as const,
      actorId: String(userId),
      tenantId,
      membershipId: null,
      viewLocationId: null,
    };

    const tx = new sql.Transaction(pool);
    await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
    let scenarioError: unknown = null;
    try {
      await assertIdentity(tx);

      for (const invType of Object.keys(AUDITED_DIRECTION) as SaleInvType[]) {
        const invId = await allocateInvID(tx, 'TblinvServHead', invType, 5000);
        const amount = 10;
        await insertHead(tx, {
          invId,
          invType,
          invDate,
          invTime: '12.00',
          clientId: 1,
          userId,
          shiftId,
          paymentMethodId: pmId,
          branchId,
          businessDayId,
          amount,
          notes: `${MARKER}-DIR-${invType}`,
        });
        const rows = await saleCashMoves(tx, invId, invType);
        expectOneDirection(rows, AUDITED_DIRECTION[invType], `trigger ${invType}`);
        touched.push({ invId, invType, sourceRef: null });
      }
      console.log('PASS: trigger-only sale, card, and both return directions');

      const twinIds: number[] = [];
      for (const suffix of ['A', 'B']) {
        const invId = await allocateInvID(tx, 'TblinvServHead', 'مبيعات', 5000);
        await insertHead(tx, {
          invId,
          invType: 'مبيعات',
          invDate,
          invTime: '12.10',
          clientId: 1,
          userId,
          shiftId,
          paymentMethodId: pmId,
          branchId,
          businessDayId,
          amount: 18,
          notes: `${MARKER}-TWIN-${suffix}`,
        });
        const rows = await saleCashMoves(tx, invId, 'مبيعات');
        twinIds.push(expectOneDirection(rows, 'in', `same-amount invoice ${suffix}`));
        touched.push({ invId, invType: 'مبيعات', sourceRef: null });
      }
      if (twinIds[0] === twinIds[1]) fail('same-amount invoices shared one CashMove');
      console.log('PASS: two same-amount invoices each received their own CashMove');

      const treasuryInv = await allocateInvID(tx, 'TblinvServHead', 'مبيعات', 5000);
      const treasurySource = `pos-sale:${treasuryInv}`;
      await postSaleCashMove(tx, actor, {
        tenantId,
        saleInvId: treasuryInv,
        invType: 'مبيعات',
        invDate,
        invTime: '13.00',
        clientId: 1,
        amount: 12,
        inOut: 'in',
        notes: `${MARKER}-TREASURY`,
        shiftMoveId: shiftId,
        paymentMethodId: pmId,
        branchId,
        businessDayId,
        sourceRef: treasurySource,
        idempotencyKey: defaultSaleIdempotencyKey(treasuryInv, 'مبيعات'),
      });
      await insertHead(tx, {
        invId: treasuryInv,
        invType: 'مبيعات',
        invDate,
        invTime: '13.00',
        clientId: 1,
        userId,
        shiftId,
        paymentMethodId: pmId,
        branchId,
        businessDayId,
        amount: 12,
        notes: `${MARKER}-TREASURY`,
      });
      expectOneDirection(await saleCashMoves(tx, treasuryInv, 'مبيعات'), 'in', 'treasury cash sale');
      const registry = await new sql.Request(tx)
        .input('sourceRef', sql.NVarChar(200), treasurySource)
        .query(`
          SELECT COUNT(*) AS cnt
          FROM dbo.TreasuryMovementRegistry
          WHERE Kind = N'sale' AND SourceRef = @sourceRef
        `);
      if (Number(registry.recordset[0].cnt) !== 1) fail('treasury path missing registry sale row');
      touched.push({ invId: treasuryInv, invType: 'مبيعات', sourceRef: treasurySource });
      console.log('PASS: Treasury pre-post + head insert → exactly one CashMove, trigger skipped');

      const cardInv = await allocateInvID(tx, 'TblinvServHead', 'مبيعات بالكارت', 5000);
      const cardSource = `pos-sale:${cardInv}:card`;
      await postSaleCashMove(tx, actor, {
        tenantId,
        saleInvId: cardInv,
        invType: 'مبيعات بالكارت',
        invDate,
        invTime: '13.10',
        clientId: 1,
        amount: 12,
        inOut: 'out',
        notes: `${MARKER}-TREASURY-CARD`,
        shiftMoveId: shiftId,
        paymentMethodId: pmId,
        branchId,
        businessDayId,
        sourceRef: cardSource,
        idempotencyKey: defaultSaleIdempotencyKey(cardInv, 'مبيعات بالكارت'),
      });
      await insertHead(tx, {
        invId: cardInv,
        invType: 'مبيعات بالكارت',
        invDate,
        invTime: '13.10',
        clientId: 1,
        userId,
        shiftId,
        paymentMethodId: pmId,
        branchId,
        businessDayId,
        amount: 12,
        notes: `${MARKER}-TREASURY-CARD`,
      });
      expectOneDirection(
        await saleCashMoves(tx, cardInv, 'مبيعات بالكارت'),
        'out',
        'treasury card sale',
      );
      touched.push({ invId: cardInv, invType: 'مبيعات بالكارت', sourceRef: cardSource });
      console.log('PASS: Treasury card pre-post kept inOut=out and trigger did not add a row');

      const comboInv = await allocateInvID(tx, 'TblinvServHead', 'مبيعات', 5000);
      const comboAmount = 15;
      const comboSource = `pos-sale:${comboInv}`;
      await postSaleCashMove(tx, actor, {
        tenantId,
        saleInvId: comboInv,
        invType: 'مبيعات',
        invDate,
        invTime: '13.15',
        clientId: 1,
        amount: comboAmount,
        inOut: 'in',
        notes: `${MARKER}-COMBO-SPLIT`,
        shiftMoveId: shiftId,
        paymentMethodId: splitCfg.clearingMethodId,
        branchId,
        businessDayId,
        sourceRef: comboSource,
        idempotencyKey: defaultSaleIdempotencyKey(comboInv, 'مبيعات'),
      });
      await insertHead(tx, {
        invId: comboInv,
        invType: 'مبيعات',
        invDate,
        invTime: '13.15',
        clientId: 1,
        userId,
        shiftId,
        paymentMethodId: splitCfg.clearingMethodId,
        branchId,
        businessDayId,
        amount: comboAmount,
        notes: `${MARKER}-COMBO-SPLIT`,
      });
      const comboAfterHead = await saleCashMoves(tx, comboInv, 'مبيعات');
      expectOneDirection(comboAfterHead, 'in', 'combo treasury+split after head insert');
      if (Number(comboAfterHead[0].PaymentMethodID) !== splitCfg.clearingMethodId) {
        fail('combo initial CashMove was not posted on the clearing method');
      }
      const comboRegistry = await new sql.Request(tx)
        .input('sourceRef', sql.NVarChar(200), comboSource)
        .query(`
          SELECT COUNT(*) AS cnt
          FROM dbo.TreasuryMovementRegistry
          WHERE Kind = N'sale' AND SourceRef = @sourceRef
        `);
      if (Number(comboRegistry.recordset[0].cnt) !== 1) {
        fail('combo treasury+split missing registry sale row');
      }
      await redistributeFromClearing({
        transaction: tx,
        branchId,
        businessDayId,
        clearingMethodId: splitCfg.clearingMethodId,
        allocations: [
          { paymentMethodId: paymentMethodIds[0], amount: 9 },
          { paymentMethodId: paymentMethodIds[1], amount: 6 },
        ],
        invDate,
        invTime: '13.15',
        clientId: 1,
        shiftMoveId: shiftId,
        invoiceId: comboInv,
        expenseCatId: splitCfg.expenseCatId,
        incomeCatId: splitCfg.incomeCatId,
      });
      const comboFinalSale = await saleCashMoves(tx, comboInv, 'مبيعات');
      expectOneDirection(comboFinalSale, 'in', 'combo treasury+split after redistribution');
      if (Number(comboFinalSale[0].PaymentMethodID) !== splitCfg.clearingMethodId) {
        fail('combo initial sale CashMove moved off clearing method');
      }
      const comboTransfers = await new sql.Request(tx)
        .input('needle', sql.NVarChar(80), `فاتورة ${comboInv}`)
        .query(`
          SELECT invType, inOut, COUNT(*) AS cnt
          FROM dbo.TblCashMove
          WHERE Notes LIKE N'%' + @needle + N'%'
          GROUP BY invType, inOut
        `);
      const comboTransferMap = new Map(
        comboTransfers.recordset.map((row) => [
          `${row.invType}|${String(row.inOut).trim().toLowerCase()}`,
          Number(row.cnt),
        ]),
      );
      if (
        comboTransferMap.get('مصروفات|out') !== 2 ||
        comboTransferMap.get('ايرادات|in') !== 2
      ) {
        fail(
          `combo treasury+split expected 2 out + 2 in transfer rows, got ${JSON.stringify([...comboTransferMap])}`,
        );
      }
      touched.push({ invId: comboInv, invType: 'مبيعات', sourceRef: comboSource });
      console.log(
        'PASS: Treasury pre-post on clearing + head insert + split redistribution → one initial sale CashMove, one registry row, two transfer pairs',
      );

      const splitInv = await allocateInvID(tx, 'TblinvServHead', 'مبيعات', 5000);
      const splitAmount = 10;
      await insertHead(tx, {
        invId: splitInv,
        invType: 'مبيعات',
        invDate,
        invTime: '13.20',
        clientId: 1,
        userId,
        shiftId,
        paymentMethodId: splitCfg.clearingMethodId,
        branchId,
        businessDayId,
        amount: splitAmount,
        notes: `${MARKER}-SPLIT`,
      });
      const initial = await saleCashMoves(tx, splitInv, 'مبيعات');
      expectOneDirection(initial, 'in', 'split initial CashMove');
      if (Number(initial[0].PaymentMethodID) !== splitCfg.clearingMethodId) {
        fail('split initial CashMove was not posted on the clearing method');
      }
      await redistributeFromClearing({
        transaction: tx,
        branchId,
        businessDayId,
        clearingMethodId: splitCfg.clearingMethodId,
        allocations: [
          { paymentMethodId: paymentMethodIds[0], amount: 6 },
          { paymentMethodId: paymentMethodIds[1], amount: 4 },
        ],
        invDate,
        invTime: '13.20',
        clientId: 1,
        shiftMoveId: shiftId,
        invoiceId: splitInv,
        expenseCatId: splitCfg.expenseCatId,
        incomeCatId: splitCfg.incomeCatId,
      });
      const stillOne = await saleCashMoves(tx, splitInv, 'مبيعات');
      expectOneDirection(stillOne, 'in', 'split sale CashMove after redistribution');
      const transfers = await new sql.Request(tx)
        .input('needle', sql.NVarChar(80), `فاتورة ${splitInv}`)
        .query(`
          SELECT invType, inOut, COUNT(*) AS cnt
          FROM dbo.TblCashMove
          WHERE Notes LIKE N'%' + @needle + N'%'
          GROUP BY invType, inOut
        `);
      const transferMap = new Map(
        transfers.recordset.map((row) => [`${row.invType}|${String(row.inOut).trim().toLowerCase()}`, Number(row.cnt)]),
      );
      if (transferMap.get('مصروفات|out') !== 2 || transferMap.get('ايرادات|in') !== 2) {
        fail(`split redistribution expected 2 out + 2 in transfer rows, got ${JSON.stringify([...transferMap])}`);
      }
      touched.push({ invId: splitInv, invType: 'مبيعات', sourceRef: null });
      console.log('PASS: split payment kept one initial CashMove plus two transfer pairs');
    } catch (err) {
      scenarioError = err;
      const info = err as { message?: string; number?: number; precedingErrors?: Array<{ message?: string }> };
      const preceding = (info.precedingErrors ?? [])
        .map((item) => item.message)
        .filter(Boolean)
        .join(' | ');
      console.error(`SCENARIO_ERROR: ${info.message ?? err}${preceding ? ` | preceding: ${preceding}` : ''}`);
    } finally {
      try {
        await tx.rollback();
        console.log('PASS: smoke transaction rolled back');
      } catch (rollbackErr) {
        console.error(
          `ROLLBACK_NOTE: ${rollbackErr instanceof Error ? rollbackErr.message : rollbackErr}`,
        );
      }
    }
    if (scenarioError) throw scenarioError;

    const markerRows = await pool
      .request()
      .input('marker', sql.NVarChar(40), `${MARKER}%`)
      .query(`
        SELECT
          (SELECT COUNT(*) FROM dbo.TblinvServHead WHERE invNotes LIKE @marker OR Notes LIKE @marker) AS heads,
          (SELECT COUNT(*) FROM dbo.TblCashMove WHERE Notes LIKE @marker) AS cashMoves
      `);
    if (Number(markerRows.recordset[0].heads) !== 0 || Number(markerRows.recordset[0].cashMoves) !== 0) {
      fail(
        `rollback left marker rows heads=${markerRows.recordset[0].heads} cashMoves=${markerRows.recordset[0].cashMoves}`,
      );
    }

    for (const row of touched) {
      const head = await pool
        .request()
        .input('invID', sql.Int, row.invId)
        .input('invType', sql.NVarChar(20), row.invType)
        .input('marker', sql.NVarChar(80), `${MARKER}%`)
        .query(`
          SELECT COUNT(*) AS cnt
          FROM dbo.TblinvServHead
          WHERE invID = @invID AND invType = @invType
            AND (invNotes LIKE @marker OR Notes LIKE @marker)
        `);
      if (Number(head.recordset[0].cnt) !== 0) {
        fail(`rollback left invoice ${row.invType} ${row.invId}`);
      }
      const cash = await pool
        .request()
        .input('invID', sql.Int, row.invId)
        .input('invType', sql.NVarChar(20), row.invType)
        .input('marker', sql.NVarChar(80), `${MARKER}%`)
        .query(`
          SELECT COUNT(*) AS cnt
          FROM dbo.TblCashMove
          WHERE invID = @invID AND invType = @invType AND Notes LIKE @marker
        `);
      if (Number(cash.recordset[0].cnt) !== 0) {
        fail(`rollback left CashMove for ${row.invType} ${row.invId}`);
      }
      if (row.sourceRef) {
        const registry = await pool
          .request()
          .input('sourceRef', sql.NVarChar(200), row.sourceRef)
          .query(`
            SELECT COUNT(*) AS cnt
            FROM dbo.TreasuryMovementRegistry
            WHERE SourceRef = @sourceRef
          `);
        if (Number(registry.recordset[0].cnt) !== 0) {
          fail(`rollback left Treasury registry row ${row.sourceRef}`);
        }
      }
      const transfers = await pool
        .request()
        .input('needle', sql.NVarChar(80), `تسوية فاتورة ${row.invId} -`)
        .query(`
          SELECT COUNT(*) AS cnt
          FROM dbo.TblCashMove
          WHERE Notes LIKE N'%' + @needle + N'%'
        `);
      if (Number(transfers.recordset[0].cnt) !== 0) {
        fail(`rollback left split transfer rows for invoice ${row.invId}`);
      }
    }
    console.log('PASS: rollback left no invoice, Treasury CashMove, or registry row');

    const stillEnabled = await pool.request().query(`
      SELECT is_disabled AS disabled
      FROM sys.triggers
      WHERE name = N'InsCashMoveSales'
    `);
    if (Number(stillEnabled.recordset[0]?.disabled) !== 0) {
      fail('InsCashMoveSales disabled after smoke');
    }
    console.log('PASS: InsCashMoveSales still enabled after rollback');

    async function proveCommittedRegistryConflict() {
      const alloc = new sql.Transaction(pool);
      await alloc.begin();
      let invId = 0;
      try {
        await assertIdentity(alloc);
        invId = await allocateInvID(alloc, 'TblinvServHead', 'مبيعات', 5000);
        await alloc.commit();
      } catch (err) {
        try {
          await alloc.rollback();
        } catch {
          /* allocation transaction already closed */
        }
        throw err;
      }

      const idempotencyKey = `drvo009-race:${invId}`;
      const notes = `${MARKER}-RACE`;
      const command = {
        tenantId,
        saleInvId: invId,
        invType: 'مبيعات' as const,
        invDate,
        invTime: '14.40',
        clientId: 1,
        amount: 21,
        inOut: 'in' as const,
        notes,
        shiftMoveId: shiftId,
        paymentMethodId: pmId,
        branchId,
        businessDayId,
        sourceRef: idempotencyKey,
        idempotencyKey,
      };

      async function committedCounts() {
        const counts = await pool
          .request()
          .input('invID', sql.Int, invId)
          .input('invType', sql.NVarChar(20), command.invType)
          .input('key', sql.NVarChar(256), idempotencyKey)
          .query(`
            SELECT
              (SELECT COUNT(*) FROM dbo.TblCashMove WHERE invID = @invID AND invType = @invType) AS cashMoves,
              (SELECT COUNT(*) FROM dbo.TreasuryMovementRegistry WHERE IdempotencyKey = @key AND Kind = N'sale') AS registry
          `);
        return {
          cashMoves: Number(counts.recordset[0].cashMoves),
          registry: Number(counts.recordset[0].registry),
        };
      }

      let proofError: unknown = null;
      try {
        async function postCommitted() {
          const local = new sql.Transaction(pool);
          await local.begin();
          try {
            await assertIdentity(local);
            const id = await postSaleCashMove(local, actor, command);
            await local.commit();
            return id;
          } catch (err) {
            try {
              await local.rollback();
            } catch {
              /* transaction already closed */
            }
            throw err;
          }
        }

        const [firstId, secondId] = await Promise.all([postCommitted(), postCommitted()]);
        if (firstId !== secondId) {
          fail(`concurrent sale post returned two CashMove ids ${firstId} and ${secondId}`);
        }
        let counts = await committedCounts();
        if (counts.cashMoves !== 1 || counts.registry !== 1) {
          fail(
            `concurrent sale post committed cashMoves=${counts.cashMoves} registry=${counts.registry}`,
          );
        }
        console.log('PASS: concurrent same-key sale post committed one CashMove and one registry row');

        const conflictTx = new sql.Transaction(pool);
        await conflictTx.begin();
        try {
          await assertIdentity(conflictTx);
          const replayed = await insertSaleCashMoveResolvingConflict(conflictTx, command);
          if (replayed !== firstId) {
            fail(`unique-conflict replay returned ${replayed}, expected ${firstId}`);
          }
          expectOneDirection(
            await saleCashMoves(conflictTx, invId, command.invType),
            'in',
            'in-transaction unique conflict',
          );
          await conflictTx.commit();
        } catch (err) {
          try {
            await conflictTx.rollback();
          } catch {
            /* conflict transaction already closed */
          }
          throw err;
        }
        counts = await committedCounts();
        if (counts.cashMoves !== 1 || counts.registry !== 1) {
          fail(
            `unique-conflict commit left cashMoves=${counts.cashMoves} registry=${counts.registry}`,
          );
        }
        console.log('PASS: registry unique conflict rolled the extra CashMove back before commit');

        const mismatchTx = new sql.Transaction(pool);
        await mismatchTx.begin();
        try {
          await assertIdentity(mismatchTx);
          let sawConflict = false;
          try {
            await insertSaleCashMoveResolvingConflict(mismatchTx, {
              ...command,
              amount: command.amount + 4,
            });
          } catch (err) {
            if (!(err instanceof TreasuryIdempotencyConflictError)) throw err;
            sawConflict = true;
          }
          if (!sawConflict) fail('mismatched sale fingerprint was accepted');
          const stillOne = await saleCashMoves(mismatchTx, invId, command.invType);
          expectOneDirection(stillOne, 'in', 'after mismatched fingerprint');
          if (Number(stillOne[0].ID) !== firstId) {
            fail('mismatched fingerprint replaced the original CashMove');
          }
          await mismatchTx.commit();
        } catch (err) {
          try {
            await mismatchTx.rollback();
          } catch {
            /* mismatch transaction already closed */
          }
          throw err;
        }
        counts = await committedCounts();
        if (counts.cashMoves !== 1 || counts.registry !== 1) {
          fail(
            `mismatched fingerprint commit left cashMoves=${counts.cashMoves} registry=${counts.registry}`,
          );
        }
        console.log('PASS: mismatched fingerprint failed without an orphan CashMove');

        const replayTx = new sql.Transaction(pool);
        await replayTx.begin();
        try {
          await assertIdentity(replayTx);
          const replayed = await postSaleCashMove(replayTx, actor, command);
          if (replayed !== firstId) fail(`same-command replay returned ${replayed}, expected ${firstId}`);
          await replayTx.rollback();
        } catch (err) {
          try {
            await replayTx.rollback();
          } catch {
            /* replay transaction already closed */
          }
          throw err;
        }
        console.log('PASS: same-command replay returned the existing CashMoveId');
      } catch (err) {
        proofError = err;
      } finally {
        try {
          const cleanup = new sql.Transaction(pool);
          await cleanup.begin();
          try {
            await assertIdentity(cleanup);
            await new sql.Request(cleanup)
              .input('tenantId', sql.UniqueIdentifier, tenantId)
              .input('key', sql.NVarChar(256), idempotencyKey)
              .input('outboxKey', sql.NVarChar(256), `treasury.sale.posted:${idempotencyKey}`)
              .input('invID', sql.Int, invId)
              .input('invType', sql.NVarChar(20), command.invType)
              .query(`
                DELETE FROM dbo.PlatformOutbox
                WHERE TenantId = @tenantId AND IdempotencyKey = @outboxKey;
                DELETE FROM dbo.TreasuryMovementRegistry
                WHERE TenantId = @tenantId AND IdempotencyKey = @key;
                DELETE FROM dbo.TblCashMove
                WHERE invID = @invID AND invType = @invType;
              `);
            await cleanup.commit();
          } catch (err) {
            try {
              await cleanup.rollback();
            } catch {
              /* cleanup transaction already closed */
            }
            throw err;
          }
          const left = await committedCounts();
          if (left.cashMoves !== 0 || left.registry !== 0) {
            fail(`race marker cleanup left cashMoves=${left.cashMoves} registry=${left.registry}`);
          }
          console.log('PASS: committed race marker removed from staging');
        } catch (cleanupErr) {
          if (!proofError) proofError = cleanupErr;
          else console.error(cleanupErr instanceof Error ? cleanupErr.message : cleanupErr);
        }
      }
      if (proofError) throw proofError;
    }

    await proveCommittedRegistryConflict();
  } finally {
    await closePool();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack || err.message : err);
  process.exit(1);
});

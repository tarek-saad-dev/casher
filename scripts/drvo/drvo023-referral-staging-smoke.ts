#!/usr/bin/env npx tsx
/**
 * DRVO-023 tenant-safe referral migration staging smoke.
 * Runs ONLY with the dedicated last132_agent / drvo_agent staging tunnel.
 * All synthetic code/claim/voucher rows live in rolled-back SQL transactions.
 * NEVER points at production; never touches customer purchases or money.
 */
import { randomUUID } from 'node:crypto';
import sql, { type Transaction } from 'mssql';
import { referralDiscountMigration, verifyReferralDiscountSchema } from './migrations/023-referral-discounts';
import { generateReferralCustomerCode } from '../../src/lib/referrals/referralPreviewPolicy';

const DATABASE = 'last132_agent';
const LOGIN = 'drvo_agent';
const PORT = 14330;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error('DRVO-023 STAGING FAIL: ' + message);
}

type TenantAndClients = { tenantId: string; ownerId: number; referredId: number };
async function selectFixture(pool: sql.ConnectionPool): Promise<TenantAndClients> {
  // Select existing tenant clients only. Synthetic data is added in a rollback
  // transaction; no modification to customer fields, invoices, or payment rows.
  const tenant = await pool.request().query(`
    SELECT TOP (1) c.TenantId
    FROM dbo.TblClient c
    WHERE NOT EXISTS (
      SELECT 1 FROM dbo.TblReferralCustomerCode rc
      WHERE rc.TenantId = c.TenantId AND rc.ReferrerClientID = c.ClientID
    ) AND NOT EXISTS (
      SELECT 1 FROM dbo.TblReferralVisitClaim claim
      WHERE claim.TenantId = c.TenantId AND claim.ReferredClientID = c.ClientID
    )
    GROUP BY c.TenantId
    HAVING COUNT(*) >= 2
    ORDER BY COUNT(*) DESC;
  `);
  const tenantId = tenant.recordset[0]?.TenantId as string | undefined;
  assert(tenantId, 'No staging tenant has two eligible fixture clients (test requires two)');
  const clients = await pool.request().input('tenantId', sql.UniqueIdentifier, tenantId).query(`
    SELECT TOP (2) c.ClientID
    FROM dbo.TblClient c
    WHERE c.TenantId = @tenantId
      AND NOT EXISTS (
        SELECT 1 FROM dbo.TblReferralCustomerCode rc
        WHERE rc.TenantId = c.TenantId AND rc.ReferrerClientID = c.ClientID
      ) AND NOT EXISTS (
        SELECT 1 FROM dbo.TblReferralVisitClaim claim
        WHERE claim.TenantId = c.TenantId AND claim.ReferredClientID = c.ClientID
      )
    ORDER BY c.ClientID;
  `);
  assert(clients.recordset.length === 2, 'Fixture clients disappeared during selection');
  return {
    tenantId: String(tenantId),
    ownerId: Number(clients.recordset[0].ClientID),
    referredId: Number(clients.recordset[1].ClientID),
  };
}

function dbRequest(tx: Transaction, fixture: TenantAndClients, code: string) {
  return new sql.Request(tx)
    .input('tenantId', sql.UniqueIdentifier, fixture.tenantId)
    .input('ownerId', sql.Int, fixture.ownerId)
    .input('referredId', sql.Int, fixture.referredId)
    .input('code', sql.NVarChar(32), code);
}

async function expectSqlError(tx: Transaction, fixture: TenantAndClients, code: string,
  statement: string, allowed: number[], description: string): Promise<void> {
  const result = await dbRequest(tx, fixture, code).query(`
    SET XACT_ABORT OFF;
    DECLARE @errorNumber INT = 0;
    BEGIN TRY
      ${statement}
    END TRY
    BEGIN CATCH
      SET @errorNumber = ERROR_NUMBER();
    END CATCH
    SELECT @errorNumber AS ErrorNumber;
  `);
  assert(allowed.includes(Number(result.recordset[0]?.ErrorNumber)),
    description + ' expected SQL error ' + allowed.join('/') +
      ' but got ' + String(result.recordset[0]?.ErrorNumber));
}

async function rollbackQuietly(tx: Transaction, label: string) {
  try { await tx.rollback(); } catch (e) {
    console.warn(label + ' rollback failed:', e instanceof Error ? e.name : 'unknown');
  }
}

async function run() {
  const password = process.env.DRVO_STAGING_DB_PASSWORD;
  assert(password, 'Missing dedicated staging DB password');
  // Refuse all env-based server, database or login substitutions.
  const pool = new sql.ConnectionPool({
    server: '127.0.0.1',
    port: PORT,
    database: DATABASE,
    user: LOGIN,
    password,
    options: { encrypt: false, trustServerCertificate: true, enableArithAbort: true },
    connectionTimeout: 15000,
    requestTimeout: 30000,
    pool: { max: 5, min: 0, idleTimeoutMillis: 10000 },
  });
  await pool.connect();
  try {
    const who = await pool.request().query('SELECT DB_NAME() AS DbName, SUSER_SNAME() AS LoginName');
    assert(who.recordset[0]?.DbName === DATABASE &&
      String(who.recordset[0]?.LoginName).toLowerCase() === LOGIN,
    'Database or SQL login identity mismatch: refusing mutation');
    console.log('DRVO-023 staging identity checked');

    const checked = await verifyReferralDiscountSchema(pool);
    assert(checked.ok, 'Schema verification: ' + checked.failures.join('; '));
    const registry = await pool.request().query(`
      SELECT MigrationKey, Checksum
      FROM dbo.DrvoSchemaMigration WHERE MigrationId = 23;
    `);
    assert(registry.recordset.length === 1 &&
      registry.recordset[0].MigrationKey === referralDiscountMigration.migrationKey &&
      String(registry.recordset[0].Checksum).toLowerCase() === referralDiscountMigration.checksum.toLowerCase(),
    'DRVO migration 023 ledger/checksum mismatch');
    console.log('DRVO-023 registry, constraints, unique indexes and FKs verified');

    const fixture = await selectFixture(pool);
    const code = generateReferralCustomerCode();
    const tx = new sql.Transaction(pool);
    await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
    try {
      const created = await dbRequest(tx, fixture, code).query(`
        SET XACT_ABORT OFF;
        INSERT INTO dbo.TblReferralCustomerCode (TenantId, ReferrerClientID, Code)
        OUTPUT INSERTED.ReferralCodeID
        VALUES (@tenantId, @ownerId, @code);
      `);
      const codeId = Number(created.recordset[0]?.ReferralCodeID);
      assert(Number.isSafeInteger(codeId) && codeId > 0, 'Failed to create rolled-back code fixture');

      await expectSqlError(tx, fixture, code, `
        INSERT INTO dbo.TblReferralCustomerCode (TenantId, ReferrerClientID, Code)
        VALUES (@tenantId, @referredId, @code);
      `, [2601, 2627], 'Duplicate code');

      await expectSqlError(tx, fixture, code, `
        INSERT INTO dbo.TblReferralCustomerCode (TenantId, ReferrerClientID, Code)
        VALUES (@tenantId, @ownerId, N'CUT-000000000000000000000001');
      `, [2601, 2627], 'Duplicate referrer');

      const claim = await dbRequest(tx, fixture, code).input('codeId', sql.BigInt, codeId).query(`
        INSERT INTO dbo.TblReferralVisitClaim
          (TenantId, ReferralCodeID, ReferrerClientID, ReferredClientID)
        OUTPUT INSERTED.ClaimID
        VALUES (@tenantId, @codeId, @ownerId, @referredId);
      `);
      const claimId = Number(claim.recordset[0]?.ClaimID);
      assert(Number.isSafeInteger(claimId) && claimId > 0, 'Failed to create rolled-back claim fixture');

      // Prevent repeat claims, including a second claim for the same invited customer.
      await expectSqlError(tx, fixture, code, `
        INSERT INTO dbo.TblReferralVisitClaim
          (TenantId, ReferralCodeID, ReferrerClientID, ReferredClientID)
        VALUES (
          @tenantId,
          (SELECT ReferralCodeID FROM dbo.TblReferralCustomerCode
           WHERE TenantId = @tenantId AND Code = @code),
          @ownerId, @referredId
        );
      `, [2601, 2627], 'Repeated referral claim');

      await expectSqlError(tx, fixture, code, `
        INSERT INTO dbo.TblReferralVisitClaim
          (TenantId, ReferralCodeID, ReferrerClientID, ReferredClientID)
        VALUES (
          @tenantId,
          (SELECT ReferralCodeID FROM dbo.TblReferralCustomerCode
           WHERE TenantId = @tenantId AND Code = @code),
          @ownerId, @ownerId
        );
      `, [547], 'Self referral check');

      // A tenant-consistent compound FK must reject an unowned code/claim.
      await expectSqlError(tx, fixture, code, `
        INSERT INTO dbo.TblReferralVisitClaim
          (TenantId, ReferralCodeID, ReferrerClientID, ReferredClientID)
        VALUES (
          NEWID(),
          (SELECT ReferralCodeID FROM dbo.TblReferralCustomerCode
           WHERE TenantId = @tenantId AND Code = @code),
          @ownerId, @referredId
        );
      `, [547], 'Cross tenant foreign key');

      await dbRequest(tx, fixture, code).input('claimId', sql.BigInt, claimId).query(`
        UPDATE dbo.TblReferralVisitClaim
        SET Status=N'APPLIED', FirstPaidInvID=2147483000, FirstPaidInvType=N'مبيعات'
        WHERE TenantId=@tenantId AND ClaimID=@claimId;
        INSERT INTO dbo.TblReferralDiscountVoucher
          (TenantId, ClaimID, ReferrerClientID)
        VALUES (@tenantId, @claimId, @ownerId);
      `);
      await expectSqlError(tx, fixture, code, `
        INSERT INTO dbo.TblReferralDiscountVoucher
          (TenantId, ClaimID, ReferrerClientID)
        VALUES (
          @tenantId,
          (SELECT ClaimID FROM dbo.TblReferralVisitClaim
           WHERE TenantId=@tenantId AND ReferredClientID=@referredId),
          @ownerId
        );
      `, [2601, 2627], 'Duplicate 20% reward voucher');

      await expectSqlError(tx, fixture, code, `
        INSERT INTO dbo.TblReferralDiscountVoucher
          (TenantId, ClaimID, ReferrerClientID, DiscountPercent)
        VALUES (
          @tenantId,
          (SELECT ClaimID FROM dbo.TblReferralVisitClaim
           WHERE TenantId=@tenantId AND ReferredClientID=@referredId),
          @ownerId, 25
        );
      `, [547, 2601, 2627], 'Non-20-percent voucher');
      console.log('DRVO-023 rolled-back SQL constraints: duplicate code, repeat claim, self-referral, cross tenant, reward uniqueness PASS');
    } finally {
      await rollbackQuietly(tx, 'Fixture transaction');
    }

    const after = await pool.request()
      .input('tenantId', sql.UniqueIdentifier, fixture.tenantId)
      .input('code', sql.NVarChar(32), code)
      .query('SELECT COUNT(*) AS Cnt FROM dbo.TblReferralCustomerCode WHERE TenantId=@tenantId AND Code=@code;');
    assert(Number(after.recordset[0]?.Cnt) === 0, 'Fixture rows remain after rollback');

    // Two independent real DB sessions attempt code issuance for the same
    // tenant+referrer. The second must block on the unique-owner key until the
    // first rolls back. No client fields or sale tables are mutated.
    const concurrentCode = generateReferralCustomerCode();
    const a = new sql.Transaction(pool);
    await a.begin(sql.ISOLATION_LEVEL.READ_COMMITTED);
    try {
      await dbRequest(a, fixture, concurrentCode).query(`
        INSERT INTO dbo.TblReferralCustomerCode (TenantId, ReferrerClientID, Code)
        VALUES (@tenantId, @ownerId, @code);
      `);
      const b = new sql.Transaction(pool);
      await b.begin(sql.ISOLATION_LEVEL.READ_COMMITTED);
      try {
        const r = await dbRequest(b, fixture, generateReferralCustomerCode()).query(`
          SET LOCK_TIMEOUT 2000;
          DECLARE @errorNumber INT = 0;
          BEGIN TRY
            INSERT INTO dbo.TblReferralCustomerCode (TenantId, ReferrerClientID, Code)
            VALUES (@tenantId, @ownerId, @code);
          END TRY
          BEGIN CATCH
            SET @errorNumber = ERROR_NUMBER();
          END CATCH;
          SELECT @errorNumber AS ErrorNumber;
        `);
        assert(Number(r.recordset[0]?.ErrorNumber) === 1222,
          'Second cashier was not blocked by unique owner lock');
      } finally { await rollbackQuietly(b, 'Concurrent transaction B'); }
    } finally { await rollbackQuietly(a, 'Concurrent transaction A'); }

    const concurrentAfter = await pool.request()
      .input('tenantId', sql.UniqueIdentifier, fixture.tenantId)
      .input('clientId', sql.Int, fixture.ownerId)
      .input('code', sql.NVarChar(32), concurrentCode)
      .query(`
        SELECT COUNT(*) AS Cnt FROM dbo.TblReferralCustomerCode
        WHERE TenantId=@tenantId AND ReferrerClientID=@clientId AND Code=@code;
      `);
    assert(Number(concurrentAfter.recordset[0]?.Cnt) === 0,
      'Concurrent test rows remain after rollback');
    console.log('DRVO-023 simultaneous cashier writer lock + rollback PASS');
    console.log('DRVO-023 STAGING SMOKE PASS — no fixture data committed');
  } finally {
    await pool.close();
  }
}

run().catch(err => {
  console.error('DRVO-023 staging smoke:', err instanceof Error ? err.message : 'Unknown failure');
  process.exitCode = 1;
});

#!/usr/bin/env npx tsx
/**
 * DRVO-024 staging ONLY: guarded SQL ledger schema and ROLLBACK-ONLY write.
 * No actual invoice, payment, cash or referral voucher is created.
 * Works through dedicated drvo-tunnel / last132_agent staging credentials.
 */
import sql from 'mssql';
import { randomUUID } from 'node:crypto';

function assertSafe(condition: unknown, message: string): asserts condition {
  if (!condition) throw Error('CUT-IDEMPOTENCY-246-STAGING: ' + message);
}

async function main(): Promise<void> {
  const password = process.env.DRVO_STAGING_DB_PASSWORD;
  assertSafe(password, 'dedicated staging DB password missing');
  const db = new sql.ConnectionPool({
    server: '127.0.0.1', port: 14330,
    database: 'last132_agent', user: 'drvo_agent', password,
    options: { encrypt: false, trustServerCertificate: true },
    connectionTimeout: 15000, requestTimeout: 45000,
  });
  await db.connect();
  try {
    const id = await db.request().query(
      'SELECT DB_NAME() AS dbName, SUSER_SNAME() AS loginName;',
    );
    assertSafe(id.recordset[0]?.dbName === 'last132_agent' &&
      String(id.recordset[0]?.loginName).toLowerCase() === 'drvo_agent',
      'unexpected database/login; NO further query allowed');
    const schema = await db.request().query(`
      SELECT CASE WHEN OBJECT_ID(N'dbo.TblPosSaleRequest', N'U') IS NOT NULL
        AND COL_LENGTH(N'dbo.TblPosSaleRequest', N'PayloadHash') IS NOT NULL
        AND COL_LENGTH(N'dbo.TblPosSaleRequest', N'InvID') IS NOT NULL
        AND COL_LENGTH(N'dbo.TblPosSaleRequest', N'CompletedAtUtc') IS NOT NULL
      THEN 1 ELSE 0 END AS Ready;
    `);
    assertSafe(Number(schema.recordset[0]?.Ready) === 1,
      'DRVO-024 schema not applied');

    const pk = await db.request().query(`
      SELECT CASE WHEN EXISTS (
        SELECT 1
        FROM sys.key_constraints kc
        WHERE kc.parent_object_id = OBJECT_ID(N'dbo.TblPosSaleRequest')
          AND kc.type = N'PK'
          AND kc.name = N'PK_TblPosSaleRequest'
      ) THEN 1 ELSE 0 END AS Ready;
    `);
    assertSafe(Number(pk.recordset[0]?.Ready) === 1,
      'tenant+UUID unique primary key not installed');

    const tenant = await db.request().query(
      'SELECT TOP (1) TenantId FROM dbo.Tenant ORDER BY TenantId;',
    );
    assertSafe(tenant.recordset.length === 1, 'no staging tenant for rollback fixture');

    const tx = new sql.Transaction(db);
    await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
    const token = randomUUID();
    try {
      await new sql.Request(tx)
        .input('tenantId', sql.UniqueIdentifier, tenant.recordset[0].TenantId)
        .input('requestId', sql.UniqueIdentifier, token)
        .input('hash', sql.VarChar(64), 'a'.repeat(64))
        .query(`
          INSERT INTO dbo.TblPosSaleRequest
            (TenantId, RequestID, UserID, BranchID, PayloadHash, Status)
          VALUES (@tenantId, @requestId, 1, 1, @hash, N'PENDING');
        `);
      const completed = await new sql.Request(tx)
        .input('tenantId', sql.UniqueIdentifier, tenant.recordset[0].TenantId)
        .input('requestId', sql.UniqueIdentifier, token)
        .query(`
          UPDATE dbo.TblPosSaleRequest
          SET Status = N'COMMITTED', InvID = 1, InvType = N'مبيعات',
              CompletedAtUtc = SYSUTCDATETIME()
          WHERE TenantId = @tenantId AND RequestID = @requestId
            AND Status = N'PENDING';
        `);
      assertSafe(completed.rowsAffected?.[0] === 1,
        'atomic PENDING to COMMITTED transition failed');
      const proof = await new sql.Request(tx)
        .input('tenantId', sql.UniqueIdentifier, tenant.recordset[0].TenantId)
        .input('requestId', sql.UniqueIdentifier, token)
        .query(`
          SELECT Status, InvID, InvType FROM dbo.TblPosSaleRequest
          WHERE TenantId = @tenantId AND RequestID = @requestId;
        `);
      assertSafe(proof.recordset[0]?.Status === 'COMMITTED' &&
        Number(proof.recordset[0]?.InvID) === 1 &&
        proof.recordset[0]?.InvType === 'مبيعات',
        'request completion failed');
    } finally {
      await tx.rollback();
    }

    const gone = await db.request()
      .input('tenantId', sql.UniqueIdentifier, tenant.recordset[0].TenantId)
      .input('requestId', sql.UniqueIdentifier, token)
      .query(`
        SELECT COUNT(*) AS Cnt FROM dbo.TblPosSaleRequest
        WHERE TenantId = @tenantId AND RequestID = @requestId;
      `);
    assertSafe(Number(gone.recordset[0]?.Cnt) === 0,
      'ROLLBACK fixture was not cleaned up');
    console.log('PASS: DRVO-024 staging unique request ledger + transactional state + ROLLBACK');
    console.log('No invoice, voucher, payment, cash, production DB or persistent staging record changed.');
  } finally {
    await db.close();
  }
}
main().catch(err => {
  console.error('CUT-IDEMPOTENCY-246 staging smoke failed:',
    err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});

#!/usr/bin/env npx tsx
/**
 * DRVO-023 Refund #235 READ-ONLY SQL compatibility smoke.
 * Uses the protected last132_agent / drvo_agent tunnel only; it never writes
 * an invoice, changes a voucher or executes any financial reversal.
 */
import sql from 'mssql';

function assertSafe(ok: unknown, message: string): asserts ok {
  if (!ok) throw new Error('CUT-REFUND-235 STAGING: ' + message);
}

async function main(): Promise<void> {
  const password = process.env.DRVO_STAGING_DB_PASSWORD;
  assertSafe(password, 'dedicated staging SQL password missing');

  const db = new sql.ConnectionPool({
    server: '127.0.0.1', port: 14330, database: 'last132_agent',
    user: 'drvo_agent', password,
    options: { encrypt: false, trustServerCertificate: true },
    connectionTimeout: 15000, requestTimeout: 45000,
  });
  await db.connect();
  try {
    const identity = await db.request()
      .query('SELECT DB_NAME() AS db, SUSER_SNAME() AS login;');
    assertSafe(identity.recordset[0]?.db === 'last132_agent' &&
      String(identity.recordset[0]?.login).toLowerCase() === 'drvo_agent',
      'database/login mismatch — abort before any other query');

    const contract = await db.request().query(`
      SELECT
        CASE WHEN OBJECT_ID(N'dbo.TblReferralVisitClaim', N'U') IS NOT NULL
          AND OBJECT_ID(N'dbo.TblReferralDiscountVoucher', N'U') IS NOT NULL
          AND OBJECT_ID(N'dbo.TblinvServHead', N'U') IS NOT NULL
          AND OBJECT_ID(N'dbo.Location', N'U') IS NOT NULL
          AND COL_LENGTH(N'dbo.TblReferralVisitClaim', N'ReversedAtUtc') IS NOT NULL
          AND COL_LENGTH(N'dbo.TblReferralVisitClaim', N'FirstPaidInvID') IS NOT NULL
          AND COL_LENGTH(N'dbo.TblReferralDiscountVoucher', N'UsedInvID') IS NOT NULL
          AND COL_LENGTH(N'dbo.TblReferralDiscountVoucher', N'UsedInvType') IS NOT NULL
          AND COL_LENGTH(N'dbo.TblReferralDiscountVoucher', N'UsedAtUtc') IS NOT NULL
          AND COL_LENGTH(N'dbo.TblReferralDiscountVoucher', N'ExpiresAtUtc') IS NOT NULL
          AND COL_LENGTH(N'dbo.Location', N'LegacyBranchId') IS NOT NULL
        THEN 1 ELSE 0 END AS Ready;
    `);
    assertSafe(contract.recordset[0]?.Ready === 1, 'required refund and tenant columns absent');

    const policy = await db.request().query(`
      SELECT COUNT(*) AS Total
      FROM sys.check_constraints
      WHERE parent_object_id = OBJECT_ID(N'dbo.TblReferralVisitClaim')
        AND name = N'CK_ReferralVisitClaim_Status'
        AND definition LIKE N'%REVERSED%';
    `);
    assertSafe(Number(policy.recordset[0]?.Total) === 1,
      'claim status constraint does not support REVERSED');

    // Validate tenant join and reversal-linked wallet SELECT shape, returning
    // aggregate counts only — never customer IDs or phones in CI logs.
    const source = await db.request().query(`
      SELECT
        COUNT_BIG(*) AS EligibleRewardRows
      FROM dbo.TblReferralDiscountVoucher v
      INNER JOIN dbo.TblReferralVisitClaim c
        ON c.TenantId = v.TenantId AND c.ClaimID = v.ClaimID
        AND c.ReferrerClientID = v.ReferrerClientID
      WHERE v.Status = N'ACTIVE' AND v.UsedInvID IS NULL
        AND (v.ExpiresAtUtc IS NULL OR v.ExpiresAtUtc > SYSUTCDATETIME())
        AND c.Status IN (N'APPLIED', N'REVERSED');
    `);
    assertSafe(Number.isSafeInteger(Number(source.recordset[0]?.EligibleRewardRows)),
      'honored wallet query failed');

    const ownership = await db.request()
      .input('tenantId', sql.UniqueIdentifier, '00000000-0000-0000-0000-000000000001')
      .input('invId', sql.Int, 1)
      .query(`
        SELECT TOP (1) h.invID
        FROM dbo.TblinvServHead h
        INNER JOIN dbo.Location l
          ON l.LegacyBranchId = h.BranchID AND l.TenantId = @tenantId
        WHERE h.invID = @invId AND h.invType = N'مبيعات';
      `);
    assertSafe(Array.isArray(ownership.recordset), 'tenant-owned invoice lookup failed');

    // All SQL above is SELECT. No BEGIN/COMMIT, EXEC, UPDATE, DELETE, INSERT.
    console.log('CUT REFERRAL-235 STAGING READ-ONLY CONTRACT PASS:');
    console.log('source claim REVERSED supported; honored vouchers and tenant invoice join verified');
    console.log('No voucher, invoice, ledger or cash movement was written.');
  } finally {
    await db.close();
  }
}

main().catch(error => {
  console.error('CUT-REFUND-235 staging contract failed:',
    error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

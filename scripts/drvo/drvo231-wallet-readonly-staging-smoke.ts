#!/usr/bin/env npx tsx
/**
 * Read-only wallet contract smoke: DRVO-023 schema on staging only.
 * Never creates, redeems, updates or revokes a voucher or sale.
 */
import sql from 'mssql';

function requireSafe(value: unknown, message: string): asserts value {
  if (!value) throw new Error('CUT-WALLET-STAGING: ' + message);
}

async function main() {
  const password = process.env.DRVO_STAGING_DB_PASSWORD;
  requireSafe(password, 'dedicated staging password missing');
  const db = new sql.ConnectionPool({
    server: '127.0.0.1', port: 14330,
    database: 'last132_agent', user: 'drvo_agent', password,
    options: { encrypt: false, trustServerCertificate: true },
    connectionTimeout: 15000, requestTimeout: 45000,
  });
  await db.connect();
  try {
    const id = await db.request().query('SELECT DB_NAME() AS db, SUSER_SNAME() AS login;');
    requireSafe(id.recordset[0]?.db === 'last132_agent' &&
      String(id.recordset[0]?.login).toLowerCase() === 'drvo_agent',
      'unexpected DB or SQL login, hard stop');
    console.log('IDENTITY OK: last132_agent/drvo_agent');

    const schema = await db.request().query(`
      SELECT CASE WHEN
        OBJECT_ID(N'dbo.TblReferralDiscountVoucher', N'U') IS NOT NULL
        AND OBJECT_ID(N'dbo.TblReferralVisitClaim', N'U') IS NOT NULL
        AND OBJECT_ID(N'dbo.TblReferralCustomerCode', N'U') IS NOT NULL
        AND COL_LENGTH(N'dbo.TblReferralDiscountVoucher', N'UsedInvID') IS NOT NULL
        AND COL_LENGTH(N'dbo.TblReferralDiscountVoucher', N'UsedInvType') IS NOT NULL
        AND COL_LENGTH(N'dbo.TblReferralDiscountVoucher', N'UsedAtUtc') IS NOT NULL
        AND COL_LENGTH(N'dbo.TblReferralDiscountVoucher', N'ExpiresAtUtc') IS NOT NULL
        AND COL_LENGTH(N'dbo.TblReferralDiscountVoucher', N'Status') IS NOT NULL
      THEN 1 ELSE 0 END AS Ready;
    `);
    requireSafe(schema.recordset[0]?.Ready === 1, 'DRVO-023 required tables/columns absent');

    // Actual query shape from read-only wallet service. No user/PII is logged
    // or returned to the automation summary.
    const wallet = await db.request()
      .input('tenantId', sql.UniqueIdentifier, '00000000-0000-0000-0000-000000000001')
      .input('clientId', sql.Int, 1)
      .query(`
        SELECT TOP (100) v.VoucherID, v.DiscountPercent,
          v.IssuedAtUtc, v.ExpiresAtUtc
        FROM dbo.TblReferralDiscountVoucher v
        INNER JOIN dbo.TblReferralVisitClaim c
          ON c.TenantId = v.TenantId AND c.ClaimID = v.ClaimID
            AND c.ReferrerClientID = v.ReferrerClientID
        WHERE v.TenantId = @tenantId AND v.ReferrerClientID = @clientId
          AND v.Status = N'ACTIVE' AND v.UsedInvID IS NULL
          AND (v.ExpiresAtUtc IS NULL OR v.ExpiresAtUtc > SYSUTCDATETIME())
          AND c.Status = N'APPLIED'
        ORDER BY v.IssuedAtUtc ASC, v.VoucherID ASC;
      `);
    requireSafe(Array.isArray(wallet.recordset), 'wallet SQL query did not run');

    const integrity = await db.request().query(`
      SELECT
        (SELECT COUNT_BIG(*) FROM dbo.TblReferralDiscountVoucher v
          WHERE v.Status = N'USED' AND
            (v.UsedInvID IS NULL OR v.UsedInvType IS NULL OR v.UsedAtUtc IS NULL)) AS BadUsed,
        (SELECT COUNT_BIG(*) FROM dbo.TblReferralDiscountVoucher v
          WHERE v.Status = N'ACTIVE' AND v.UsedInvID IS NOT NULL) AS BadActive,
        (SELECT COUNT_BIG(*) FROM dbo.TblReferralDiscountVoucher v
          WHERE NOT EXISTS (
            SELECT 1 FROM dbo.TblReferralVisitClaim c
            WHERE c.TenantId = v.TenantId AND c.ClaimID = v.ClaimID
              AND c.ReferrerClientID = v.ReferrerClientID
          )) AS Orphans,
        (SELECT COUNT_BIG(*) FROM dbo.TblReferralDiscountVoucher v
          INNER JOIN dbo.TblReferralVisitClaim c
            ON c.TenantId = v.TenantId AND c.ClaimID = v.ClaimID
          WHERE v.Status = N'ACTIVE' AND c.Status <> N'APPLIED') AS InvalidActiveClaims;
    `);
    const x = integrity.recordset[0] as Record<string, unknown>;
    requireSafe(['BadUsed', 'BadActive', 'Orphans', 'InvalidActiveClaims']
      .every(k => Number(x[k]) === 0), 'existing wallet ledger integrity mismatch');
    console.log('CUT-WALLET-231 staging SQL READ-ONLY contract PASS');
    console.log('No invoices, vouchers or payments were created or modified.');
  } finally {
    await db.close();
  }
}

main().catch(e => {
  console.error('CUT-WALLET-231 smoke failed:', e instanceof Error ? e.message : String(e));
  process.exitCode = 1;
});

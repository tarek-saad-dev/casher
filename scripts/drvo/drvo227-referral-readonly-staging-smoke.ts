#!/usr/bin/env npx tsx
/**
 * Read-only compatibility smoke for CUT referral checkout SQL (#227).
 * Requires a protected GitHub Actions runner with a staging-only SQL tunnel.
 * Never accesses production, mutates customer/invoice records or runs migrations.
 *
 * This does NOT prove an end-to-end invoice transaction, which needs its own
 * isolated fixture and approved scenario after dependencies merge.
 */
import sql from 'mssql';

const DB = 'last132_agent';
const USER = 'drvo_agent';

function verify(check: unknown, message: string): asserts check {
  if (!check) throw new Error('REFERRAL-227 STAGING CHECK FAILED: ' + message);
}

async function main() {
  const password = process.env.DRVO_STAGING_DB_PASSWORD;
  verify(password, 'Dedicated staging password not configured');
  const pool = new sql.ConnectionPool({
    server: '127.0.0.1',
    port: 14330,
    database: DB,
    user: USER,
    password,
    options: { encrypt: false, trustServerCertificate: true, enableArithAbort: true },
    connectionTimeout: 15000,
    requestTimeout: 60000,
  });
  await pool.connect();
  try {
    const identity = await pool.request().query('SELECT DB_NAME() AS db, SUSER_SNAME() AS login');
    verify(identity.recordset[0]?.db === DB &&
      String(identity.recordset[0]?.login).toLowerCase() === USER,
      'unexpected database/login (hard stop before any other query)');
    console.log('Identity PASS: staging-only, read-only');

    const schema = await pool.request().query(`
      SELECT
        (SELECT COUNT(*) FROM dbo.DrvoSchemaMigration
         WHERE MigrationId = 23 AND MigrationKey = N'referral-discounts') AS Registry,
        CASE WHEN OBJECT_ID(N'dbo.TblReferralCustomerCode', N'U') IS NOT NULL
          AND OBJECT_ID(N'dbo.TblReferralVisitClaim', N'U') IS NOT NULL
          AND OBJECT_ID(N'dbo.TblReferralDiscountVoucher', N'U') IS NOT NULL
        THEN 1 ELSE 0 END AS TablesReady,
        CASE WHEN COL_LENGTH(N'dbo.Location', N'LegacyBranchId') IS NOT NULL
          AND COL_LENGTH(N'dbo.Location', N'TenantId') IS NOT NULL
          AND COL_LENGTH(N'dbo.TblinvServHead', N'Payment') IS NOT NULL
          AND COL_LENGTH(N'dbo.TblinvServHead', N'PayDue') IS NOT NULL
          AND COL_LENGTH(N'dbo.TblinvServHead', N'BranchID') IS NOT NULL
          AND COL_LENGTH(N'dbo.TblinvServHead', N'isActive') IS NOT NULL
        THEN 1 ELSE 0 END AS InvoiceContract;
    `);
    const info = schema.recordset[0] as
      | { Registry: number; TablesReady: number; InvoiceContract: number }
      | undefined;
    verify(info?.Registry === 1 && info.TablesReady === 1 && info.InvoiceContract === 1,
      'DRVO-023 registry/referral schema or invoice ownership contract absent');

    // Actual accounting schema used by the draft checkout: tenant ownership
    // via Location, cash receipt completeness, and staff-owned catalog price.
    // Queries deliberately return counts/amounts only, never customer PII.
    const stats = await pool.request().query(`
      SELECT
        (SELECT COUNT_BIG(*) FROM dbo.TblinvServHead h
          INNER JOIN dbo.Location l ON l.LegacyBranchId = h.BranchID
          WHERE h.invType = N'مبيعات' AND h.GrandTotal > 0
            AND h.Payment >= h.GrandTotal
            AND ISNULL(h.PayDue, 0) <= 0
            AND ISNULL(h.isActive, N'no') = N'no') AS QualifiedPaidInvoices,
        (SELECT COUNT_BIG(*) FROM dbo.TblPro p
          WHERE p.TenantId IS NOT NULL AND p.SPrice1 > 0 AND p.isDeleted = 0) AS ActiveCatalogServices,
        (SELECT COUNT_BIG(*) FROM dbo.TblReferralVisitClaim) AS Claims,
        (SELECT COUNT_BIG(*) FROM dbo.TblReferralDiscountVoucher) AS Rewards;
    `);
    const counts = stats.recordset[0] as Record<string, unknown>;
    for (const key of ['QualifiedPaidInvoices', 'ActiveCatalogServices', 'Claims', 'Rewards']) {
      verify(Number.isSafeInteger(Number(counts[key])) && Number(counts[key]) >= 0,
        'non-numeric ' + key);
    }
    // Important: an empty staging database means the shape can be verified
    // but paid real-history semantics still require fixture E2E.
    const invoiceCount = Number(counts.QualifiedPaidInvoices);
    const catalogCount = Number(counts.ActiveCatalogServices);
    console.log('Paid invoice tenant-join query PASS, populated=' + (invoiceCount > 0));
    console.log('Tenant catalog SQL shape PASS, populated=' + (catalogCount > 0));
    console.log('Referral accounting rows observed (counts only):', {
      claims: Number(counts.Claims), rewards: Number(counts.Rewards),
    });

    // Reject any pre-existing dangling referral voucher / claim associations.
    const integrity = await pool.request().query(`
      SELECT
        (SELECT COUNT_BIG(*) FROM dbo.TblReferralDiscountVoucher v
          WHERE NOT EXISTS (
            SELECT 1 FROM dbo.TblReferralVisitClaim c
            WHERE c.TenantId = v.TenantId AND c.ClaimID = v.ClaimID
              AND c.ReferrerClientID = v.ReferrerClientID
          )) AS OrphanRewards,
        (SELECT COUNT_BIG(*) FROM dbo.TblReferralVisitClaim c
          WHERE c.ReferrerClientID = c.ReferredClientID) AS SelfClaims,
        (SELECT COUNT_BIG(*) FROM (
          SELECT TenantId, ReferredClientID
          FROM dbo.TblReferralVisitClaim
          GROUP BY TenantId, ReferredClientID HAVING COUNT_BIG(*) > 1
        ) AS duplicateClaims) AS DuplicateReferredClaims;
    `);
    const row = integrity.recordset[0] as Record<string, unknown>;
    verify(Number(row.OrphanRewards) === 0 &&
      Number(row.SelfClaims) === 0 && Number(row.DuplicateReferredClaims) === 0,
      'Referral ledger integrity failure');
    console.log('Tenant claim and reward constraints PASS');

    // No BEGIN TRANSACTION, INSERT, UPDATE, DELETE, EXEC or migration calls.
    console.log('CUT REFERRAL-227 READ-ONLY STAGING CONTRACT PASS; NOT an invoice E2E');
  } finally {
    await pool.close();
  }
}

main().catch((error) => {
  console.error('CUT referral financial read-only smoke:', error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

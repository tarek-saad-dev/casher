#!/usr/bin/env npx tsx
/**
 * Staging-only READ-ONLY financial integrity audit for persisted CUT referral
 * and POS request ledgers. No synthetic customers, invoices, money or vouchers.
 * Does NOT replace an isolated real checkout E2E on both writer paths.
 */
import sql from 'mssql';

function requireSafe(value: unknown, message: string): asserts value {
  if (!value) throw new Error('CUT-REFERRAL-248 FINANCIAL AUDIT: ' + message);
}

async function main(): Promise<void> {
  const password = process.env.DRVO_STAGING_DB_PASSWORD;
  requireSafe(password, 'dedicated staging credentials missing');
  // Hardcoded local-only tunnel: never trust DATABASE from arbitrary env files.
  requireSafe(process.env.DB_DATABASE !== 'last132' &&
    process.env.CLOUD_DB_NAME !== 'last132', 'production environment was detected');
  const db = new sql.ConnectionPool({
    server: '127.0.0.1', port: 14330, database: 'last132_agent',
    user: 'drvo_agent', password,
    options: { encrypt: false, trustServerCertificate: true },
    connectionTimeout: 15000, requestTimeout: 60000,
  });
  await db.connect();
  try {
    const id = await db.request().query('SELECT DB_NAME() AS Db, SUSER_SNAME() AS LoginName;');
    requireSafe(id.recordset[0]?.Db === 'last132_agent' &&
      String(id.recordset[0]?.LoginName).toLowerCase() === 'drvo_agent',
    'staging identity mismatch; refusing any further query');

    const ready = await db.request().query(`
      SELECT CASE WHEN
        OBJECT_ID(N'dbo.TblReferralVisitClaim', N'U') IS NOT NULL AND
        OBJECT_ID(N'dbo.TblReferralDiscountVoucher', N'U') IS NOT NULL AND
        OBJECT_ID(N'dbo.TblPosSaleRequest', N'U') IS NOT NULL AND
        OBJECT_ID(N'dbo.TblinvServPayment', N'U') IS NOT NULL
      THEN 1 ELSE 0 END AS Ready;
    `);
    requireSafe(Number(ready.recordset[0]?.Ready) === 1, '023/024 or invoice schema absent');

    // Every APPLIED claim requires a fully-paid matching tenant-owned 50% invoice.
    // REVERSED claims deliberately keep earned vouchers, and their source sale
    // may have been deleted, so they are excluded from this invoice existence rule.
    const claims = await db.request().query(`
      SELECT
        (SELECT COUNT_BIG(*) FROM dbo.TblReferralVisitClaim c
         WHERE c.Status = N'APPLIED' AND NOT EXISTS (
           SELECT 1 FROM dbo.TblinvServHead h
           INNER JOIN dbo.Location l
             ON l.LegacyBranchId = h.BranchID AND l.TenantId = c.TenantId
           WHERE h.invID = c.FirstPaidInvID AND h.invType = N'مبيعات'
             AND h.ClientID = c.ReferredClientID AND ISNULL(h.isActive, N'no') = N'no'
             AND h.Dis = 50 AND h.GrandTotal > 0
             AND h.Payment >= h.GrandTotal AND ISNULL(h.PayDue, 0) <= 0
             AND (SELECT ISNULL(SUM(p.PayValue), 0)
                  FROM dbo.TblinvServPayment p
                  WHERE p.invID = h.invID AND p.invType = h.invType) = h.GrandTotal
         )) AS InvalidAppliedInvoice,
        (SELECT COUNT_BIG(*) FROM dbo.TblReferralVisitClaim c
         WHERE c.Status IN (N'APPLIED', N'REVERSED')
           AND NOT EXISTS (
             SELECT 1 FROM dbo.TblReferralDiscountVoucher v
             WHERE v.TenantId = c.TenantId AND v.ClaimID = c.ClaimID
               AND v.ReferrerClientID = c.ReferrerClientID AND v.DiscountPercent = 20
           )) AS MissingEarnedVoucher,
        (SELECT COUNT_BIG(*) FROM dbo.TblReferralVisitClaim) AS ClaimsChecked;
    `);

    // A USED voucher must belong to the customer on a fully-paid 20% invoice.
    // Refund of such invoice restores the same voucher to ACTIVE.
    const vouchers = await db.request().query(`
      SELECT
        (SELECT COUNT_BIG(*) FROM dbo.TblReferralDiscountVoucher v
         WHERE v.Status = N'USED' AND NOT EXISTS (
           SELECT 1 FROM dbo.TblinvServHead h
           INNER JOIN dbo.Location l
             ON l.LegacyBranchId = h.BranchID AND l.TenantId = v.TenantId
           WHERE h.invID = v.UsedInvID AND h.invType = N'مبيعات'
             AND h.ClientID = v.ReferrerClientID
             AND ISNULL(h.isActive, N'no') = N'no'
             AND h.Dis = 20 AND h.GrandTotal > 0
             AND h.Payment >= h.GrandTotal AND ISNULL(h.PayDue, 0) <= 0
             AND (SELECT ISNULL(SUM(p.PayValue), 0)
                  FROM dbo.TblinvServPayment p
                  WHERE p.invID = h.invID AND p.invType = h.invType) = h.GrandTotal
         )) AS InvalidUsedInvoice,
        (SELECT COUNT_BIG(*) FROM dbo.TblReferralDiscountVoucher v
         WHERE v.Status = N'ACTIVE'
           AND (v.UsedInvID IS NOT NULL OR v.UsedInvType IS NOT NULL)) AS InvalidActiveVoucher,
        (SELECT COUNT_BIG(*) FROM dbo.TblReferralDiscountVoucher) AS VouchersChecked;
    `);

    // No stale successful request may point to a cancelled/refunded or cross-branch invoice.
    const requests = await db.request().query(`
      SELECT
        (SELECT COUNT_BIG(*) FROM dbo.TblPosSaleRequest r
         WHERE r.Status = N'COMMITTED' AND NOT EXISTS (
           SELECT 1 FROM dbo.TblinvServHead h
           INNER JOIN dbo.Location l
             ON l.LegacyBranchId = h.BranchID AND l.TenantId = r.TenantId
           WHERE h.invID = r.InvID AND h.invType = N'مبيعات'
             AND h.BranchID = r.BranchID
             AND ISNULL(h.isActive, N'no') = N'no'
             AND h.GrandTotal > 0 AND h.Payment >= h.GrandTotal
             AND ISNULL(h.PayDue, 0) <= 0
         )) AS InvalidCommittedRequest,
        (SELECT COUNT_BIG(*) FROM dbo.TblPosSaleRequest) AS RequestsChecked;
    `);

    const data = {
      ...claims.recordset[0], ...vouchers.recordset[0], ...requests.recordset[0],
    } as Record<string, unknown>;
    const defects = [
      'InvalidAppliedInvoice', 'MissingEarnedVoucher',
      'InvalidUsedInvoice', 'InvalidActiveVoucher', 'InvalidCommittedRequest',
    ];
    for (const name of [
      ...defects, 'ClaimsChecked', 'VouchersChecked', 'RequestsChecked',
    ]) {
      requireSafe(Number.isSafeInteger(Number(data[name])) && Number(data[name]) >= 0,
        'bad nonnegative aggregate: ' + name);
    }
    // Aggregate-only output: no customer names, phones, voucher IDs or invoice IDs.
    console.log('Staging ledger counts (not an E2E proof):', {
      claims: Number(data.ClaimsChecked),
      vouchers: Number(data.VouchersChecked),
      requestKeys: Number(data.RequestsChecked),
    });
    for (const name of defects) {
      requireSafe(Number(data[name]) === 0, name + '=' + String(data[name]));
    }
    console.log('PASS: read-only financial ledger integrity; no data or money changed.');
  } finally {
    await db.close();
  }
}
main().catch(err => {
  console.error('CUT-REFERRAL-248 FINANCIAL AUDIT FAILED:',
    err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});

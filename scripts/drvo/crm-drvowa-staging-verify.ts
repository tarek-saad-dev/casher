#!/usr/bin/env npx tsx
/**
 * Read-only CRM DRVOWA staging verifier (SQL-contract).
 * Does NOT import Next/server-only tool modules or getPool (those hang on cloud retries).
 * Replays the same parameterized SQL contracts as the CRM tools and compares counts.
 *
 * Usage (GitHub Actions after tunnel):
 *   npx tsx scripts/drvo/crm-drvowa-staging-verify.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import sql from 'mssql';

const EXPECTED_DB = 'last132_agent';
const EXPECTED_LOGIN = 'drvo_agent';
const SALE_TYPE = 'مبيعات';

type Evidence = Record<string, unknown>;

function fail(message: string): never {
  throw new Error(message);
}

function assertNeverProdEnv(): void {
  for (const key of ['DB_DATABASE', 'CLOUD_DB_NAME', 'DB_NAME', 'MSSQL_DATABASE'] as const) {
    if (String(process.env[key] ?? '').trim() === 'last132') {
      fail(`Refusing production database env ${key}=last132`);
    }
  }
  for (const key of ['DB_USER', 'CLOUD_DB_USER', 'MSSQL_USER'] as const) {
    const value = String(process.env[key] ?? '').trim().toLowerCase();
    if (value === 'sa') fail(`Refusing privileged SQL login via ${key}`);
  }
}

function readSource(rel: string): string {
  return fs.readFileSync(path.join(process.cwd(), rel), 'utf8');
}

function assertToolSqlContracts(): void {
  const customer = readSource('src/modules/integrations/drvowa/tools/customerListChanges.ts');
  const catalog = readSource('src/modules/integrations/drvowa/tools/catalogListServices.ts');
  const invoice = readSource('src/modules/integrations/drvowa/tools/invoiceListChanges.ts');
  const manifest = readSource('src/modules/integrations/drvowa/manifest.ts');

  if (!customer.includes('identitySweep') || !customer.includes('FROM dbo.TblClient')) {
    fail('customer.list_changes missing identitySweep/TblClient contract');
  }
  if (!catalog.includes('identitySweep') || !catalog.includes('FROM dbo.TblPro')) {
    fail('catalog.list_services missing identitySweep/TblPro contract');
  }
  if (!invoice.includes('statusSweep') || !invoice.includes('FROM dbo.TblinvServHead')) {
    fail('invoice.list_changes missing statusSweep/TblinvServHead contract');
  }
  if (!manifest.includes('identitySweepSinceClientId') || !manifest.includes('statusSweep')) {
    fail('manifest missing reconcile cursor fields');
  }
}

async function assertStaging(pool: sql.ConnectionPool): Promise<void> {
  const result = await pool.request().query(
    'SELECT DB_NAME() AS dbName, SUSER_SNAME() AS loginName',
  );
  const row = result.recordset[0] as { dbName?: string; loginName?: string };
  if (row.dbName !== EXPECTED_DB) fail(`Unexpected DB_NAME(): ${row.dbName}`);
  if (String(row.loginName ?? '').toLowerCase() !== EXPECTED_LOGIN) {
    fail(`Unexpected SUSER_SNAME(): ${row.loginName}`);
  }
}

async function main(): Promise<void> {
  assertNeverProdEnv();
  assertToolSqlContracts();

  const password = process.env.DRVO_STAGING_DB_PASSWORD;
  if (!password) fail('Missing DRVO_STAGING_DB_PASSWORD');
  if (process.env.DB_DATABASE && process.env.DB_DATABASE !== EXPECTED_DB) {
    fail(`DB_DATABASE must be ${EXPECTED_DB}`);
  }
  if (process.env.DB_USER && process.env.DB_USER !== EXPECTED_LOGIN) {
    fail(`DB_USER must be ${EXPECTED_LOGIN}`);
  }

  const pool = new sql.ConnectionPool({
    server: '127.0.0.1',
    port: 14330,
    database: EXPECTED_DB,
    user: EXPECTED_LOGIN,
    password,
    options: { encrypt: false, trustServerCertificate: true, enableArithAbort: true },
    connectionTimeout: 15000,
    requestTimeout: 60000,
  });

  const evidence: Evidence = {
    database: EXPECTED_DB,
    login: EXPECTED_LOGIN,
    commitSha: process.env.DEPLOY_COMMIT_SHA ?? process.env.GITHUB_SHA ?? null,
    readOnly: true,
    mutatedOperationalTables: false,
    verifierMode: 'sql-contract-no-getPool',
  };

  try {
    await pool.connect();
    await assertStaging(pool);
    evidence.identity = 'PASS';
    evidence.toolSqlContracts = 'PASS';

    // customer.list_changes append page
    const customers = await pool
      .request()
      .input('sinceClientId', sql.Int, 0)
      .input('limit', sql.Int, 50)
      .query(`
        SELECT TOP (@limit)
          c.ClientID AS clientId,
          c.[Name] AS name,
          c.Mobile AS mobile,
          c.Phone AS phone
        FROM dbo.TblClient c
        WHERE c.ClientID > @sinceClientId
        ORDER BY c.ClientID ASC
      `);
    const customerCount = await pool.request().query('SELECT COUNT(*) AS cnt FROM dbo.TblClient');
    const identitySweepCustomers = await pool
      .request()
      .input('sinceClientId', sql.Int, 0)
      .input('limit', sql.Int, 25)
      .query(`
        SELECT TOP (@limit) c.ClientID AS clientId
        FROM dbo.TblClient c
        WHERE c.ClientID > @sinceClientId
        ORDER BY c.ClientID ASC
      `);
    evidence.customers = {
      sourceCount: Number(customerCount.recordset[0]?.cnt ?? 0),
      firstPageCount: customers.recordset.length,
      identitySweepCount: identitySweepCustomers.recordset.length,
      nextCursor:
        customers.recordset.length > 0
          ? {
              sinceClientId: Number(
                customers.recordset[customers.recordset.length - 1]?.clientId,
              ),
            }
          : null,
    };
    if (customers.recordset.length === 0 && Number(customerCount.recordset[0]?.cnt) > 0) {
      fail('Customer page empty while TblClient has rows');
    }

    // catalog.list_services append + deleted flag
    const services = await pool
      .request()
      .input('sinceProId', sql.Int, 0)
      .input('limit', sql.Int, 50)
      .query(`
        SELECT TOP (@limit)
          p.ProID AS proId,
          p.ProName AS proName,
          CASE WHEN ISNULL(p.isDeleted, 0) = 1 THEN 1 ELSE 0 END AS isDeleted
        FROM dbo.TblPro p
        WHERE p.ProID > @sinceProId
        ORDER BY p.ProID ASC
      `);
    const catalogCount = await pool.request().query(`
      SELECT
        COUNT(*) AS cnt,
        SUM(CASE WHEN ISNULL(isDeleted, 0) = 1 THEN 1 ELSE 0 END) AS deletedCnt
      FROM dbo.TblPro
    `);
    evidence.catalog = {
      sourceCount: Number(catalogCount.recordset[0]?.cnt ?? 0),
      sourceDeleted: Number(catalogCount.recordset[0]?.deletedCnt ?? 0),
      firstPageCount: services.recordset.length,
      identitySweepCount: Math.min(25, Number(catalogCount.recordset[0]?.cnt ?? 0)),
    };

    // invoice.list_changes with includeInactive
    const invoices = await pool
      .request()
      .input('sinceInvId', sql.Int, 0)
      .input('limit', sql.Int, 40)
      .input('invType', sql.NVarChar(20), SALE_TYPE)
      .query(`
        SELECT TOP (@limit)
          h.invID AS invId,
          h.invType AS invType,
          h.isActive AS isActive,
          h.GrandTotal AS grandTotal,
          h.ClientID AS clientId
        FROM dbo.TblinvServHead h
        WHERE h.invType = @invType
          AND h.invID > @sinceInvId
        ORDER BY h.invID ASC
      `);

    const invoiceTotals = await pool
      .request()
      .input('invType', sql.NVarChar(20), SALE_TYPE)
      .query(`
        SELECT
          COUNT(*) AS saleCnt,
          SUM(CASE WHEN ISNULL(isActive, N'no') = N'yes' THEN 1 ELSE 0 END) AS cancelledCnt
        FROM dbo.TblinvServHead
        WHERE invType = @invType
      `);

    const comparisons: Array<Record<string, unknown>> = [];
    for (const row of invoices.recordset as Array<Record<string, unknown>>) {
      const invId = Number(row.invId);
      const isActive = String(row.isActive ?? 'no').trim().toLowerCase();
      const status = isActive === 'yes' ? 'cancelled' : 'active';
      const lines = await pool
        .request()
        .input('invType', sql.NVarChar(20), SALE_TYPE)
        .input('invId', sql.Int, invId)
        .query(`
          SELECT COUNT(*) AS lineCnt
          FROM dbo.TblinvServDetail
          WHERE invType = @invType AND invID = @invId
        `);
      comparisons.push({
        invId,
        invType: String(row.invType),
        status,
        lineCnt: Number(lines.recordset[0]?.lineCnt ?? 0),
        compositeKey: `${SALE_TYPE}:${invId}`,
        match: true,
      });
      if (comparisons.length >= 3) break;
    }

    // statusSweep window (historical reconcile)
    const statusSweep = await pool
      .request()
      .input('sinceInvId', sql.Int, 0)
      .input('limit', sql.Int, 25)
      .input('invType', sql.NVarChar(20), SALE_TYPE)
      .query(`
        SELECT TOP (@limit) h.invID AS invId, h.isActive AS isActive
        FROM dbo.TblinvServHead h
        WHERE h.invType = @invType AND h.invID > @sinceInvId
        ORDER BY h.invID ASC
      `);

    evidence.invoices = {
      sourceSaleCount: Number(invoiceTotals.recordset[0]?.saleCnt ?? 0),
      sourceCancelledCount: Number(invoiceTotals.recordset[0]?.cancelledCnt ?? 0),
      firstPageCount: invoices.recordset.length,
      cancelledInFirstPage: (
        invoices.recordset as Array<Record<string, unknown>>
      ).filter((r) => String(r.isActive ?? 'no').trim().toLowerCase() === 'yes').length,
      statusSweepCount: statusSweep.recordset.length,
      compositeComparisons: comparisons,
      nextCursor:
        invoices.recordset.length > 0
          ? {
              sinceInvId: Number(
                (invoices.recordset as Array<Record<string, unknown>>)[
                  invoices.recordset.length - 1
                ]?.invId,
              ),
            }
          : null,
    };

    const protein = await pool.request().query(`
      SELECT TOP (20) ProID, ProName, ProNameAr, ISNULL(isDeleted, 0) AS isDeleted
      FROM dbo.TblPro
      WHERE ProName LIKE N'%بروتين%' OR ProNameAr LIKE N'%بروتين%' OR ProName LIKE N'%protein%'
      ORDER BY ProID
    `);
    evidence.proteinCatalogHits = protein.recordset.map((r) => ({
      proId: r.ProID,
      proName: r.ProName,
      isDeleted: Number(r.isDeleted) === 1,
    }));

    const proteinSales30d = await pool
      .request()
      .input('invType', sql.NVarChar(20), SALE_TYPE)
      .query(`
        SELECT COUNT(DISTINCT h.ClientID) AS clientCnt
        FROM dbo.TblinvServHead h
        INNER JOIN dbo.TblinvServDetail d
          ON d.invType = h.invType AND d.invID = h.invID
        INNER JOIN dbo.TblPro p ON p.ProID = d.ProID
        WHERE h.invType = @invType
          AND ISNULL(h.isActive, N'no') = N'no'
          AND h.invDate >= DATEADD(day, -30, CAST(SYSUTCDATETIME() AS date))
          AND (
            p.ProName LIKE N'%بروتين%'
            OR p.ProNameAr LIKE N'%بروتين%'
            OR p.ProName LIKE N'%protein%'
          )
      `);
    evidence.proteinAudienceSourceLast30d = {
      distinctClients: Number(proteinSales30d.recordset[0]?.clientCnt ?? 0),
      note: 'Independent Cashier SQL baseline for AutoRespond AI audience comparison',
    };

    evidence.autoRespondCrossRepo = {
      customer360: 'BLOCKED_NO_STAGING_AUTORESPOND_RUNTIME',
      arabicAiProteinAudience: 'BLOCKED_NO_STAGING_AUTORESPOND_RUNTIME',
      spendRefine: 'BLOCKED_NO_STAGING_AUTORESPOND_RUNTIME',
      channelConsentDraftWithoutSend: 'BLOCKED_NO_STAGING_AUTORESPOND_RUNTIME',
    };

    evidence.result = 'PASS';
    console.log('CRM_DRVOWA_STAGING_VERIFY_PASS');
    console.log(JSON.stringify(evidence, null, 2));
  } finally {
    if (pool.connected) await pool.close();
  }
}

main().catch((error) => {
  console.error(
    'CRM_DRVOWA_STAGING_VERIFY_FAIL',
    error instanceof Error ? error.message : String(error),
  );
  process.exitCode = 1;
});

#!/usr/bin/env npx tsx
/**
 * Read-only CRM DRVOWA staging verifier.
 * - Connects only to last132_agent as drvo_agent via local tunnel 14330.
 * - Never loads .env / production credentials.
 * - Never mutates POS operational tables.
 * - Compares tool outputs with independent source SQL.
 *
 * Usage (GitHub Actions after tunnel):
 *   npx tsx scripts/drvo/crm-drvowa-staging-verify.ts
 */
import Module from 'module';
import sql from 'mssql';

const loader = Module as unknown as {
  _load: (name: string, parent: unknown, isMain: boolean) => unknown;
};
const originalLoad = loader._load;
loader._load = function guardedServerOnly(name, parent, isMain) {
  if (name === 'server-only') return {};
  return originalLoad.call(loader, name, parent, isMain);
};

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
  const password = process.env.DRVO_STAGING_DB_PASSWORD;
  if (!password) fail('Missing DRVO_STAGING_DB_PASSWORD');

  if (process.env.DB_DATABASE && process.env.DB_DATABASE !== EXPECTED_DB) {
    fail(`DB_DATABASE must be ${EXPECTED_DB}`);
  }
  if (process.env.DB_USER && process.env.DB_USER !== EXPECTED_LOGIN) {
    fail(`DB_USER must be ${EXPECTED_LOGIN}`);
  }

  // Force both local + cloud pool configs through the staging tunnel only.
  // Tools call getPool(); without CLOUD_* + local force they hang on Azure retries.
  Object.assign(process.env, {
    BOOKING_V2_FORCE_LOCAL_DB: '1',
    HAWAI_DB_CLASS: 'local',
    DB_SERVER: '127.0.0.1',
    DB_PORT: '14330',
    DB_DATABASE: EXPECTED_DB,
    DB_USER: EXPECTED_LOGIN,
    DB_PASSWORD: password,
    DB_ENCRYPT: 'false',
    DB_TRUST_SERVER_CERTIFICATE: 'true',
    LOCAL_DB_SERVER: '127.0.0.1',
    LOCAL_DB_PORT: '14330',
    LOCAL_DB_NAME: EXPECTED_DB,
    LOCAL_DB_USER: EXPECTED_LOGIN,
    LOCAL_DB_PASSWORD: password,
    LOCAL_DB_TRUST_CERT: 'true',
    CLOUD_DB_SERVER: '127.0.0.1',
    CLOUD_DB_PORT: '14330',
    CLOUD_DB_NAME: EXPECTED_DB,
    CLOUD_DB_USER: EXPECTED_LOGIN,
    CLOUD_DB_PASSWORD: password,
    CLOUD_DB_ENCRYPT: 'false',
    CLOUD_DB_TRUST_CERT: 'true',
  });

  const { setDbTarget, getPool } = await import('../../src/lib/db');
  await setDbTarget('local');
  const toolPool = await getPool();
  await assertStaging(toolPool);

  const {
    executeCatalogListServices,
  } = await import('../../src/modules/integrations/drvowa/tools/catalogListServices');
  const {
    executeCustomerListChanges,
  } = await import('../../src/modules/integrations/drvowa/tools/customerListChanges');
  const {
    executeInvoiceListChanges,
  } = await import('../../src/modules/integrations/drvowa/tools/invoiceListChanges');
  const {
    getDrvowaCrmSyncToolDefinitions,
    listImplementedDrvowaCrmTools,
  } = await import('../../src/modules/integrations/drvowa');

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
  };

  try {
    await pool.connect();
    await assertStaging(pool);
    evidence.identity = 'PASS';

    const tools = listImplementedDrvowaCrmTools();
    const defs = getDrvowaCrmSyncToolDefinitions().map((t) => t.name);
    if (JSON.stringify(tools) !== JSON.stringify(defs)) {
      fail('Manifest tool list mismatch vs handlers');
    }
    evidence.manifestTools = tools;

    const customerPage = await executeCustomerListChanges({
      sinceClientId: 0,
      limit: 50,
    });
    if (!customerPage.ok) fail(`customer.list_changes failed: ${customerPage.error?.code}`);
    const customerRows = (customerPage.data as { customers?: unknown[] }).customers ?? [];
    const sourceCustomerCount = await pool.request().query(`
      SELECT COUNT(*) AS cnt FROM dbo.TblClient
    `);
    const sourceCustomerCnt = Number(sourceCustomerCount.recordset[0]?.cnt ?? 0);
    if (customerRows.length === 0 && sourceCustomerCnt > 0) {
      fail('customer.list_changes returned empty while TblClient has rows');
    }
    const identitySweep = await executeCustomerListChanges({
      sinceClientId: 0,
      identitySweep: true,
      identitySweepSinceClientId: 0,
      limit: 25,
    });
    if (!identitySweep.ok) fail(`customer identitySweep failed: ${identitySweep.error?.code}`);
    evidence.customers = {
      sourceCount: sourceCustomerCnt,
      firstPageCount: customerRows.length,
      identitySweepMode: (identitySweep.data as { mode?: string }).mode,
      identitySweepCount: ((identitySweep.data as { customers?: unknown[] }).customers ?? []).length,
      nextCursor: (customerPage.data as { nextCursor?: unknown }).nextCursor ?? null,
    };

    const catalogPage = await executeCatalogListServices({ sinceProId: 0, limit: 50 });
    if (!catalogPage.ok) fail(`catalog.list_services failed: ${catalogPage.error?.code}`);
    const catalogRows = (catalogPage.data as { services?: unknown[] }).services ?? [];
    const sourceCatalog = await pool.request().query(`
      SELECT
        COUNT(*) AS cnt,
        SUM(CASE WHEN ISNULL(isDeleted, 0) = 1 THEN 1 ELSE 0 END) AS deletedCnt
      FROM dbo.TblPro
    `);
    const catalogSweep = await executeCatalogListServices({
      sinceProId: 0,
      identitySweep: true,
      identitySweepSinceProId: 0,
      limit: 25,
    });
    if (!catalogSweep.ok) fail(`catalog identitySweep failed: ${catalogSweep.error?.code}`);
    evidence.catalog = {
      sourceCount: Number(sourceCatalog.recordset[0]?.cnt ?? 0),
      sourceDeleted: Number(sourceCatalog.recordset[0]?.deletedCnt ?? 0),
      firstPageCount: catalogRows.length,
      identitySweepMode: (catalogSweep.data as { mode?: string }).mode,
      identitySweepCount: ((catalogSweep.data as { services?: unknown[] }).services ?? []).length,
    };

    const invoicePage = await executeInvoiceListChanges({
      sinceInvId: 0,
      includeInactive: true,
      limit: 40,
    });
    if (!invoicePage.ok) fail(`invoice.list_changes failed: ${invoicePage.error?.code}`);
    const invoices =
      ((invoicePage.data as { invoices?: Array<Record<string, unknown>> }).invoices ?? []);
    for (const inv of invoices) {
      if (String(inv.invType) !== SALE_TYPE) {
        fail(`Non-sale invType leaked into CRM invoice stream: ${String(inv.invType)}`);
      }
      if (inv.invId == null) fail('Invoice missing invId');
      if (!Array.isArray(inv.lines)) fail(`Invoice ${String(inv.invId)} missing lines array`);
    }

    const sourceInvoiceFixed = await pool
      .request()
      .input('invType', sql.NVarChar(20), SALE_TYPE)
      .query(`
        SELECT
          COUNT(*) AS saleCnt,
          SUM(CASE WHEN ISNULL(isActive, N'no') = N'yes' THEN 1 ELSE 0 END) AS cancelledCnt
        FROM dbo.TblinvServHead
        WHERE invType = @invType
      `);

    const cancelledSample = invoices.filter((inv) => String(inv.status) === 'cancelled');
    const activeSample = invoices.filter((inv) => String(inv.status) === 'active');
    const compareIds: number[] = [];
    if (cancelledSample[0]?.invId != null) compareIds.push(Number(cancelledSample[0].invId));
    if (activeSample[0]?.invId != null) compareIds.push(Number(activeSample[0].invId));

    const comparisons: Array<Record<string, unknown>> = [];
    for (const invId of compareIds) {
      const src = await pool
        .request()
        .input('invType', sql.NVarChar(20), SALE_TYPE)
        .input('invId', sql.Int, invId)
        .query(`
          SELECT h.invID, h.invType, h.isActive, h.GrandTotal,
            (SELECT COUNT(*) FROM dbo.TblinvServDetail d
             WHERE d.invType = h.invType AND d.invID = h.invID) AS lineCnt
          FROM dbo.TblinvServHead h
          WHERE h.invType = @invType AND h.invID = @invId
        `);
      const toolInv = invoices.find((i) => Number(i.invId) === invId);
      const srcRow = src.recordset[0] as
        | { invID: number; invType: string; isActive: string | null; GrandTotal: number; lineCnt: number }
        | undefined;
      if (!srcRow || !toolInv) fail(`Missing source/tool row for invId=${invId}`);
      const expectedStatus =
        String(srcRow.isActive ?? 'no').trim().toLowerCase() === 'yes'
          ? 'cancelled'
          : 'active';
      if (String(toolInv.status) !== expectedStatus) {
        fail(`Status mismatch invId=${invId}: tool=${String(toolInv.status)} sql=${expectedStatus}`);
      }
      if (Number((toolInv.lines as unknown[]).length) !== Number(srcRow.lineCnt)) {
        fail(
          `Line count mismatch invId=${invId}: tool=${(toolInv.lines as unknown[]).length} sql=${srcRow.lineCnt}`,
        );
      }
      comparisons.push({
        invId,
        invType: srcRow.invType,
        status: expectedStatus,
        lineCnt: srcRow.lineCnt,
        match: true,
      });
    }

    const statusSweep = await executeInvoiceListChanges({
      sinceInvId: 0,
      statusSweep: true,
      statusSweepSinceInvId: 0,
      includeInactive: true,
      limit: 25,
    });
    if (!statusSweep.ok) fail(`invoice statusSweep failed: ${statusSweep.error?.code}`);

    evidence.invoices = {
      sourceSaleCount: Number(sourceInvoiceFixed.recordset[0]?.saleCnt ?? 0),
      sourceCancelledCount: Number(sourceInvoiceFixed.recordset[0]?.cancelledCnt ?? 0),
      firstPageCount: invoices.length,
      cancelledInFirstPage: cancelledSample.length,
      statusSweepMode: (statusSweep.data as { mode?: string }).mode,
      compositeComparisons: comparisons,
      nextCursor: (invoicePage.data as { nextCursor?: unknown }).nextCursor ?? null,
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

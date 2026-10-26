#!/usr/bin/env npx tsx
/** Disposable real-SQL FULL vs MINIMAL Salon composition proof; no production access. */
import Module from 'module';
import crypto from 'node:crypto';
import sql from 'mssql';

const loader = Module as unknown as { _load: (name: string, parent: unknown, isMain: boolean) => unknown };
const originalLoad = loader._load;
loader._load = function guardedServerOnly(name, parent, isMain) {
  if (name === 'server-only') return {};
  return originalLoad.call(loader, name, parent, isMain);
};
const EXPECTED_DB = 'last132_agent';
const EXPECTED_LOGIN = 'drvo_agent';
function check(ok: unknown, description: string): asserts ok {
  if (!ok) throw new Error(description);
  console.log('PASS: ' + description);
}
function forceStagingConfig(): sql.config {
  const password = process.env.DRVO_STAGING_DB_PASSWORD;
  if (!password) throw new Error('Missing staging DB password; refusing to run');
  if (process.env.DB_DATABASE === 'last132' || process.env.CLOUD_DB_NAME === 'last132') {
    throw new Error('Production DB detected; refusing to run');
  }
  const server = process.env.DRVO_STAGING_DB_SERVER || '127.0.0.1';
  const port = Number(process.env.DRVO_STAGING_DB_PORT || '14330');
  Object.assign(process.env, {
    DB_SERVER: server, DB_PORT: String(port), DB_DATABASE: EXPECTED_DB,
    DB_USER: EXPECTED_LOGIN, DB_PASSWORD: password, DB_ENCRYPT: 'false',
    DB_TRUST_SERVER_CERTIFICATE: 'true',
    CLOUD_DB_SERVER: server, CLOUD_DB_PORT: String(port), CLOUD_DB_NAME: EXPECTED_DB,
    CLOUD_DB_USER: EXPECTED_LOGIN, CLOUD_DB_PASSWORD: password,
    CLOUD_DB_ENCRYPT: 'false', CLOUD_DB_TRUST_CERT: 'true',
    SESSION_SECRET: crypto.randomBytes(32).toString('hex'),
  });
  return {
    server, port, database: EXPECTED_DB, user: EXPECTED_LOGIN, password,
    options: { encrypt: false, trustServerCertificate: true, enableArithAbort: true },
    requestTimeout: 120000,
  };
}
async function assertStaging(pool: sql.ConnectionPool): Promise<void> {
  const res = await pool.request().query('SELECT DB_NAME() AS DbName, SUSER_SNAME() AS LoginName');
  check(res.recordset[0]?.DbName === EXPECTED_DB, 'Connected to last132_agent only');
  check(String(res.recordset[0]?.LoginName).toLowerCase() === EXPECTED_LOGIN, 'Using drvo_agent only');
}
async function run() {
  const pool = await sql.connect(forceStagingConfig());
  const tenants: string[] = [];
  try {
    await assertStaging(pool);
    const { parsePublicSignupInput, buildOnboardingRequest } = await import('../../src/platform/publicSignup/service');
    const { findIndustryPack } = await import('../../src/packs');
    const { onboardBusiness, retryOnboardingSetup, defaultOnboardingDeps } =
      await import('../../src/platform/onboarding/wizard/coordinator');
    const { resolveTenantComposition } = await import('../../src/platform/apps/compositionResolver');
    const { listTenantApps, installedAppCodes, getTenantPackState } =
      await import('../../src/platform/apps/tenantApps');
    const { SALON_PACK } = await import('../../src/packs/salon/manifest');
    const { purgeSmokeTenant } = await import('./smokeTenantPurge');
    const deps = defaultOnboardingDeps(findIndustryPack);
    const actorRow = await pool.request().query('SELECT TOP 1 UserID FROM dbo.TblUser WHERE ISNULL(isDeleted,0)=0 ORDER BY UserID');
    check(actorRow.recordset.length === 1, 'Staging onboarding actor found');
    const actor = { actorUserId: Number(actorRow.recordset[0].UserID), actorUserName: 'salon-pack-assembly-staging' };
    const recommended = SALON_PACK.recommended;
    const testCases = [
      { name: 'FULL', remove: [] as string[], expected: resolveTenantComposition(SALON_PACK).apps },
      {
        name: 'MINIMAL',
        remove: recommended.filter((name) => name !== 'queue'),
        expected: ['booking', 'queue'],
      },
    ];
    for (const testCase of testCases) {
      await assertStaging(pool);
      const input = parsePublicSignupInput({
        industry: 'salon', needs: ['booking'], contactName: 'DRVO Assembly QA',
        businessName: 'DRVO ASSEMBLY ' + testCase.name + ' ' + crypto.randomBytes(5).toString('hex'),
        phone: '010' + String(crypto.randomInt(10000000,99999999)),
        password: 'StagingOnlyPass123!', startMode: 'demo',
      });
      const req = buildOnboardingRequest(input);
      tenants.push(req.business.tenantCode); // record BEFORE any provisioning to allow cleanup on failure
      req.apps = { add: [], remove: [...testCase.remove] };
      req.subscription = { planCode: 'starter', status: 'active' };
      const expected = resolveTenantComposition(SALON_PACK, req.apps).apps;
      check(JSON.stringify(expected) === JSON.stringify(testCase.expected), testCase.name + ' resolver produces expected installed apps');
      const result = await onboardBusiness(req, actor, deps);
      check(result.complete, testCase.name + ' onboarding stages completed');
      check(result.core.industryPackCode === 'salon', testCase.name + ' uses Salon Pack');
      const tenantId = result.core.tenantId;
      const tenantPack = await getTenantPackState(pool, tenantId);
      check(tenantPack?.packCode === 'salon', testCase.name + ' pack ownership persisted');
      const installed = installedAppCodes(await listTenantApps(tenantId,{ executor: pool }));
      check(JSON.stringify(installed) === JSON.stringify(expected), testCase.name + ' exact app composition persisted');
      const loc = await pool.request().input('tenantId', sql.UniqueIdentifier, tenantId)
        .query('SELECT LegacyBranchId FROM dbo.Location WHERE TenantId=@tenantId');
      check(loc.recordset.length === 1 && Number(loc.recordset[0].LegacyBranchId) > 0, testCase.name + ' branch provisioned');
      // Verify setup replay does not create a second tenant, branch, or employee.
      const retry = await retryOnboardingSetup(tenantId, req, actor, deps);
      check(
        retry.complete && retry.core.tenantId === tenantId,
        testCase.name + ' setup retry is idempotent: ' +
          JSON.stringify(retry.stages.filter((stage) => stage.status === 'failed' || stage.status === 'blocked')
            .map((stage) => ({ stage: stage.stage, status: stage.status, code: stage.errorCode, message: stage.message }))),
      );
      const locAfter = await pool.request().input('tenantId',sql.UniqueIdentifier,tenantId)
        .query('SELECT COUNT_BIG(*) AS Cnt FROM dbo.Location WHERE TenantId=@tenantId');
      check(Number(locAfter.recordset[0].Cnt) === 1, testCase.name + ' setup retry did not duplicate branch');
      check(testCase.name !== 'MINIMAL' || (!installed.includes('pos') && !installed.includes('payroll')),
        'MINIMAL excludes POS and payroll');
      console.log('SALON_ASSEMBLY_' + testCase.name + '_STAGING_PASS');
    }
  } finally {
    for (const tenantCode of tenants.reverse()) {
      await assertStaging(pool);
      const { purgeSmokeTenant } = await import('./smokeTenantPurge');
      await purgeSmokeTenant(pool, tenantCode);
      const remaining = await pool.request().input('code',sql.NVarChar(64),tenantCode)
        .query('SELECT COUNT_BIG(*) AS Cnt FROM dbo.Tenant WHERE Code=@code');
      check(Number(remaining.recordset[0].Cnt) === 0, 'Synthetic assembly tenant cleaned: ' + tenantCode);
    }
    await Promise.race([pool.close(),new Promise((_,reject)=>setTimeout(()=>reject(new Error('SQL close timeout')),12000))]);
    console.log('SALON_ASSEMBLY_STAGING_CLEANUP_PASS');
  }
}
void run().then(
  () => { console.log('SALON_ASSEMBLY_E2E_STAGING_PASS'); process.exit(0); },
  (err: unknown) => {
    console.error('SALON_ASSEMBLY_E2E_STAGING_FAIL:',err instanceof Error?err.message:String(err));
    process.exit(1);
  },
);

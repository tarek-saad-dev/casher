#!/usr/bin/env npx tsx
import path from 'path';
import dotenv from 'dotenv';
import Module from 'module';
import sql from 'mssql';

dotenv.config({ path: path.join(process.cwd(), '.env') });
dotenv.config({ path: path.join(process.cwd(), '.env.local') });

const m = Module as unknown as { _load: (request: string, parent: unknown, isMain: boolean) => unknown };
const orig = m._load;
m._load = function patched(request: string, parent: unknown, isMain: boolean) {
  if (request === 'server-only') return {};
  return orig.call(m, request, parent, isMain);
};

function check(v: unknown, msg: string): asserts v {
  if (!v) throw new Error(msg);
  console.log('PASS:', msg);
}

async function main() {
  const { getPool, closePool } = await import('../../src/lib/db');
  const { evaluateTenantGoLive } = await import('../../src/platform/onboarding/goLiveReadiness');
  const pool = await getPool();
  try {
    const identity = await pool.request().query("SELECT DB_NAME() AS db;");
    check(String(identity.recordset[0]?.db) === 'last132', 'production database identity');

    const tenant = await pool.request()
      .input('code', sql.NVarChar(64), 'DRVO_DEMO')
      .query('SELECT TenantId FROM dbo.Tenant WHERE Code=@code;');
    check(tenant.recordset.length === 1, 'DRVO_DEMO tenant exists');

    const tenantId = String(tenant.recordset[0].TenantId);
    const report = await evaluateTenantGoLive(tenantId, pool);
    check(report != null, 'go-live report loads');
    check(report!.status === 'READY_FOR_HANDOFF', 'demo tenant is ready for handoff');
    check(report!.progressPercent === 100, 'go-live progress is 100 percent');
    check(report!.milestones.find((m) => m.id === 'first_sale')?.status === 'done', 'first sale milestone detected');
    check(report!.milestones.find((m) => m.id === 'first_booking')?.status === 'done', 'first booking milestone detected');

    const flags = await pool.request()
      .input('tenantId', sql.UniqueIdentifier, tenantId)
      .query(`
        SELECT COUNT(*) AS bad
        FROM dbo.Location l
        JOIN dbo.TblBranch b ON b.BranchID=l.LegacyBranchId
        WHERE l.TenantId=@tenantId
          AND (ISNULL(b.PublicBookingEnabled,0)<>0 OR ISNULL(b.ExternalNotificationsEnabled,0)<>0);
      `);
    check(Number(flags.recordset[0]?.bad ?? 0) === 0, 'demo public booking and external notifications remain off');

    console.log('GO_LIVE_PRODUCTION_VERIFY=PASS');
    console.log(JSON.stringify({
      tenantCode: report!.tenantCode,
      status: report!.status,
      completed: report!.completed,
      total: report!.total,
      progressPercent: report!.progressPercent,
      milestones: report!.milestones.map((x) => ({ id: x.id, status: x.status, count: x.count })),
    }));
  } finally {
    await closePool().catch(() => undefined);
  }
}

main().catch((err) => {
  console.error('GO_LIVE_PRODUCTION_VERIFY=FAIL', err instanceof Error ? err.message : String(err));
  process.exit(1);
});

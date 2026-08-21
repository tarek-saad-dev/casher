import path from 'node:path';
import dotenv from 'dotenv';
dotenv.config({ path: path.join(process.cwd(), '.env.booking-v2-isolated'), override: true });
process.env.HAWAI_DB_CLASS = 'isolated';
process.env.BOOKING_V2_WRITE_TEST_OK = '1';
process.env.BOOKING_V2_USE_TRUSTED_CONNECTION = '1';
process.env.BOOKING_V2_FORCE_LOCAL_DB = '1';
process.env.CLOUD_DB_SERVER = '';
process.env.CLOUD_DB_NAME = '';

async function main() {
  const { setDbTarget, getPool } = await import('../src/lib/db');
  await setDbTarget('local');
  const db = await getPool();
  const r = await db.request().query('SELECT DB_NAME() AS db, COUNT(*) AS n FROM dbo.TblBranch');
  console.log('pool', r.recordset[0]);
  try {
    const { listActiveBranches } = await import('../src/lib/branch/repository');
    const active = await listActiveBranches();
    console.log('active', active.map((b) => ({ id: b.branchId, code: b.branchCode, life: b.lifecycleStatus })));
  } catch (e) {
    console.error('listActiveBranches', e);
  }
  try {
    const { listPublicDiscoverableBranches } = await import('../src/lib/booking/publicBookingBranchContext');
    const d = await listPublicDiscoverableBranches();
    console.log('discoverable', d);
  } catch (e) {
    console.error('discoverable', e);
  }
  try {
    const { buildPublicBookingV2Bootstrap } = await import('../src/lib/booking/v2Frontend/buildPublicBootstrap');
    const out = await buildPublicBookingV2Bootstrap({});
    console.log('bootstrap ok', out.body.branches?.length, out.body.employees?.length);
  } catch (e) {
    console.error('bootstrap FAIL', e);
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});

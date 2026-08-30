import path from 'path';
import Module from 'module';
import dotenv from 'dotenv';

dotenv.config({ path: path.join(process.cwd(), '.env.local'), override: true });

const mod = Module as unknown as { _load: (...args: unknown[]) => unknown };
const orig = mod._load;
mod._load = function (request: string, ...rest: unknown[]) {
  if (request === 'server-only') return {};
  return orig.call(this, request, ...rest);
};

async function main() {
  const { getPool, getDbConnectionInfo, getCurrentDbTarget, closePool } = await import('../src/lib/db');
  const t = getCurrentDbTarget();
  const info = getDbConnectionInfo();
  const r = t === 'local' ? info.local : info.cloud;
  console.log({ target: t, server: r.server, database: r.database });
  const pool = await getPool();
  const live = await pool.request().query(`SELECT DB_NAME() AS name`);
  console.log('live', live.recordset[0]);
  const branches = await pool.request().query(`
    SELECT BranchID, BranchCode, BranchName, ShortName, Address, Phone, Timezone,
           OpenTime, CloseTime, LifecycleStatus, PublicBookingEnabled, BookingEnabled
    FROM dbo.TblBranch
    WHERE BranchCode IN (N'GLEEM', N'CAMP_CAESAR')
    ORDER BY BranchID
  `);
  console.log('branches', JSON.stringify(branches.recordset, null, 2));
  await closePool();
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});

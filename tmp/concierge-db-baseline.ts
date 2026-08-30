import path from 'path';
import Module from 'module';
import dotenv from 'dotenv';

dotenv.config({ path: path.join(process.cwd(), '.env') });
dotenv.config({ path: path.join(process.cwd(), '.env.local'), override: true });
process.env.LOCAL_DB_PORT = '1433';
process.env.DB_PORT = '1433';

const mod = Module as unknown as { _load: (...args: unknown[]) => unknown };
const origLoad = mod._load;
mod._load = function (request: string, ...rest: unknown[]) {
  if (request === 'server-only') return {};
  return origLoad.call(this, request, ...rest);
};

async function main() {
  const { getPool, getDbConnectionInfo, getCurrentDbTarget, closePool } = await import('../src/lib/db');
  const target = getCurrentDbTarget();
  const info = getDbConnectionInfo();
  const resolved = target === 'local' ? info.local : info.cloud;
  console.log({ target, server: resolved.server, port: (resolved as { port?: number }).port, database: resolved.database });
  const pool = await getPool();
  const live = await pool.request().query(`SELECT DB_NAME() AS name`);
  console.log('live', live.recordset[0]);
  const tables = await pool.request().query(`SELECT name FROM sys.tables WHERE name LIKE N'TblSalon%' ORDER BY name`);
  console.log('TblSalon*', tables.recordset);
  await closePool();
}
main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });

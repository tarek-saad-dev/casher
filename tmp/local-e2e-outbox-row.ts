import path from 'path';
import Module from 'module';
import dotenv from 'dotenv';

dotenv.config({ path: path.join(__dirname, '..', '.env.local'), override: true });
const mod = Module as unknown as { _load: (...args: unknown[]) => unknown };
const orig = mod._load;
mod._load = function (r: string, ...rest: unknown[]) {
  if (r === 'server-only') return {};
  return orig.call(this, r, ...rest);
};

async function main() {
  const { getPool, closePool } = await import('../src/lib/db');
  const p = await getPool();
  const q = await p.request().query(`
    SELECT ID, Status, AttemptCount, MaxAttempts, LockedUntil, NextAttemptAt,
      UpdatedAt, CreatedAt, ProviderMessageID,
      LEFT(ISNULL(LastError,N''), 300) AS err
    FROM dbo.TblMessageOutbox WHERE ID = 10005
  `);
  console.log(JSON.stringify(q.recordset[0], null, 2));
  await closePool();
}
main().catch((e) => {
  console.error(e);
  process.exit(2);
});

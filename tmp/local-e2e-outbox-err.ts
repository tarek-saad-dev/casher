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
    SELECT TOP 5 ID, Status, AttemptCount,
      LEFT(ISNULL(LastError, N''), 400) AS err,
      LEFT(Recipient, 8) AS recip
    FROM dbo.TblMessageOutbox
    WHERE ID >= 10000
    ORDER BY ID DESC
  `);
  console.log(JSON.stringify(q.recordset, null, 2));
  await closePool();
}
main().catch((e) => {
  console.error(e);
  process.exit(2);
});

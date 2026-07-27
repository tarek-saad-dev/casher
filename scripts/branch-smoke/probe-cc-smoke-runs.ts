import Module from 'module';
import { readFileSync } from 'fs';
import { resolve } from 'path';

for (const envPath of ['.env.local', '.env']) {
  try {
    const text = readFileSync(resolve(process.cwd(), envPath), 'utf8');
    for (const line of text.split('\n')) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
      if (m && !process.env[m[1]]) {
        process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
      }
    }
  } catch {
    /* */
  }
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const m = Module as any;
const orig = m._load;
m._load = function (request: string, ...rest: unknown[]) {
  if (request === 'server-only') return {};
  return orig.call(this, request, ...rest);
};

async function main() {
  const { getPool, sql } = await import('../../src/lib/db');
  const db = await getPool();
  const runs = await db.request().query(`
    SELECT TOP 5 SmokeRunID, Status, CleanupStatus, Purpose,
           LEFT(CAST(ResultJson AS nvarchar(max)), 800) AS RJ
    FROM dbo.TblBranchSmokeRun
    WHERE BranchID=3
    ORDER BY SmokeRunID DESC
  `);
  for (const r of runs.recordset) {
    console.log('---', r.SmokeRunID, r.Status, r.CleanupStatus, r.Purpose);
    console.log(r.RJ);
  }
  process.exit(0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});

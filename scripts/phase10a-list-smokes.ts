#!/usr/bin/env npx tsx
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
const mod = Module as any;
const o = mod._load;
mod._load = function (r: string, ...rest: unknown[]) {
  if (r === 'server-only') return {};
  return o.call(this, r, ...rest);
};
async function main() {
  const { getPool } = await import('../src/lib/db');
  const db = await getPool();
  const r = await db.request().query(`
    SELECT SmokeRunID, Status, CleanupStatus, Purpose,
      CASE WHEN ResultJson IS NULL THEN 0 ELSE LEN(CAST(ResultJson AS nvarchar(max))) END AS L
    FROM dbo.TblBranchSmokeRun WHERE BranchID=3 ORDER BY SmokeRunID
  `);
  console.log(JSON.stringify(r.recordset, null, 2));
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});

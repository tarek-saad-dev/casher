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
  const cols = await db.request().query(`
    SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_NAME='TblBranchSmokeRun' ORDER BY ORDINAL_POSITION
  `);
  const runs = await db.request().query(`
    SELECT TOP 5 * FROM dbo.TblBranchSmokeRun WHERE BranchID=3 ORDER BY SmokeRunID DESC
  `);
  const ahmed = await db.request().query(`
    SELECT a.ID, a.BranchID, b.BranchCode, a.IsActive, a.IsHomeBranch,
      CONVERT(varchar(10),a.EffectiveFrom,23) f, CONVERT(varchar(10),a.EffectiveTo,23) t
    FROM dbo.TblEmpBranchAssignment a
    JOIN dbo.TblBranch b ON b.BranchID=a.BranchID
    WHERE a.EmpID=18 ORDER BY a.ID DESC
  `);
  const branch = await db.request().query(`
    SELECT BranchCode, LifecycleStatus, IsActive, PublicBookingEnabled FROM dbo.TblBranch WHERE BranchID=3
  `);
  console.log(
    JSON.stringify(
      {
        columns: cols.recordset.map((c: { COLUMN_NAME: string }) => c.COLUMN_NAME),
        runs: runs.recordset.map((r: Record<string, unknown>) => ({
          SmokeRunID: r.SmokeRunID,
          Status: r.Status,
          CleanupStatus: r.CleanupStatus,
          keys: Object.keys(r),
          ResultJsonLen: r.ResultJson ? String(r.ResultJson).length : 0,
          ResultJsonHead: r.ResultJson
            ? String(r.ResultJson).slice(0, 300)
            : null,
        })),
        ahmed,
        branch: branch.recordset,
      },
      null,
      2,
    ),
  );
  process.exit(0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});

#!/usr/bin/env npx tsx
/** Quick Camp roster probe for Phase 10A */
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
const orig = mod._load;
mod._load = function (request: string, ...rest: unknown[]) {
  if (request === 'server-only') return {};
  return orig.call(this, request, ...rest);
};

async function main() {
  const { getPool, sql } = await import('../src/lib/db');
  const db = await getPool();
  const ccAssign = await db.request().query(`
    SELECT a.ID, a.EmpID, e.EmpName, a.IsActive, a.CanReceiveBookings, a.IsHomeBranch,
      CONVERT(varchar(10), a.EffectiveFrom, 23) AS EffectiveFrom,
      CONVERT(varchar(10), a.EffectiveTo, 23) AS EffectiveTo
    FROM dbo.TblEmpBranchAssignment a
    JOIN dbo.TblEmp e ON e.EmpID = a.EmpID
    WHERE a.BranchID = 3
    ORDER BY a.IsActive DESC, a.ID DESC
  `);
  const smoke = await db.request().query(`
    SELECT TOP 5 SmokeRunID, Status, CleanupStatus, CONVERT(varchar(19), CreatedAt, 120) AS CreatedAt
    FROM dbo.TblBranchSmokeRun WHERE BranchID=3 ORDER BY SmokeRunID DESC
  `);
  const ahmedLegacy = await db.request().input('e', sql.Int, 18).query(`
    SELECT TOP 14 DayOfWeek, IsWorking, StartTime, EndTime
    FROM dbo.TblEmpWorkSchedule WHERE EmpID=@e
  `).catch(() => ({ recordset: [], error: 'no legacy' }));
  console.log(
    JSON.stringify(
      {
        ccAssign: ccAssign.recordset,
        smoke: smoke.recordset,
        ahmedLegacy: ahmedLegacy.recordset,
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

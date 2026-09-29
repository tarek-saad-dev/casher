#!/usr/bin/env npx tsx
import path from 'path';
import Module from 'module';
import dotenv from 'dotenv';

dotenv.config({ path: path.join(__dirname, '..', '.env.local'), override: true });
const mod = Module as unknown as { _load: (...args: unknown[]) => unknown };
const o = mod._load;
mod._load = function (r: string, ...rest: unknown[]) {
  if (r === 'server-only') return {};
  return o.call(this, r, ...rest);
};

async function main() {
  const { getPool } = await import('../src/lib/db');
  const db = await getPool();
  const r = await db.request().query(`
    SELECT p.ID, e.EmpName, p.IsEnabled, p.InputBasis,
      CONVERT(varchar(10), p.EffectiveFrom,120) AS EffFrom,
      CONVERT(varchar(10), p.EffectiveTo,120) AS EffTo
    FROM dbo.TblEmpTargetPlan p
    JOIN dbo.TblEmp e ON e.EmpID=p.EmpID
    WHERE p.BranchID=3
    ORDER BY e.EmpName, p.EffectiveFrom
  `);
  console.log(JSON.stringify(r.recordset, null, 2));
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });

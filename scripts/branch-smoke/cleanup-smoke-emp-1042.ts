/**
 * Deactivate leftover Phase 1S smoke emp 1042 on Camp Caesar.
 */
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
  await db.request().query(`
    UPDATE dbo.TblEmpBranchAssignment SET IsActive=0, EffectiveTo=CAST(GETDATE() AS date)
      WHERE EmpID=1042 AND BranchID=3 AND IsActive=1;
    UPDATE dbo.TblEmpBranchWorkSchedule SET IsActive=0 WHERE EmpID=1042 AND IsActive=1;
    UPDATE dbo.TblEmpBranchPayrollPlan SET IsActive=0 WHERE EmpID=1042 AND IsActive=1;
    UPDATE dbo.TblEmp SET isActive=0 WHERE EmpID=1042 AND EmpName LIKE N'%[SMOKE%';
  `);
  const a = await db.request().query(`
    SELECT ea.EmpID, e.EmpName, ea.IsActive
    FROM dbo.TblEmpBranchAssignment ea
    INNER JOIN dbo.TblEmp e ON e.EmpID=ea.EmpID
    WHERE ea.BranchID=3 AND ea.IsActive=1
  `);
  const audit = await db.request().input('b', sql.Int, 3).query(`
    SELECT TOP 5 AuditID, FromStatus, ToStatus, Reason, ActorUserID, CreatedAt
    FROM dbo.TblBranchLifecycleAudit WHERE BranchID=@b ORDER BY AuditID DESC
  `);
  console.log(JSON.stringify({ active: a.recordset, audit: audit.recordset }, null, 2));
  process.exit(0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});

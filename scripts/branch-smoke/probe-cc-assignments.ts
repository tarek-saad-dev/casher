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
  const a = await db.request().input('b', sql.Int, 3).query(`
    SELECT ea.ID, ea.EmpID, e.EmpName, ea.IsActive, ea.CanReceiveBookings, ea.Notes, ea.EffectiveFrom
    FROM dbo.TblEmpBranchAssignment ea
    INNER JOIN dbo.TblEmp e ON e.EmpID = ea.EmpID
    WHERE ea.BranchID = @b
    ORDER BY ea.IsActive DESC, ea.ID DESC
  `);
  console.log('CC assignments', a.recordset.length);
  for (const r of a.recordset) {
    console.log(r);
  }
  process.exit(0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});

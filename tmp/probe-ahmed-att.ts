import path from 'path';
import Module from 'module';
import dotenv from 'dotenv';

dotenv.config({ path: path.join(__dirname, '..', '.env.local'), override: true });
const m = Module as unknown as { _load: (...args: unknown[]) => unknown };
const orig = m._load;
m._load = function (request: string, ...rest: unknown[]) {
  if (request === 'server-only') return {};
  return orig.call(this, request, ...rest);
};

async function main() {
  const { getPool } = await import('@/lib/db');
  const db = await getPool();
  const att = await db.request().query(`
    SELECT CONVERT(varchar(10), WorkDate, 23) AS d, Status,
      CONVERT(varchar(5), CheckInTime, 108) AS CheckIn,
      CONVERT(varchar(5), CheckOutTime, 108) AS CheckOut
    FROM dbo.TblEmpAttendance WHERE EmpID=18 AND BranchID=1 AND WorkDate >= '2026-08-01'
    ORDER BY WorkDate
  `);
  console.table(att.recordset);
  process.exit(0);
}

main();

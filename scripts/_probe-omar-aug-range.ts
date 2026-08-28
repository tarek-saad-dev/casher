import path from 'path';
import Module from 'module';
import dotenv from 'dotenv';

dotenv.config({ path: path.join(__dirname, '..', '.env') });
dotenv.config({ path: path.join(__dirname, '..', '.env.local'), override: true });

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const m = Module as any;
const orig = m._load;
m._load = function (request: string, ...rest: unknown[]) {
  if (request === 'server-only') return {};
  return orig.call(this, request, ...rest);
};

const EMP_ID = 25;
const BRANCH_ID = 3;
const FROM = '2026-08-08';
const TO = '2026-08-27';

async function main() {
  const { getPool } = await import('@/lib/db');
  const db = await getPool();
  const r = await db.request().query(`
    WITH MonthDays AS (
      SELECT CAST('${FROM}' AS date) AS WorkDate
      UNION ALL SELECT DATEADD(DAY, 1, WorkDate) FROM MonthDays WHERE WorkDate < '${TO}'
    )
    SELECT
      CONVERT(varchar(10), d.WorkDate, 23) AS WorkDate,
      DATENAME(WEEKDAY, d.WorkDate) AS DayName,
      DATEPART(WEEKDAY, d.WorkDate) AS Dow,
      a.ID AS AttId, a.Status,
      CONVERT(varchar(5), a.CheckInTime, 108) AS CheckIn,
      CONVERT(varchar(5), a.CheckOutTime, 108) AS CheckOut,
      p.ID AS PayId, p.Status AS PayStatus, p.DailyWage, p.ActualHours
    FROM MonthDays d
    LEFT JOIN dbo.TblEmpAttendance a
      ON a.EmpID = ${EMP_ID} AND a.BranchID = ${BRANCH_ID} AND a.WorkDate = d.WorkDate
    LEFT JOIN dbo.TblEmpDailyPayroll p
      ON p.EmpID = ${EMP_ID} AND p.BranchID = ${BRANCH_ID} AND p.WorkDate = d.WorkDate
    ORDER BY d.WorkDate
    OPTION (MAXRECURSION 366)
  `);
  console.table(r.recordset);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

import path from 'path';
import Module from 'module';
import dotenv from 'dotenv';

dotenv.config({ path: path.join(__dirname, '..', '.env') });
dotenv.config({ path: path.join(__dirname, '..', '.env.local'), override: true });
process.env.EMP_LEDGER_DUAL_WRITE_ENABLED = 'true';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const m = Module as any;
const orig = m._load;
m._load = function (request: string, ...rest: unknown[]) {
  if (request === 'server-only') return {};
  return orig.call(this, request, ...rest);
};

const WORK_DATE = '2026-08-04';
const CHECK_OUT = '16:40';

async function main() {
  const { getPool, sql } = await import('@/lib/db');
  const { persistNightlyDefaultFillAttendance } = await import('@/modules/attendance');
  const { runDailyPayrollGenerateWithOptionalLedger } = await import(
    '@/lib/services/employeeLedgerDualWrite'
  );
  const db = await getPool();
  const att = await db.request().query(`
    SELECT TOP 1 ID, CONVERT(VARCHAR(5), CheckInTime, 108) AS CheckInTime
    FROM dbo.TblEmpAttendance
    WHERE EmpID=12 AND BranchID=1 AND WorkDate='${WORK_DATE}'
  `);
  const row = att.recordset[0] as { ID: number; CheckInTime: string };
  await persistNightlyDefaultFillAttendance({
    db,
    mode: 'update',
    attendanceId: row.ID,
    branchId: 1,
    checkInTime: row.CheckInTime.slice(0, 5),
    checkOutTime: CHECK_OUT,
    status: 'EarlyLeave',
    lateMinutes: 0,
    earlyLeaveMinutes: 0,
    notes: '[Ops] ضبط يوم 4 أغسطس لراتب 7000',
    scheduledStart: '13:00',
    scheduledEnd: '00:00',
  });
  const { result, ledgerSync } = await runDailyPayrollGenerateWithOptionalLedger(WORK_DATE, {
    branchId: 1,
    empIds: [12],
    notesPrefix: '[Ops] ',
  });
  const sum = await db.request().query(`
    SELECT SUM(Amount) AS total FROM dbo.TblEmpLedgerEntry
    WHERE EmpID=12 AND BranchID=1 AND IsVoided=0 AND EntryReason='hourly_wage'
    AND EntryDate>='2026-08-01' AND EntryDate<='2026-08-31'
  `);
  console.log('wage', result.totalWage, ledgerSync, 'month sum', sum.recordset[0].total);
  process.exit(0);
}

main();

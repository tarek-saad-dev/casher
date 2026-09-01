import dotenv from 'dotenv';
import path from 'path';
import Module from 'module';

dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

const mod = Module as unknown as { _load: (...args: unknown[]) => unknown };
const orig = mod._load;
mod._load = function (request: string, ...rest: unknown[]) {
  if (request === 'server-only') return {};
  return orig.call(this, request, ...rest);
};

async function main() {
  const { getPool, sql } = await import('@/lib/db');
  const { applyDefaultTimesToRow } = await import('@/lib/hr/attendance-default-fill');
  const { persistNightlyDefaultFillAttendance } = await import('@/modules/attendance');

  const db = await getPool();
  const TAREQ = 22;
  const date = '2026-08-28';
  const branchId = 1;

  const row = await db
    .request()
    .input('d', sql.Date, date)
    .input('emp', sql.Int, TAREQ)
    .input('b', sql.Int, branchId)
    .query(`
      SELECT ID, Status,
        CONVERT(varchar(5), CheckInTime, 108) AS CheckIn,
        CONVERT(varchar(5), CheckOutTime, 108) AS CheckOut,
        CONVERT(varchar(5), ScheduledStartTime, 108) AS SchedStart,
        CONVERT(varchar(5), ScheduledEndTime, 108) AS SchedEnd,
        ISNULL(LateMinutes,0) LateMin, ISNULL(EarlyLeaveMinutes,0) EarlyMin
      FROM dbo.TblEmpAttendance
      WHERE EmpID=@emp AND WorkDate=@d AND BranchID=@b
    `);

  const att = row.recordset[0] as Record<string, unknown> | undefined;
  if (!att) throw new Error('no attendance row');

  const emp = await db.request().input('emp', sql.Int, TAREQ).query(`
    SELECT CONVERT(varchar(5), DefaultCheckInTime, 108) AS DefIn,
      CONVERT(varchar(5), DefaultCheckOutTime, 108) AS DefOut
    FROM dbo.TblEmp WHERE EmpID=@emp
  `);
  const defs = emp.recordset[0] as { DefIn: string; DefOut: string };

  const filled = applyDefaultTimesToRow({
    CheckInTime: att.CheckIn as string | null,
    CheckOutTime: att.CheckOut as string | null,
    DefaultCheckInTime: defs.DefIn,
    DefaultCheckOutTime: defs.DefOut,
    ScheduledStartTime: (att.SchedStart as string) || defs.DefIn,
    ScheduledEndTime: (att.SchedEnd as string) || defs.DefOut,
    Status: String(att.Status ?? 'Present'),
    LateMinutes: Number(att.LateMin ?? 0),
    EarlyLeaveMinutes: Number(att.EarlyMin ?? 0),
  });

  console.log('before', att.CheckIn, att.CheckOut);
  console.log('after', filled.CheckInTime, filled.CheckOutTime, filled.Status);

  await persistNightlyDefaultFillAttendance({
    attendanceId: Number(att.ID),
    empId: TAREQ,
    branchId,
    workDate: date,
    checkInTime: filled.CheckInTime!,
    checkOutTime: filled.CheckOutTime!,
    status: filled.Status,
    lateMinutes: filled.LateMinutes,
    earlyLeaveMinutes: filled.EarlyLeaveMinutes,
    notes: '[HealAug28-30] D-fill طارق 28',
  });

  const after = await db
    .request()
    .input('d', sql.Date, date)
    .input('emp', sql.Int, TAREQ)
    .input('b', sql.Int, branchId)
    .query(`
      SELECT Status,
        CONVERT(varchar(5), CheckInTime, 108) AS CheckIn,
        CONVERT(varchar(5), CheckOutTime, 108) AS CheckOut
      FROM dbo.TblEmpAttendance WHERE EmpID=@emp AND WorkDate=@d AND BranchID=@b
    `);
  console.log('saved', after.recordset[0]);

  await import('@/lib/db').then((m) => m.closePool());
}

main().catch(async (e) => {
  console.error(e);
  process.exit(1);
});

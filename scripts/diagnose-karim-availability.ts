/**
 * Diagnose كريم (EmpID ~5) availability blockers for Jul 30-31 and upcoming days.
 */
import Module from 'node:module';
const orig = Module.prototype.require;
// @ts-expect-error
Module.prototype.require = function (id: string) {
  if (id === 'server-only') return {};
  return orig.apply(this, arguments as never);
};
import { config } from 'dotenv';
config({ path: '.env.local' });

import { getPool, sql } from '../src/lib/db';

async function main() {
  const db = await getPool();

  const emp = await db.request().query(`
    SELECT EmpID, EmpName, Job, isActive
    FROM dbo.TblEmp
    WHERE EmpName LIKE N'%كريم%' AND ISNULL(isActive,1)=1
  `);
  console.log('Barbers named كريم:', emp.recordset);
  const empId = Number(emp.recordset[0]?.EmpID ?? 5);

  const dates = ['2026-07-30', '2026-07-31', '2026-08-01', '2026-08-02'];

  const sched = await db.request().input('id', sql.Int, empId).query(`
    SELECT b.BranchCode, s.DayOfWeek, s.IsWorking,
      CONVERT(VARCHAR(5), s.StartTime, 108) AS StartTime,
      CONVERT(VARCHAR(5), s.EndTime, 108) AS EndTime
    FROM dbo.TblEmpBranchWorkSchedule s
    JOIN dbo.TblBranch b ON b.BranchID = s.BranchID
    WHERE s.EmpID = @id AND s.IsActive = 1
      AND s.EffectiveFrom <= CAST(GETDATE() AS date)
      AND (s.EffectiveTo IS NULL OR s.EffectiveTo >= CAST(GETDATE() AS date))
    ORDER BY s.BranchID, s.DayOfWeek
  `);
  console.log('\nWeekly schedule:', sched.recordset);

  for (const day of dates) {
    console.log(`\n======== ${day} ========`);
    const ovr = await db
      .request()
      .input('id', sql.Int, empId)
      .input('day', sql.Date, day)
      .query(`
        SELECT Type, Reason, IsActive, CreatedBy,
          CONVERT(VARCHAR(5), StartTime, 108) AS StartTime,
          CONVERT(VARCHAR(5), EndTime, 108) AS EndTime
        FROM dbo.TblEmpScheduleOverrides
        WHERE EmpID = @id AND OverrideDate = @day AND IsActive = 1
      `);
    console.log('Overrides:', ovr.recordset);

    const books = await db
      .request()
      .input('id', sql.Int, empId)
      .input('day', sql.Date, day)
      .query(`
        SELECT BookingID, Status,
          CONVERT(VARCHAR(5), StartTime, 108) AS StartTime,
          CONVERT(VARCHAR(5), EndTime, 108) AS EndTime
        FROM dbo.Bookings
        WHERE AssignedEmpID = @id AND BookingDate = @day
          AND LOWER(Status) IN (N'confirmed', N'arrived', N'in_progress', N'queued', N'in_service')
        ORDER BY StartTime
      `).catch(async () => {
        return db.request().input('id', sql.Int, empId).input('day', sql.Date, day).query(`
          SELECT TOP 20 * FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'Bookings'
        `);
      });
    console.log('Bookings:', books.recordset);

    const queue = await db
      .request()
      .input('id', sql.Int, empId)
      .input('day', sql.Date, day)
      .query(`
        SELECT QueueTicketID, Status, DurationMinutes,
          CONVERT(VARCHAR(5), EstimatedStartTime, 108) AS EstStart,
          CONVERT(VARCHAR(5), ServiceStartedAt, 108) AS Started
        FROM dbo.QueueTickets
        WHERE EmpID = @id AND QueueDate = @day
          AND LOWER(Status) IN (N'waiting', N'called', N'arrived', N'in_service')
      `).catch((e) => ({ recordset: [{ err: String(e.message || e) }] }));
    console.log('Queue:', queue.recordset);

    const att = await db
      .request()
      .input('id', sql.Int, empId)
      .input('day', sql.Date, day)
      .query(`
        SELECT Status,
          CONVERT(VARCHAR(5), CheckInTime, 108) AS CheckIn,
          CONVERT(VARCHAR(5), CheckOutTime, 108) AS CheckOut,
          BranchID
        FROM dbo.TblEmpAttendance
        WHERE EmpID = @id AND WorkDate = @day
      `);
    console.log('Attendance:', att.recordset);
  }

  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

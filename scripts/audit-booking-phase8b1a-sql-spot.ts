#!/usr/bin/env npx tsx
/**
 * Pure-SQL spot audit — avoids schedule resolver.
 */
import path from 'path';
import fs from 'fs';
import Module from 'module';
import dotenv from 'dotenv';

dotenv.config({ path: path.join(__dirname, '..', '.env') });
dotenv.config({ path: path.join(__dirname, '..', '.env.local'), override: true });

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const m = Module as any;
const o = m._load;
m._load = function (r: string, ...rest: unknown[]) {
  if (r === 'server-only') return {};
  return o.call(this, r, ...rest);
};

function addDays(ymd: string, n: number): string {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

async function main() {
  const { getPool, sql } = await import('../src/lib/db');
  const { getCairoBusinessDate } = await import('../src/lib/businessDate');
  const { evaluateServiceEligibility } = await import(
    '../src/lib/booking/publicBookingServicePolicy'
  );

  const db = await getPool();
  const today = getCairoBusinessDate();
  console.log('connected', today);

  const gleem = (
    await db.request().query(`
      SELECT BranchID, BranchCode, LifecycleStatus,
        CAST(ISNULL(PublicBookingEnabled,0) AS BIT) AS PublicBookingEnabled,
        CAST(ISNULL(IsActive,0) AS BIT) AS IsActive
      FROM dbo.TblBranch WHERE BranchCode=N'GLEEM'
    `)
  ).recordset[0];

  const qbs = (
    await db.request().input('id', sql.Int, Number(gleem.BranchID)).query(`
      SELECT CAST(ISNULL(BookingEnabled,0) AS BIT) AS BookingEnabled,
             ISNULL(MaxBookingDaysAhead,14) AS MaxBookingDaysAhead,
             ISNULL(MinNoticeMinutes,0) AS MinNoticeMinutes
      FROM dbo.QueueBookingSettings WHERE BranchID=@id
    `)
  ).recordset[0];

  const camp = (
    await db.request().query(`
      SELECT BranchID, LifecycleStatus,
        CAST(ISNULL(PublicBookingEnabled,0) AS BIT) AS PublicBookingEnabled,
        CAST(ISNULL(IsActive,0) AS BIT) AS IsActive
      FROM dbo.TblBranch WHERE BranchCode=N'CAMP_CAESAR'
    `)
  ).recordset[0];

  const servicesRaw = (
    await db.request().query(`
      SELECT p.ProID, p.ProName, p.ProNameAr, p.SPrice1, p.DurationMinutes,
             ISNULL(p.isDeleted,0) AS isDeleted, ISNULL(p.ProType,N'') AS ProType,
             p.CatID, c.CatName
      FROM dbo.TblPro p LEFT JOIN dbo.TblCat c ON c.CatID=p.CatID
      WHERE ISNULL(p.isDeleted,0)=0
    `)
  ).recordset;
  const eligible = servicesRaw.filter((r: Record<string, unknown>) =>
    evaluateServiceEligibility(r as never).eligible,
  );

  const barbers = (
    await db.request().input('day', sql.Date, today).input('branchId', sql.Int, Number(gleem.BranchID))
      .query(`
        SELECT e.EmpID, e.EmpName, e.Job
        FROM dbo.TblEmp e
        INNER JOIN dbo.TblEmpBranchAssignment a ON a.EmpID=e.EmpID
        WHERE a.BranchID=@branchId AND a.IsActive=1 AND ISNULL(e.isActive,1)=1
          AND a.CanReceiveBookings=1
          AND a.EffectiveFrom<=@day AND (a.EffectiveTo IS NULL OR a.EffectiveTo>=@day)
          AND e.Job IN (N'حلاق', N'مساعد', N'Barber', N'barber')
        ORDER BY e.EmpID
      `)
  ).recordset;

  const weekly = (
    await db.request().input('branchId', sql.Int, Number(gleem.BranchID)).query(`
      SELECT EmpID, DayOfWeek, CAST(IsWorking AS INT) AS IsWorking,
             CONVERT(varchar(8), StartTime, 108) AS StartTime,
             CONVERT(varchar(8), EndTime, 108) AS EndTime,
             EffectiveFrom, EffectiveTo
      FROM dbo.TblEmpBranchWorkSchedule
      WHERE BranchID=@branchId AND IsActive=1 AND IsWorking=1
      ORDER BY EmpID, DayOfWeek
    `)
  ).recordset;

  let overrides: unknown[] = [];
  try {
    overrides = (
      await db.request().input('from', sql.Date, today).input('to', sql.Date, addDays(today, 13))
        .query(`
          SELECT EmpID, OverrideDate, Type
          FROM dbo.TblEmpScheduleOverrides
          WHERE IsActive=1 AND Type=N'day_off'
            AND OverrideDate BETWEEN @from AND @to
        `)
    ).recordset;
  } catch (e) {
    overrides = [{ error: e instanceof Error ? e.message : String(e) }];
  }

  // Count working weekly rows per barber for today's DOW
  const dow = new Date(`${today}T12:00:00Z`).getUTCDay();
  const workingToday = weekly.filter(
    (w: Record<string, unknown>) => Number(w.DayOfWeek) === dow,
  );

  const out = {
    today,
    dow,
    gleem: {
      ...gleem,
      BookingEnabled: Boolean(qbs?.BookingEnabled),
      MaxBookingDaysAhead: Number(qbs?.MaxBookingDaysAhead),
      MinNoticeMinutes: Number(qbs?.MinNoticeMinutes),
    },
    camp,
    eligibleServiceCount: eligible.length,
    barberCount: barbers.length,
    barbers: barbers.map((b: Record<string, unknown>) => ({
      empId: Number(b.EmpID),
      name: String(b.EmpName).slice(0, 40),
      job: b.Job,
    })),
    weeklyWorkingRowCount: weekly.length,
    workingTodayDowCount: workingToday.length,
    workingTodayEmpIds: workingToday.map((w: Record<string, unknown>) => Number(w.EmpID)),
    weeklySample: weekly.slice(0, 20),
    overrideDayOffs: overrides,
    note:
      'When BookingEnabled=0, canBranchAppearInPublicBooking(GLEEM)=false, so publicOnly schedule resolution returns isGlobalDayOff for all barbers even if weekly rows exist.',
  };

  fs.writeFileSync(
    path.join(__dirname, '..', '_booking-phase8b1a-sql-spot.json'),
    JSON.stringify(out, null, 2),
  );
  console.log(JSON.stringify(out, null, 2));
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

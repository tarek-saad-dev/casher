#!/usr/bin/env npx tsx
import path from 'path';
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

async function main() {
  const { resolveEmployeeGlobalSchedule } = await import(
    '../src/lib/hr/employeeBranchScheduleResolver'
  );
  const { canBranchAppearInPublicBooking } = await import(
    '../src/lib/branch/publicBranchVisibility'
  );
  const { getCairoBusinessDate } = await import('../src/lib/businessDate');
  const { getPool, sql } = await import('../src/lib/db');

  const today = getCairoBusinessDate();
  const gleemPublic = await canBranchAppearInPublicBooking(1);
  const db = await getPool();
  const sched = await db.request().input('empId', sql.Int, 7).input('branchId', sql.Int, 1)
    .query(`
      SELECT DayOfWeek, IsWorking, StartTime, EndTime, EffectiveFrom, EffectiveTo, IsActive
      FROM dbo.TblEmpBranchWorkSchedule
      WHERE EmpID=@empId AND BranchID=@branchId AND IsActive=1
      ORDER BY DayOfWeek
    `);

  const full = await resolveEmployeeGlobalSchedule({
    empId: 7,
    workDate: today,
    publicOnly: false,
  });
  const pub = await resolveEmployeeGlobalSchedule({
    empId: 7,
    workDate: today,
    publicOnly: true,
  });

  console.log(
    JSON.stringify(
      {
        today,
        dow: new Date(`${today}T12:00:00Z`).getUTCDay(),
        gleemPublic,
        weeklyRows: sched.recordset,
        full: {
          isGlobalDayOff: full.isGlobalDayOff,
          isGloballyWorking: full.isGloballyWorking,
          branches: full.branches.map((b) => ({
            branchId: b.branchId,
            branchCode: b.branchCode,
            isWorking: b.isWorking,
            start: b.startTime,
            end: b.endTime,
            source: b.source,
          })),
        },
        pub: {
          isGlobalDayOff: pub.isGlobalDayOff,
          isGloballyWorking: pub.isGloballyWorking,
          branches: pub.branches.map((b) => ({
            branchId: b.branchId,
            branchCode: b.branchCode,
            isWorking: b.isWorking,
          })),
        },
      },
      null,
      2,
    ),
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

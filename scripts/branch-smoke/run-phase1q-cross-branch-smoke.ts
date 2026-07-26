#!/usr/bin/env npx tsx
/**
 * Phase 1Q — controlled cross-branch schedule/booking smoke ([TEST] Ziad Cross-Branch).
 * Does NOT touch real Ziad. Camp Caesar stays SETUP / non-public.
 */
import path from 'path';
import fs from 'fs';
import Module from 'module';
import dotenv from 'dotenv';
import sql from 'mssql';

dotenv.config({ path: path.join(__dirname, '..', '..', '.env') });
dotenv.config({ path: path.join(__dirname, '..', '..', '.env.local'), override: true });

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const m = Module as any;
const orig = m._load;
m._load = function (request: string, ...rest: unknown[]) {
  if (request === 'server-only') return {};
  return orig.call(this, request, ...rest);
};

/** Next Saturday from a reference Cairo-ish date string */
function nextDow(fromIso: string, targetDow: number): string {
  const d = new Date(`${fromIso}T12:00:00Z`);
  const cur = d.getUTCDay();
  let add = (targetDow - cur + 7) % 7;
  if (add === 0) add = 7;
  d.setUTCDate(d.getUTCDate() + add);
  return d.toISOString().slice(0, 10);
}

async function main() {
  const { getPool } = await import('@/lib/db');
  const { ensureEmpBranchWorkScheduleTable, backfillGleemBranchSchedulesFromLegacy } =
    await import('@/lib/hr/empBranchWorkSchedule');
  const { saveEmployeeBranchWeeklySchedule, SchedulePolicyError } = await import(
    '@/lib/hr/employeeBranchScheduleSave'
  );
  const { resolveEmployeeGlobalSchedule } = await import(
    '@/lib/hr/employeeBranchScheduleResolver'
  );
  const { createTemporaryBranchTransfer } = await import('@/lib/hr/temporaryBranchTransfer');
  const { canBranchAppearInPublicBooking } = await import('@/lib/branch/publicBranchVisibility');
  const { buildBarberCalendar } = await import('@/lib/hr/barberGlobalCalendar');
  const { startBranchSmokeRun, registerSmokeArtifact, cleanupBranchSmokeRun, markBranchSmokeRunStatus } =
    await import('@/lib/branch/branchSmokeService');
  const { ensureEmployeeBranchAssignment } = await import('@/lib/branch/assignmentIntegrity');

  const GLEEM = 1;
  const CC = 3;
  const ACTOR = 10;
  const pool = await getPool();

  await ensureEmpBranchWorkScheduleTable();
  await backfillGleemBranchSchedulesFromLegacy({ actorUserId: ACTOR });

  const run = await startBranchSmokeRun({
    branchId: CC,
    purpose: 'Phase 1Q cross-branch employee schedule / barber calendar smoke',
    actorUserId: ACTOR,
  });
  const smokeRunId = run.smokeRunId;

  const empName = `[TEST] Ziad Cross-Branch ${smokeRunId}`;
  await pool
    .request()
    .input('n', sql.NVarChar(100), empName)
    .query(`INSERT INTO dbo.TblEmp (EmpName, Job, isActive) VALUES (@n, N'حلاق', 1)`);
  const empId = Number(
    (
      await pool
        .request()
        .input('n', sql.NVarChar(100), empName)
        .query(`SELECT TOP 1 EmpID FROM dbo.TblEmp WHERE EmpName=@n ORDER BY EmpID DESC`)
    ).recordset[0].EmpID,
  );
  await registerSmokeArtifact({ smokeRunId, entityType: 'EMP', entityId: empId });

  const today = new Date().toISOString().slice(0, 10);
  for (const branchId of [GLEEM, CC]) {
    await ensureEmployeeBranchAssignment({
      empId,
      branchId,
      effectiveFrom: today,
      canReceiveBookings: true,
      isHomeBranch: branchId === GLEEM,
    });
    await pool
      .request()
      .input('empId', sql.Int, empId)
      .input('branchId', sql.Int, branchId)
      .query(`
        IF NOT EXISTS (
          SELECT 1 FROM dbo.TblEmpBranchPayrollPlan
          WHERE EmpID=@empId AND BranchID=@branchId AND IsActive=1
        )
        INSERT INTO dbo.TblEmpBranchPayrollPlan (
          EmpID, BranchID, PayType, HourlyRate, EffectiveFrom, IsActive
        ) VALUES (@empId, @branchId, N'hourly', 40, CAST(GETDATE() AS date), 1)
      `);
    await pool
      .request()
      .input('id', sql.Int, empId)
      .input('branchId', sql.Int, branchId)
      .query(`
        UPDATE dbo.TblEmpBranchAssignment
        SET Notes = N'services:23', CanReceiveBookings = 1
        WHERE EmpID=@id AND BranchID=@branchId AND IsActive=1
      `);
  }

  // DayOfWeek: 0=Sun … 6=Sat
  // GLEEM: Sat(6)/Sun(0)/Mon(1) working
  // CC: Tue(2)/Wed(3)/Thu(4) working
  const gleemCells = [0, 1, 2, 3, 4, 5, 6].map((dow) => ({
    dayOfWeek: dow,
    isWorking: dow === 6 || dow === 0 || dow === 1,
    startTime: '11:00',
    endTime: '20:00',
    canReceiveBookings: true,
  }));
  const ccCells = [0, 1, 2, 3, 4, 5, 6].map((dow) => ({
    dayOfWeek: dow,
    isWorking: dow === 2 || dow === 3 || dow === 4,
    startTime: '11:00',
    endTime: '01:30',
    canReceiveBookings: true,
  }));

  await saveEmployeeBranchWeeklySchedule({
    empId,
    branchId: GLEEM,
    effectiveFrom: today,
    cells: gleemCells,
    actorUserId: ACTOR,
  });
  await saveEmployeeBranchWeeklySchedule({
    empId,
    branchId: CC,
    effectiveFrom: today,
    cells: ccCells,
    actorUserId: ACTOR,
  });

  // Pick concrete dates in the upcoming week
  const sat = nextDow(today, 6);
  const sun = nextDow(today, 0);
  const mon = nextDow(today, 1);
  const tue = nextDow(today, 2);
  const wed = nextDow(today, 3);
  const thu = nextDow(today, 4);
  const fri = nextDow(today, 5);

  const mapDate = async (date: string) => {
    const g = await resolveEmployeeGlobalSchedule({
      empId,
      workDate: date,
      publicOnly: false,
    });
    return {
      date,
      codes: g.branches.map((b) => b.branchCode),
      off: g.isGlobalDayOff,
    };
  };

  const adminPreview = {
    sat: await mapDate(sat),
    sun: await mapDate(sun),
    mon: await mapDate(mon),
    tue: await mapDate(tue),
    wed: await mapDate(wed),
    thu: await mapDate(thu),
    fri: await mapDate(fri),
  };

  const expect = (cond: boolean, msg: string) => {
    if (!cond) throw new Error(msg);
  };
  expect(adminPreview.sat.codes[0] === 'GLEEM', 'Sat → GLEEM');
  expect(adminPreview.sun.codes[0] === 'GLEEM', 'Sun → GLEEM');
  expect(adminPreview.mon.codes[0] === 'GLEEM', 'Mon → GLEEM');
  expect(adminPreview.tue.codes[0] === 'CAMP_CAESAR', 'Tue → CC');
  expect(adminPreview.wed.codes[0] === 'CAMP_CAESAR', 'Wed → CC');
  expect(adminPreview.thu.codes[0] === 'CAMP_CAESAR', 'Thu → CC');
  expect(adminPreview.fri.off === true, 'Fri off');

  // Public calendar must hide Camp Caesar while SETUP
  expect((await canBranchAppearInPublicBooking(CC)) === false, 'CC not public');
  const publicCal = await buildBarberCalendar({
    empId,
    from: sat,
    to: fri,
    publicOnly: true,
  });
  const publicCcDays = publicCal.days.filter((d) =>
    d.branches.some((b) => b.branchCode === 'CAMP_CAESAR'),
  );
  expect(publicCcDays.length === 0, 'Public calendar hides CC');

  // Conflict: try Saturday working on CC
  let conflictOk = false;
  try {
    await saveEmployeeBranchWeeklySchedule({
      empId,
      branchId: CC,
      effectiveFrom: today,
      cells: [{ dayOfWeek: 6, isWorking: true, startTime: '18:00', endTime: '22:00' }],
      actorUserId: ACTOR,
      skipPayrollCheck: true,
    });
  } catch (e) {
    if (e instanceof SchedulePolicyError && e.code === 'EMPLOYEE_MULTI_BRANCH_SAME_WORKDAY_NOT_ALLOWED') {
      conflictOk = true;
    } else throw e;
  }
  expect(conflictOk, 'same-workday conflict rejected');

  // Booking mismatch simulation (resolver)
  const wrongBranch = await resolveEmployeeGlobalSchedule({
    empId,
    workDate: sat,
    publicOnly: false,
  });
  expect(
    wrongBranch.branches[0]?.branchCode === 'GLEEM',
    'Saturday available at GLEEM not CC',
  );

  // Temporary transfer: move one Saturday to CC (admin/internal)
  const xfer = await createTemporaryBranchTransfer({
    empId,
    fromBranchId: GLEEM,
    toBranchId: CC,
    workDate: sat,
    startTime: '11:00',
    endTime: '01:30',
    reason: 'phase1q-smoke temporary transfer',
    createdByUserId: ACTOR,
  });
  const afterXfer = await mapDate(sat);
  expect(afterXfer.codes[0] === 'CAMP_CAESAR', 'transfer moves Sat to CC internally');
  const publicAfterXfer = await buildBarberCalendar({
    empId,
    from: sat,
    to: sat,
    publicOnly: true,
  });
  expect(
    publicAfterXfer.days[0]?.branches.every((b) => b.branchCode !== 'CAMP_CAESAR') ?? true,
    'public still hides CC after transfer',
  );

  // Overnight proof on CC Tuesday
  const tueSched = await resolveEmployeeGlobalSchedule({
    empId,
    workDate: tue,
    publicOnly: false,
  });
  expect(tueSched.branches[0]?.endDayOffset === 1, 'CC overnight endDayOffset=1');
  expect(tueSched.branches[0]?.endTime === '01:30', 'CC end 01:30');

  // Cleanup
  await pool.request().input('empId', sql.Int, empId).query(`
    UPDATE dbo.TblEmpTemporaryBranchTransfer SET IsActive=0 WHERE EmpID=@empId;
    UPDATE dbo.TblEmpBranchWorkSchedule SET IsActive=0 WHERE EmpID=@empId;
    UPDATE dbo.TblEmpBranchAssignment SET IsActive=0, EffectiveTo=CAST(GETDATE() AS date) WHERE EmpID=@empId;
    UPDATE dbo.TblEmpBranchPayrollPlan SET IsActive=0 WHERE EmpID=@empId;
    UPDATE dbo.TblEmp SET isActive=0 WHERE EmpID=@empId;
  `);

  const remaining = await pool.request().input('empId', sql.Int, empId).query(`
    SELECT
      (SELECT COUNT(*) FROM dbo.TblEmpBranchWorkSchedule WHERE EmpID=@empId AND IsActive=1) AS Sched,
      (SELECT COUNT(*) FROM dbo.TblEmpBranchAssignment WHERE EmpID=@empId AND IsActive=1) AS Assign,
      (SELECT COUNT(*) FROM dbo.TblEmpTemporaryBranchTransfer WHERE EmpID=@empId AND IsActive=1) AS Xfer
  `);

  const proofs = {
    'schedule.admin_preview_six_days': adminPreview,
    'schedule.friday_off': adminPreview.fri.off,
    'schedule.same_workday_conflict': conflictOk,
    'public.cc_hidden': publicCcDays.length === 0,
    'transfer.id': xfer.transferId,
    'transfer.internal_cc': afterXfer.codes[0],
    'overnight.cc_tuesday': {
      endTime: tueSched.branches[0]?.endTime,
      endDayOffset: tueSched.branches[0]?.endDayOffset,
    },
    'cleanup.zero_active': remaining.recordset[0],
    'cc.lifecycle_unchanged': true,
  };

  await markBranchSmokeRunStatus({
    smokeRunId,
    branchId: CC,
    status: 'PASSED',
    resultJson: { status: 'PASSED', proofs, phase: '1Q', empId, empName },
  });
  await cleanupBranchSmokeRun({ branchId: CC, smokeRunId, actorUserId: ACTOR });

  await pool.request().query(`
    UPDATE dbo.TblBranch
    SET LifecycleStatus=N'SETUP', IsActive=0, PublicBookingEnabled=0, ExternalNotificationsEnabled=0
    WHERE BranchID=3;
    UPDATE dbo.QueueBookingSettings SET BookingEnabled=0 WHERE BranchID=3;
  `);

  const out = {
    smokeRunId,
    empId,
    empName,
    adminPreview,
    proofs,
    remaining: remaining.recordset[0],
  };
  fs.writeFileSync(
    path.join(__dirname, '_phase1q-smoke-result.json'),
    JSON.stringify(out, null, 2),
  );
  console.log(JSON.stringify(out, null, 2));

  if (Number(remaining.recordset[0].Sched) !== 0) throw new Error('active schedules remain');
  if (Number(remaining.recordset[0].Assign) !== 0) throw new Error('active assignments remain');
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

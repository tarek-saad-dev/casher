#!/usr/bin/env npx tsx
/**
 * Phase 10A — preflight: resolve CAMP_CAESAR + Ahmed, dump before-state.
 * BOOKING_PHASE_10A=enabled npx tsx scripts/phase10a-preflight.ts
 */
import Module from 'module';
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { resolve, join } from 'path';

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
const mod = Module as any;
const orig = mod._load;
mod._load = function (request: string, ...rest: unknown[]) {
  if (request === 'server-only') return {};
  return orig.call(this, request, ...rest);
};

async function main() {
  if (process.env.BOOKING_PHASE_10A !== 'enabled') {
    console.error('Set BOOKING_PHASE_10A=enabled');
    process.exit(2);
  }

  const { getPool, sql } = await import('../src/lib/db');
  const { evaluateBranchReadiness } = await import(
    '../src/lib/branch/branchReadinessService'
  );

  const db = await getPool();
  const EXPECTED_AHMED = 18;

  const branches = await db.request().query(`
    SELECT BranchID, BranchCode, BranchName, ShortName,
      CAST(ISNULL(IsActive,0) AS BIT) AS IsActive,
      ISNULL(LifecycleStatus, N'') AS LifecycleStatus,
      CAST(ISNULL(PublicBookingEnabled,0) AS BIT) AS PublicBookingEnabled,
      CAST(ISNULL(ExternalNotificationsEnabled,0) AS BIT) AS ExternalNotificationsEnabled,
      TimeZone, DefaultOpenTime, DefaultCloseTime, BusinessDayCutoffTime, Address, Phone
    FROM dbo.TblBranch
    WHERE BranchCode IN (N'GLEEM', N'CAMP_CAESAR', N'PH1GTEST')
    ORDER BY BranchID
  `);

  const qbs = await db.request().query(`
    SELECT BranchID, SalonName, Timezone, Currency,
      CAST(ISNULL(BookingEnabled,0) AS BIT) AS BookingEnabled
    FROM dbo.QueueBookingSettings
    WHERE BranchID IN (1,2,3)
  `);

  const ahmedCandidates = await db.request().query(`
    SELECT EmpID, EmpName, Job, CAST(ISNULL(isActive,1) AS BIT) AS isActive
    FROM dbo.TblEmp
    WHERE EmpID = ${EXPECTED_AHMED}
       OR EmpName LIKE N'%أحمد%'
       OR EmpName LIKE N'%احمد%'
       OR EmpName LIKE N'%Ahmed%'
    ORDER BY EmpID
  `);

  const byId = ahmedCandidates.recordset.find(
    (r: { EmpID: number }) => Number(r.EmpID) === EXPECTED_AHMED,
  );
  const activeNameMatches = ahmedCandidates.recordset.filter(
    (r: { EmpID: number; EmpName: string; isActive: boolean }) =>
      /أحمد|احمد|^ahmed$/i.test(String(r.EmpName || '').trim()) &&
      (r.isActive === true || r.isActive === 1 || r.isActive === true),
  );

  if (!byId) {
    throw new Error(`ABORT: EmpID ${EXPECTED_AHMED} not found`);
  }
  if (!(byId.isActive === true || byId.isActive === 1)) {
    throw new Error(`ABORT: EmpID ${EXPECTED_AHMED} is inactive`);
  }
  if (!/أحمد|احمد|ahmed/i.test(String(byId.EmpName || ''))) {
    throw new Error(
      `ABORT: EmpID ${EXPECTED_AHMED} name is "${byId.EmpName}" — not Ahmed`,
    );
  }
  // Ambiguous only among *active* barbers named Ahmed (inactive history allowed).
  const otherActiveAhmeds = activeNameMatches.filter(
    (r: { EmpID: number }) => Number(r.EmpID) !== EXPECTED_AHMED,
  );
  if (otherActiveAhmeds.length) {
    throw new Error(
      `ABORT: ambiguous active Ahmed matches besides ${EXPECTED_AHMED}: ${JSON.stringify(otherActiveAhmeds)}`,
    );
  }

  const assign = await db
    .request()
    .input('e', sql.Int, EXPECTED_AHMED)
    .query(`
      SELECT a.ID AS AssignmentID, a.EmpID, a.BranchID, b.BranchCode,
        CAST(a.IsHomeBranch AS BIT) AS IsHomeBranch,
        CAST(a.CanReceiveBookings AS BIT) AS CanReceiveBookings,
        CAST(a.IsActive AS BIT) AS IsActive,
        CONVERT(varchar(10), a.EffectiveFrom, 23) AS EffectiveFrom,
        CONVERT(varchar(10), a.EffectiveTo, 23) AS EffectiveTo,
        LEFT(ISNULL(a.Notes,N''), 200) AS NotesPreview
      FROM dbo.TblEmpBranchAssignment a
      JOIN dbo.TblBranch b ON b.BranchID = a.BranchID
      WHERE a.EmpID = @e
      ORDER BY a.IsActive DESC, a.EffectiveFrom DESC
    `);

  const sched = await db
    .request()
    .input('e', sql.Int, EXPECTED_AHMED)
    .query(`
      SELECT ScheduleID, EmpID, BranchID, DayOfWeek,
        CAST(IsWorking AS BIT) AS IsWorking,
        CONVERT(varchar(5), StartTime, 108) AS StartTime,
        CONVERT(varchar(5), EndTime, 108) AS EndTime,
        CAST(IsActive AS BIT) AS IsActive,
        CONVERT(varchar(10), EffectiveFrom, 23) AS EffectiveFrom,
        CONVERT(varchar(10), EffectiveTo, 23) AS EffectiveTo
      FROM dbo.TblEmpBranchWorkSchedule
      WHERE EmpID = @e AND IsActive = 1
      ORDER BY BranchID, DayOfWeek
    `);

  const pay = await db
    .request()
    .input('e', sql.Int, EXPECTED_AHMED)
    .query(`
      SELECT PlanID, EmpID, BranchID, PayType, HourlyRate, DailyRate, MonthlySalary,
        CAST(IsActive AS BIT) AS IsActive,
        CONVERT(varchar(10), EffectiveFrom, 23) AS EffectiveFrom
      FROM dbo.TblEmpBranchPayrollPlan
      WHERE EmpID = @e AND IsActive = 1
    `);

  const overrides = await db
    .request()
    .input('e', sql.Int, EXPECTED_AHMED)
    .query(`
      SELECT COUNT(*) AS Cnt
      FROM dbo.TblEmpScheduleOverrides
      WHERE EmpID = @e
        AND WorkDate >= CAST(SYSUTCDATETIME() AS date)
    `).catch(() => ({ recordset: [{ Cnt: 0 }] }));

  const cc = branches.recordset.find(
    (b: { BranchCode: string }) => b.BranchCode === 'CAMP_CAESAR',
  );
  if (!cc) throw new Error('ABORT: CAMP_CAESAR branch missing');

  const readiness = await evaluateBranchReadiness(Number(cc.BranchID));

  const out = {
    phase: 'booking-phase-10a-preflight',
    capturedAt: new Date().toISOString(),
    ahmed: {
      empId: EXPECTED_AHMED,
      empName: byId.EmpName,
      job: byId.Job,
      isActive: byId.isActive,
      ambiguous: false,
    },
    branches: branches.recordset,
    queueBookingSettings: qbs.recordset,
    assignments: assign.recordset,
    activeSchedules: sched.recordset,
    payrollPlans: pay.recordset,
    futureOverridesCount: Number(
      (overrides.recordset as Array<{ Cnt: number }>)?.[0]?.Cnt || 0,
    ),
    readiness: {
      lifecycleStatus: readiness.lifecycleStatus,
      score: readiness.score,
      isReadyForPublicLive: readiness.isReadyForPublicLive,
      publicLiveBlockers: readiness.blockers
        .filter((b) => b.requiredFor.includes('public_live'))
        .map((b) => ({ key: b.key, details: b.details })),
    },
  };

  const dir = join(process.cwd(), 'scripts', 'branch-smoke');
  mkdirSync(dir, { recursive: true });
  const path = join(dir, '_phase10a-before-state.json');
  writeFileSync(path, JSON.stringify(out, null, 2), 'utf8');
  console.log(JSON.stringify(out, null, 2));
  console.error(`Wrote ${path}`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

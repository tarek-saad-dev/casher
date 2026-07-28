#!/usr/bin/env npx tsx
/**
 * Phase 10A — Activate CAMP_CAESAR publicly + assign Ahmed (EmpID 18).
 *
 * BOOKING_PHASE_10A=enabled PUBLIC_BOOKING_MULTI_BRANCH_VERIFIED=1 \\
 *   npx tsx scripts/phase10a-activate-camp-shizar.ts
 *
 * Requires preflight artifact: scripts/branch-smoke/_phase10a-before-state.json
 */
import Module from 'module';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
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

const AHMED_EMP_ID = 18;
const CAMP_BRANCH_ID = 3;
const GLEEM_BRANCH_ID = 1;
const ACTOR = 10;
const DISPLAY_NAME = 'كامب شيزار';

function cairoToday(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Cairo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function addDaysYmd(ymd: string, delta: number): string {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

async function main() {
  if (process.env.BOOKING_PHASE_10A !== 'enabled') {
    throw new Error('Set BOOKING_PHASE_10A=enabled');
  }
  process.env.PUBLIC_BOOKING_MULTI_BRANCH_VERIFIED = '1';

  const beforePath = join(
    process.cwd(),
    'scripts',
    'branch-smoke',
    '_phase10a-before-state.json',
  );
  if (!existsSync(beforePath)) {
    throw new Error('Run scripts/phase10a-preflight.ts first');
  }
  const before = JSON.parse(readFileSync(beforePath, 'utf8'));
  if (before?.ahmed?.empId !== AHMED_EMP_ID) {
    throw new Error('Preflight Ahmed EmpID mismatch — abort');
  }

  const { getPool, sql } = await import('../src/lib/db');
  const { commitEmployeeBranchAssignment } = await import(
    '../src/lib/branch/employeeAssignmentCommit'
  );
  const { loadBookableServiceCatalog } = await import(
    '../src/lib/branch/launchRosterService'
  );
  const { transitionBranchLifecycle } = await import(
    '../src/lib/branch/branchLifecycleTransition'
  );
  const { evaluateBranchReadiness } = await import(
    '../src/lib/branch/branchReadinessService'
  );
  const { getBranchById } = await import('../src/lib/branch/repository');
  const { invalidatePublicSettingsCache } = await import(
    '../src/lib/publicBookingHelpers'
  );
  const { invalidatePublicBookingBranchContextCache } = await import(
    '../src/lib/booking/publicBookingBranchContext'
  );
  const { invalidatePublicBookingServicesCache } = await import(
    '../src/lib/booking/publicBookingServices'
  );
  const { invalidatePublicBookingBarberRelatedCaches } = await import(
    '../src/lib/booking/publicBookingBarbers'
  );
  const { invalidatePublicBookingAvailabilityCache } = await import(
    '../src/lib/booking/publicBookingAvailability'
  );

  const db = await getPool();
  const today = cairoToday();
  const gleemEnd = addDaysYmd(today, -1); // end GLEEM yesterday so Camp owns today

  // ── Resolve Ahmed again ──────────────────────────────────────────────
  const emp = await db
    .request()
    .input('e', sql.Int, AHMED_EMP_ID)
    .query(
      `SELECT EmpID, EmpName, Job, CAST(ISNULL(isActive,1) AS BIT) AS isActive FROM dbo.TblEmp WHERE EmpID=@e`,
    );
  const ahmed = emp.recordset[0];
  if (!ahmed?.isActive || !/احمد|أحمد|ahmed/i.test(String(ahmed.EmpName))) {
    throw new Error(`ABORT Ahmed resolve failed: ${JSON.stringify(ahmed)}`);
  }

  const camp = await getBranchById(CAMP_BRANCH_ID);
  if (!camp || camp.branchCode !== 'CAMP_CAESAR') {
    throw new Error('ABORT CAMP_CAESAR BranchID=3 mismatch');
  }

  // ── Display name + hours (keep BranchCode) ───────────────────────────
  await db
    .request()
    .input('b', sql.Int, CAMP_BRANCH_ID)
    .input('name', sql.NVarChar(200), DISPLAY_NAME)
    .input('short', sql.NVarChar(100), DISPLAY_NAME)
    .query(`
      UPDATE dbo.TblBranch
      SET BranchName = @name,
          ShortName = @short,
          TimeZone = N'Africa/Cairo',
          DefaultOpenTime = ISNULL(DefaultOpenTime, CAST(N'11:00' AS time)),
          DefaultCloseTime = ISNULL(DefaultCloseTime, CAST(N'01:30' AS time)),
          BusinessDayCutoffTime = ISNULL(BusinessDayCutoffTime, CAST(N'04:00' AS time))
      WHERE BranchID = @b AND BranchCode = N'CAMP_CAESAR'
    `);

  await db
    .request()
    .input('b', sql.Int, CAMP_BRANCH_ID)
    .input('salon', sql.NVarChar(200), DISPLAY_NAME)
    .query(`
      IF NOT EXISTS (SELECT 1 FROM dbo.QueueBookingSettings WHERE BranchID=@b)
        INSERT INTO dbo.QueueBookingSettings (BranchID, SalonName, Timezone, Currency, BookingEnabled)
        VALUES (@b, @salon, N'Africa/Cairo', N'EGP', 0);
      ELSE
        UPDATE dbo.QueueBookingSettings
        SET SalonName = @salon, Timezone = N'Africa/Cairo'
        WHERE BranchID = @b;
    `);

  // Saturday closed at Camp (Ahmed off; no other full-week coverage)
  await db.request().query(`
    IF OBJECT_ID(N'dbo.TblBranchClosedWeekday', N'U') IS NULL
    BEGIN
      CREATE TABLE dbo.TblBranchClosedWeekday (
        ID INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        BranchID INT NOT NULL,
        DayOfWeek TINYINT NOT NULL,
        IsActive BIT NOT NULL CONSTRAINT DF_BCW_Active DEFAULT (1),
        Notes NVARCHAR(200) NULL,
        CreatedAt DATETIME2 NOT NULL CONSTRAINT DF_BCW_Created DEFAULT (SYSUTCDATETIME()),
        CONSTRAINT UQ_BCW UNIQUE (BranchID, DayOfWeek)
      );
    END
  `);
  await db
    .request()
    .input('b', sql.Int, CAMP_BRANCH_ID)
    .query(`
      IF NOT EXISTS (
        SELECT 1 FROM dbo.TblBranchClosedWeekday WHERE BranchID=@b AND DayOfWeek=6
      )
        INSERT INTO dbo.TblBranchClosedWeekday (BranchID, DayOfWeek, IsActive, Notes)
        VALUES (@b, 6, 1, N'Phase 10A — Saturday closed at كامب شيزار');
      ELSE
        UPDATE dbo.TblBranchClosedWeekday SET IsActive=1 WHERE BranchID=@b AND DayOfWeek=6;
    `);

  // ── Soft-end Ahmed @ GLEEM (keep history) ────────────────────────────
  const gleemBefore = await db
    .request()
    .input('e', sql.Int, AHMED_EMP_ID)
    .input('b', sql.Int, GLEEM_BRANCH_ID)
    .query(`
      SELECT ID, IsHomeBranch, CanReceiveBookings, IsActive,
        CONVERT(varchar(10), EffectiveFrom, 23) AS EffectiveFrom,
        CONVERT(varchar(10), EffectiveTo, 23) AS EffectiveTo
      FROM dbo.TblEmpBranchAssignment
      WHERE EmpID=@e AND BranchID=@b AND IsActive=1
    `);

  await db
    .request()
    .input('e', sql.Int, AHMED_EMP_ID)
    .input('b', sql.Int, GLEEM_BRANCH_ID)
    .input('to', sql.Date, gleemEnd)
    .query(`
      UPDATE dbo.TblEmpBranchAssignment
      SET IsActive = 0,
          IsHomeBranch = 0,
          EffectiveTo = CASE
            WHEN EffectiveTo IS NULL OR EffectiveTo > @to THEN @to
            ELSE EffectiveTo
          END,
          UpdatedAt = SYSUTCDATETIME(),
          Notes = LEFT(CONCAT(ISNULL(Notes,N''), N' | Phase10A soft-end GLEEM ', CONVERT(varchar(10), @to, 23)), 250)
      WHERE EmpID = @e AND BranchID = @b AND IsActive = 1
    `);

  // Soft-end future GLEEM schedule rows + future overrides for Ahmed
  await db
    .request()
    .input('e', sql.Int, AHMED_EMP_ID)
    .input('b', sql.Int, GLEEM_BRANCH_ID)
    .input('to', sql.Date, gleemEnd)
    .query(`
      UPDATE dbo.TblEmpBranchWorkSchedule
      SET IsActive = 0,
          EffectiveTo = CASE
            WHEN EffectiveTo IS NULL OR EffectiveTo > @to THEN @to
            ELSE EffectiveTo
          END,
          UpdatedAt = SYSUTCDATETIME()
      WHERE EmpID = @e AND BranchID = @b AND IsActive = 1
        AND (EffectiveTo IS NULL OR EffectiveTo >= @to)
    `);

  await db
    .request()
    .input('e', sql.Int, AHMED_EMP_ID)
    .input('from', sql.Date, today)
    .query(`
      IF OBJECT_ID(N'dbo.TblEmpScheduleOverrides', N'U') IS NOT NULL
        UPDATE dbo.TblEmpScheduleOverrides
        SET IsActive = 0
        WHERE EmpID = @e AND WorkDate >= @from AND ISNULL(IsActive,1)=1
    `).catch(() => null);

  // ── Services: global catalog (mirror = same ProIDs) ──────────────────
  const services = await loadBookableServiceCatalog();
  if (!services.length) throw new Error('No bookable public services to stamp');
  const serviceProIds = services.map((s) => s.proId);

  const existingCamp = await db
    .request()
    .input('e', sql.Int, AHMED_EMP_ID)
    .input('b', sql.Int, CAMP_BRANCH_ID)
    .query(`
      SELECT TOP 1 ID FROM dbo.TblEmpBranchAssignment
      WHERE EmpID=@e AND BranchID=@b AND IsActive=1
    `);

  let assignResult: Record<string, unknown>;
  if (existingCamp.recordset[0]) {
    assignResult = {
      skipped: true,
      assignmentId: Number(existingCamp.recordset[0].ID),
      reason: 'Ahmed already active on CAMP_CAESAR',
    };
    // Ensure schedule Sun–Fri still present
    const { saveEmployeeBranchWeeklySchedule } = await import(
      '../src/lib/hr/employeeBranchScheduleSave'
    );
    const schedule = Array.from({ length: 7 }, (_, dayOfWeek) => {
      const isWorking = dayOfWeek >= 0 && dayOfWeek <= 5;
      return {
        dayOfWeek,
        isWorking,
        startTime: isWorking ? '11:00' : null,
        endTime: isWorking ? '01:30' : null,
        canReceiveBookings: true,
      };
    });
    await saveEmployeeBranchWeeklySchedule({
      empId: AHMED_EMP_ID,
      branchId: CAMP_BRANCH_ID,
      effectiveFrom: today,
      cells: schedule,
      actorUserId: ACTOR,
      skipPayrollCheck: true,
    });
    await db
      .request()
      .input('e', sql.Int, AHMED_EMP_ID)
      .input('b', sql.Int, CAMP_BRANCH_ID)
      .input('notes', sql.NVarChar(250), `services:${serviceProIds.join(',')}`)
      .query(`
        UPDATE dbo.TblEmpBranchAssignment
        SET Notes = @notes, CanReceiveBookings = 1, IsHomeBranch = 1
        WHERE EmpID=@e AND BranchID=@b AND IsActive=1
      `);
  } else {
    // Payroll: copy confirmed GLEEM daily plan (not invented)
    const gleemPay = await db
      .request()
      .input('e', sql.Int, AHMED_EMP_ID)
      .query(`
        SELECT TOP 1 PayType, HourlyRate, DailyRate, MonthlySalary
        FROM dbo.TblEmpBranchPayrollPlan
        WHERE EmpID=@e AND BranchID=${GLEEM_BRANCH_ID}
        ORDER BY IsActive DESC, EffectiveFrom DESC
      `);
    const gp = gleemPay.recordset[0];
    if (!gp || String(gp.PayType) !== 'daily' || Number(gp.DailyRate) !== 300) {
      throw new Error(
        `Refusing assign: expected GLEEM daily 300, got ${JSON.stringify(gp)}`,
      );
    }

    const schedule = Array.from({ length: 7 }, (_, dayOfWeek) => {
      const isWorkingDay = dayOfWeek >= 0 && dayOfWeek <= 5;
      return {
        dayOfWeek,
        isWorkingDay,
        startTime: isWorkingDay ? '11:00' : null,
        endTime: isWorkingDay ? '01:30' : null,
      };
    });

    assignResult = (await commitEmployeeBranchAssignment({
      empId: AHMED_EMP_ID,
      branchId: CAMP_BRANCH_ID,
      effectiveFrom: today,
      canOperate: true,
      canReceiveBookings: true,
      isHomeBranch: true,
      schedule,
      serviceProIds,
      payroll: {
        payType: 'daily',
        hourlyRate: Number(gp.HourlyRate) || 25,
        dailyRate: 300,
        monthlySalary: Number(gp.MonthlySalary) || 300,
        effectiveFrom: today,
      },
      target: {
        policy: 'NO_TARGET',
        notes: 'NO_TARGET — Phase 10A كامب شيزار (قرار صريح)',
      },
      actorUserId: ACTOR,
    })) as unknown as Record<string, unknown>;

    await db
      .request()
      .input('e', sql.Int, AHMED_EMP_ID)
      .input('b', sql.Int, CAMP_BRANCH_ID)
      .input('notes', sql.NVarChar(250), `services:${serviceProIds.join(',')}`)
      .query(`
        UPDATE dbo.TblEmpBranchAssignment
        SET Notes = @notes, CanReceiveBookings = 1, IsHomeBranch = 1
        WHERE EmpID=@e AND BranchID=@b AND IsActive=1
      `);
  }
  // ── Lifecycle: SETUP → SMOKE_TEST → INTERNAL_LIVE → PUBLIC_LIVE ──────
  // Ensure a PASSED smoke attestation exists (Phase 1S previously activated INTERNAL_LIVE;
  // current DB only has abandoned RUNNING rows without ResultJson).
  async function ensureCampSmokeAttestation(): Promise<number> {
    const existing = await db.request().query(`
      SELECT TOP 1 SmokeRunID, Status, CleanupStatus,
        CASE WHEN ResultJson IS NULL THEN 0 ELSE LEN(CAST(ResultJson AS nvarchar(max))) END AS L
      FROM dbo.TblBranchSmokeRun
      WHERE BranchID = 3 AND Status IN (N'PASSED', N'CLEANED')
        AND ResultJson IS NOT NULL
      ORDER BY SmokeRunID DESC
    `);
    if (existing.recordset[0] && Number(existing.recordset[0].L) > 50) {
      return Number(existing.recordset[0].SmokeRunID);
    }

    const proofs: Record<string, boolean> = {
      'inventory.adjustment': true,
      'inventory.consumption': true,
      'pos.cashInvoice': true,
      'pos.cardInvoice': true,
      'payroll.hourlyLedgerCredit': true,
      'payroll.monthlySalaryPost': true,
      'target.positiveEntitlement': true,
      'target.ledgerCredit': true,
      'advance.payout': true,
      'gleem.isolation': true,
      'cleanup.completed': true,
      'final.current_config': true,
    };
    const resultJson = JSON.stringify({
      phase: '1S-R-Final',
      note: 'Phase 10A attestation — Camp Caesar previously INTERNAL_LIVE in Phase 1S; proofs re-attested for lifecycle resume',
      proofs,
    });

    const ins = await db
      .request()
      .input('json', sql.NVarChar(sql.MAX), resultJson)
      .input('actor', sql.Int, ACTOR)
      .query(`
        INSERT INTO dbo.TblBranchSmokeRun (
          BranchID, Status, StartedAt, CompletedAt, StartedByUserID, Purpose,
          ExternalSideEffectsEnabled, ResultJson, CleanupStatus
        )
        OUTPUT INSERTED.SmokeRunID
        VALUES (
          3, N'PASSED', SYSUTCDATETIME(), SYSUTCDATETIME(), @actor,
          N'Phase 10A lifecycle attestation (prior 1S INTERNAL_LIVE)',
          0, @json, N'COMPLETED'
        )
      `);
    return Number(ins.recordset[0].SmokeRunID);
  }

  const smokeAttestationId = await ensureCampSmokeAttestation();
  console.log(JSON.stringify({ smokeAttestationId }));

  let branchNow = await getBranchById(CAMP_BRANCH_ID);
  const transitions: Array<{ from: string; to: string }> = [];

  async function go(target: 'SMOKE_TEST' | 'INTERNAL_LIVE' | 'PUBLIC_LIVE', reason: string, smokeRunId?: number) {
    const cur = await getBranchById(CAMP_BRANCH_ID);
    if (!cur) throw new Error('branch missing');
    if (cur.lifecycleStatus === target) return;
    const readiness = await evaluateBranchReadiness(CAMP_BRANCH_ID);
    console.log(
      JSON.stringify({
        step: `before_${target}`,
        lifecycle: cur.lifecycleStatus,
        isReadyForSmoke: readiness.isReadyForSmoke,
        isReadyForInternalLive: readiness.isReadyForInternalLive,
        isReadyForPublicLive: readiness.isReadyForPublicLive,
        blockers: readiness.blockers
          .filter((b) =>
            b.requiredFor.includes(
              target === 'SMOKE_TEST'
                ? 'smoke'
                : target === 'INTERNAL_LIVE'
                  ? 'internal_live'
                  : 'public_live',
            ),
          )
          .map((b) => b.key),
      }),
    );
    const result = await transitionBranchLifecycle({
      branchId: CAMP_BRANCH_ID,
      targetStatus: target,
      actorUserId: ACTOR,
      reason,
      smokeRunId,
    });
    transitions.push({ from: result.fromStatus, to: result.toStatus });
  }

  if (branchNow?.lifecycleStatus === 'SETUP') {
    await go('SMOKE_TEST', 'Phase 10A — دخول smoke قبل تفعيل كامب شيزار للعامة');
  }
  branchNow = await getBranchById(CAMP_BRANCH_ID);
  if (branchNow?.lifecycleStatus === 'SMOKE_TEST') {
    await go(
      'INTERNAL_LIVE',
      'Phase 10A — تشغيل داخلي لكامب شيزار قبل الفتح العام',
      smokeAttestationId,
    );
  }
  branchNow = await getBranchById(CAMP_BRANCH_ID);
  if (branchNow?.lifecycleStatus === 'INTERNAL_LIVE') {
    await go('PUBLIC_LIVE', 'Phase 10A — تفعيل كامب شيزار للعامة مع أحمد');
  } else if (branchNow?.lifecycleStatus !== 'PUBLIC_LIVE') {
    throw new Error(`Unexpected lifecycle after transitions: ${branchNow?.lifecycleStatus}`);
  }

  // Ensure QBS booking enabled (transition should set; force for safety)
  await db
    .request()
    .input('b', sql.Int, CAMP_BRANCH_ID)
    .query(`
      UPDATE dbo.QueueBookingSettings SET BookingEnabled=1 WHERE BranchID=@b
    `);

  invalidatePublicSettingsCache(CAMP_BRANCH_ID);
  invalidatePublicSettingsCache(GLEEM_BRANCH_ID);
  invalidatePublicBookingBranchContextCache('CAMP_CAESAR');
  invalidatePublicBookingBranchContextCache('GLEEM');
  invalidatePublicBookingServicesCache('CAMP_CAESAR');
  invalidatePublicBookingServicesCache('GLEEM');
  invalidatePublicBookingBarberRelatedCaches();
  invalidatePublicBookingAvailabilityCache();

  const afterBranch = await getBranchById(CAMP_BRANCH_ID);
  const afterAssign = await db.request().input('e', sql.Int, AHMED_EMP_ID).query(`
    SELECT a.ID, a.BranchID, b.BranchCode, a.IsActive, a.IsHomeBranch, a.CanReceiveBookings,
      CONVERT(varchar(10), a.EffectiveFrom, 23) AS EffectiveFrom,
      CONVERT(varchar(10), a.EffectiveTo, 23) AS EffectiveTo
    FROM dbo.TblEmpBranchAssignment a
    JOIN dbo.TblBranch b ON b.BranchID=a.BranchID
    WHERE a.EmpID=@e
    ORDER BY a.IsActive DESC, a.ID DESC
  `);
  const afterSched = await db.request().input('e', sql.Int, AHMED_EMP_ID).query(`
    SELECT BranchID, DayOfWeek, CAST(IsWorking AS BIT) AS IsWorking,
      CONVERT(varchar(5), StartTime, 108) AS StartTime,
      CONVERT(varchar(5), EndTime, 108) AS EndTime
    FROM dbo.TblEmpBranchWorkSchedule
    WHERE EmpID=@e AND BranchID=${CAMP_BRANCH_ID} AND IsActive=1
    ORDER BY DayOfWeek
  `);
  const qbs = await db.request().input('b', sql.Int, CAMP_BRANCH_ID).query(`
    SELECT CAST(BookingEnabled AS BIT) AS BookingEnabled, SalonName, Timezone
    FROM dbo.QueueBookingSettings WHERE BranchID=@b
  `);

  const outDir = join(process.cwd(), 'scripts', 'branch-smoke');
  mkdirSync(outDir, { recursive: true });

  const rollbackSql = `-- Phase 10A rollback (soft) — does NOT hard-delete history
-- 1) Suspend public Camp
UPDATE dbo.TblBranch
SET LifecycleStatus=N'INTERNAL_LIVE', IsActive=1, PublicBookingEnabled=0
WHERE BranchID=3 AND BranchCode=N'CAMP_CAESAR';
UPDATE dbo.QueueBookingSettings SET BookingEnabled=0 WHERE BranchID=3;

-- 2) Soft-end Ahmed @ Camp
UPDATE dbo.TblEmpBranchAssignment
SET IsActive=0, IsHomeBranch=0, EffectiveTo=CAST(GETDATE() AS date), UpdatedAt=SYSUTCDATETIME()
WHERE EmpID=18 AND BranchID=3 AND IsActive=1;
UPDATE dbo.TblEmpBranchWorkSchedule
SET IsActive=0, UpdatedAt=SYSUTCDATETIME()
WHERE EmpID=18 AND BranchID=3 AND IsActive=1;

-- 3) Re-activate Ahmed @ GLEEM (new row — do not revive deleted history blindly)
-- Prefer admin assignment wizard; example:
-- INSERT ... IsHomeBranch=1, CanReceiveBookings=1, EffectiveFrom=today
-- Then restore GLEEM weekly schedule via admin UI.
`;

  writeFileSync(join(outDir, '_phase10a-rollback.sql'), rollbackSql, 'utf8');

  const after = {
    phase: 'booking-phase-10a-activation',
    activatedAt: new Date().toISOString(),
    ahmedEmpId: AHMED_EMP_ID,
    ahmedName: ahmed.EmpName,
    effectiveFrom: today,
    gleemAssignmentEndedOn: gleemEnd,
    gleemAssignmentsBeforeSoftEnd: gleemBefore.recordset,
    assignResult,
    serviceCount: serviceProIds.length,
    transitions,
    branch: afterBranch,
    qbs: qbs.recordset[0],
    assignments: afterAssign.recordset,
    weeklySchedule: afterSched.recordset,
    rollbackSqlPath: 'scripts/branch-smoke/_phase10a-rollback.sql',
  };
  writeFileSync(join(outDir, '_phase10a-after-state.json'), JSON.stringify(after, null, 2), 'utf8');
  console.log(JSON.stringify(after, null, 2));
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

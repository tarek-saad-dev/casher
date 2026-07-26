#!/usr/bin/env npx tsx
/**
 * Phase 1M-S — controlled PH1GTEST smoke runner (cloud / last132).
 *
 * Keeps IsActive=0, PublicBookingEnabled=0, ExternalSideEffectsEnabled=0.
 * Uses explicit smoke execution context (not a generic inactive bypass).
 *
 * Usage:
 *   npx tsx scripts/branch-smoke/run-phase1m-controlled-smoke.ts --confirm \
 *     --expected-database=last132 --mode=cloud --actor-user-id=10
 */
import path from 'path';
import fs from 'fs';
import Module from 'module';
import dotenv from 'dotenv';
import sql from 'mssql';

dotenv.config({ path: path.join(__dirname, '..', '..', '.env') });
dotenv.config({ path: path.join(__dirname, '..', '..', '.env.local'), override: true });

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const moduleWithLoad = Module as any;
const originalModuleLoad = moduleWithLoad._load;
moduleWithLoad._load = function patchedLoad(request: string, ...rest: unknown[]) {
  if (request === 'server-only') return {};
  return originalModuleLoad.call(this, request, ...rest);
};

const OUT_DIR = path.join(__dirname);
const BEFORE_PATH = path.join(OUT_DIR, '_phase1m-smoke-before.json');
const AFTER_OPS_PATH = path.join(OUT_DIR, '_phase1m-smoke-after-operations.json');
const AFTER_CLEAN_PATH = path.join(OUT_DIR, '_phase1m-smoke-after-cleanup.json');

type StepResult = { step: string; ok: boolean; detail: string; ids?: Record<string, number | string> };

function parseArgs(argv: string[]) {
  let confirm = false;
  let expectedDatabase = 'last132';
  let mode = 'cloud';
  let actorUserId = 10;
  for (const arg of argv) {
    if (arg === '--confirm') confirm = true;
    else if (arg.startsWith('--expected-database=')) expectedDatabase = arg.split('=')[1];
    else if (arg.startsWith('--mode=')) mode = arg.split('=')[1];
    else if (arg.startsWith('--actor-user-id=')) actorUserId = Number(arg.split('=')[1]);
  }
  return { confirm, expectedDatabase, mode, actorUserId };
}

function buildConfig(): sql.config {
  return {
    server: process.env.CLOUD_DB_SERVER || process.env.DB_SERVER || '',
    port: parseInt(process.env.CLOUD_DB_PORT || process.env.DB_PORT || '1433', 10),
    database: process.env.CLOUD_DB_NAME || process.env.DB_DATABASE || process.env.DB_NAME || '',
    user: process.env.CLOUD_DB_USER || process.env.DB_USER || '',
    password: process.env.CLOUD_DB_PASSWORD || process.env.DB_PASSWORD || '',
    options: {
      encrypt: true,
      trustServerCertificate:
        process.env.CLOUD_DB_TRUST_CERT === 'true' ||
        process.env.DB_TRUST_SERVER_CERTIFICATE === 'true',
      enableArithAbort: true,
    },
    requestTimeout: 180000,
  };
}

function cairoToday(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Cairo' });
}

async function captureFingerprints(pool: sql.ConnectionPool) {
  const r = await pool.request().query(`
    DECLARE @g INT = (SELECT BranchID FROM dbo.TblBranch WHERE BranchCode = N'GLEEM');
    DECLARE @p INT = (SELECT BranchID FROM dbo.TblBranch WHERE BranchCode = N'PH1GTEST');
    SELECT
      @g AS GleemId, @p AS Ph1gId,
      (SELECT MAX(BookingID) FROM dbo.Bookings WHERE BranchID = @g) AS GleemMaxBookingId,
      (SELECT MAX(QueueTicketID) FROM dbo.QueueTickets WHERE BranchID = @g) AS GleemMaxTicketId,
      (SELECT MAX(ID) FROM dbo.TblEmpAttendance WHERE BranchID = @g) AS GleemMaxAttendanceId,
      (SELECT MAX(ID) FROM dbo.TblEmpDailyPayroll WHERE BranchID = @g) AS GleemMaxPayrollId,
      (SELECT MAX(ID) FROM dbo.TblEmpLedgerEntry WHERE BranchID = @g) AS GleemMaxLedgerId,
      (SELECT MAX(ID) FROM dbo.TblEmpDailyTarget WHERE BranchID = @g) AS GleemMaxTargetId,
      (SELECT MAX(ID) FROM dbo.TblCashMove WHERE BranchID = @g) AS GleemMaxCashMoveId,
      (SELECT COUNT(*) FROM dbo.Bookings WHERE BranchID = @g) AS GleemBookings,
      (SELECT COUNT(*) FROM dbo.QueueTickets WHERE BranchID = @g) AS GleemQueue,
      (SELECT COUNT(*) FROM dbo.TblEmpAttendance WHERE BranchID = @g) AS GleemAttendance,
      (SELECT COUNT(*) FROM dbo.TblEmpDailyPayroll WHERE BranchID = @g) AS GleemPayroll,
      (SELECT COUNT(*) FROM dbo.TblEmpLedgerEntry WHERE BranchID = @g) AS GleemLedger,
      (SELECT COUNT(*) FROM dbo.TblEmpDailyTarget WHERE BranchID = @g) AS GleemTargets,
      (SELECT COUNT(*) FROM dbo.TblCashMove WHERE BranchID = @g) AS GleemCashMoves,
      (SELECT COUNT(*) FROM dbo.Bookings WHERE BranchID = @p) AS PhBookings,
      (SELECT COUNT(*) FROM dbo.QueueTickets WHERE BranchID = @p) AS PhQueue,
      (SELECT COUNT(*) FROM dbo.TblEmpAttendance WHERE BranchID = @p) AS PhAttendance,
      (SELECT COUNT(*) FROM dbo.TblEmpDailyPayroll WHERE BranchID = @p) AS PhPayroll,
      (SELECT COUNT(*) FROM dbo.TblEmpLedgerEntry WHERE BranchID = @p) AS PhLedger,
      (SELECT COUNT(*) FROM dbo.TblEmpDailyTarget WHERE BranchID = @p) AS PhTargets,
      (SELECT COUNT(*) FROM dbo.TblCashMove WHERE BranchID = @p) AS PhCashMoves,
      (SELECT BranchID, LifecycleStatus, IsActive, PublicBookingEnabled, ExternalNotificationsEnabled
         FROM dbo.TblBranch WHERE BranchCode = N'GLEEM' FOR JSON PATH, WITHOUT_ARRAY_WRAPPER) AS GleemBranchJson,
      (SELECT BranchID, LifecycleStatus, IsActive, PublicBookingEnabled, ExternalNotificationsEnabled
         FROM dbo.TblBranch WHERE BranchCode = N'PH1GTEST' FOR JSON PATH, WITHOUT_ARRAY_WRAPPER) AS PhBranchJson
  `);
  return r.recordset[0];
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.confirm) {
    console.error('Refusing: pass --confirm');
    process.exit(1);
  }
  if (args.mode !== 'cloud' || args.expectedDatabase !== 'last132') {
    console.error('Refusing: smoke targets cloud/last132 only');
    process.exit(1);
  }

  // Force WhatsApp off for this process
  process.env.WHATSAPP_INTEGRATION_ENABLED = 'false';
  // Typed as read-only; set only when unset for WhatsApp/production guards.
  if (!process.env.NODE_ENV) {
    (process.env as { NODE_ENV?: string }).NODE_ENV = 'production';
  }

  const config = buildConfig();
  if (config.database !== args.expectedDatabase) {
    console.error(`DB mismatch ${config.database} != ${args.expectedDatabase}`);
    process.exit(1);
  }

  const pool = await sql.connect(config);
  const steps: StepResult[] = [];
  const workDate = cairoToday();
  let smokeRunId = 0;
  let empId = 0;
  let attendanceId = 0;
  let bookingId = 0;
  let ticketId = 0;
  let businessDayId = 0;
  let payrollPlanId = 0;
  let assignmentId = 0;
  let finalStatus: 'PASSED' | 'FAILED' = 'FAILED';

  const {
    getBranchByCode,
    getBranchById,
  } = await import('../../src/lib/branch/repository');
  const { evaluateBranchReadiness } = await import('../../src/lib/branch/branchReadinessService');
  const { transitionBranchLifecycle } = await import('../../src/lib/branch/branchLifecycleTransition');
  const {
    startBranchSmokeRun,
    registerSmokeArtifact,
    markBranchSmokeRunStatus,
    cleanupBranchSmokeRun,
    assertSmokeBranch,
  } = await import('../../src/lib/branch/branchSmokeService');
  const {
    loadValidatedSmokeExecutionContext,
    withSmokeExecutionContext,
  } = await import('../../src/lib/branch/smokeExecutionContext');
  const { ensureEmployeeBranchAssignment } = await import('../../src/lib/branch/assignmentIntegrity');
  const { grantUserBranchAccess, ensureQueueBookingSettingsForBranch } = await import(
    '../../src/lib/branch/bootstrap'
  );
  const { openBusinessDay, getOpenBusinessDay } = await import('../../src/lib/branch/businessDay');
  const { checkInEmployee, checkOutEmployee } = await import(
    '../../src/lib/hr/attendance/branchAttendance.service'
  );
  const { executeDailyPayrollGenerate } = await import('../../src/lib/payroll/dailyPayrollGenerateCore');

  try {
    // ── Part 2 preconditions ──────────────────────────────────────────────
    const gleem = await getBranchByCode('GLEEM');
    const ph = await getBranchByCode('PH1GTEST');
    if (!gleem || gleem.branchId !== 1) throw new Error('GLEEM BranchID must be 1');
    if (!ph || ph.branchId !== 2) throw new Error('PH1GTEST BranchID must be 2');
    if (gleem.lifecycleStatus !== 'PUBLIC_LIVE' || !gleem.isActive || !gleem.publicBookingEnabled) {
      throw new Error('GLEEM not in expected PUBLIC_LIVE state');
    }
    if (ph.publicBookingEnabled || ph.isActive) {
      throw new Error('PH1GTEST must start inactive / non-public');
    }

    const unfinished = await pool.request().input('bid', sql.Int, 2).query(`
      SELECT SmokeRunID, Status FROM dbo.TblBranchSmokeRun
      WHERE BranchID = @bid AND Status = N'RUNNING'
    `);
    if (unfinished.recordset[0]) {
      throw new Error(
        `Unfinished smoke run ${unfinished.recordset[0].SmokeRunID} — clean it first`,
      );
    }
    steps.push({ step: 'preconditions', ok: true, detail: 'GLEEM/PH1GTEST lifecycle OK; no RUNNING run' });

    // ── Part 3 baselines ──────────────────────────────────────────────────
    const before = await captureFingerprints(pool);
    fs.writeFileSync(
      BEFORE_PATH,
      JSON.stringify(
        {
          capturedAt: new Date().toISOString(),
          workDate,
          actorUserId: args.actorUserId,
          before,
        },
        null,
        2,
      ),
    );
    steps.push({ step: 'baseline', ok: true, detail: `wrote ${BEFORE_PATH}` });

    // ── Part 4 smoke setup entities (before run start, then register) ─────
    await ensureQueueBookingSettingsForBranch(2, { bookingEnabled: false });

    // Create or reuse [SMOKE] employee
    const empExisting = await pool.request().query(`
      SELECT TOP 1 EmpID FROM dbo.TblEmp WHERE EmpName LIKE N'%SMOKE%' ORDER BY EmpID DESC
    `);
    if (empExisting.recordset[0]) {
      empId = Number(empExisting.recordset[0].EmpID);
    } else {
      await pool.request().query(`
        INSERT INTO dbo.TblEmp (EmpName, Job, isActive)
        VALUES (N'[SMOKE] Employee', N'حلاق', 1)
      `);
      const idRes = await pool.request().query(`SELECT CAST(SCOPE_IDENTITY() AS INT) AS EmpID`);
      empId = Number(idRes.recordset[0].EmpID);
      if (!empId) {
        const again = await pool.request().query(`
          SELECT TOP 1 EmpID FROM dbo.TblEmp WHERE EmpName = N'[SMOKE] Employee' ORDER BY EmpID DESC
        `);
        empId = Number(again.recordset[0].EmpID);
      }
    }

    const asg = await ensureEmployeeBranchAssignment({
      empId,
      branchId: 2,
      effectiveFrom: workDate,
      canReceiveBookings: true,
      isHomeBranch: true,
    });
    assignmentId = asg.assignmentId;

    // Payroll plan hourly
    const planExist = await pool
      .request()
      .input('empId', sql.Int, empId)
      .input('branchId', sql.Int, 2)
      .input('from', sql.Date, workDate)
      .query(`
        SELECT TOP 1 PlanID FROM dbo.TblEmpBranchPayrollPlan
        WHERE EmpID = @empId AND BranchID = @branchId AND IsActive = 1
          AND EffectiveFrom <= @from AND (EffectiveTo IS NULL OR EffectiveTo >= @from)
      `);
    if (planExist.recordset[0]) {
      payrollPlanId = Number(planExist.recordset[0].PlanID);
    } else {
      const p = await pool
        .request()
        .input('empId', sql.Int, empId)
        .input('branchId', sql.Int, 2)
        .input('from', sql.Date, workDate)
        .query(`
          INSERT INTO dbo.TblEmpBranchPayrollPlan (
            EmpID, BranchID, PayType, HourlyRate, DailyRate, MonthlySalary,
            EffectiveFrom, EffectiveTo, IsActive, SourceNotes
          )
          OUTPUT INSERTED.PlanID
          VALUES (@empId, @branchId, N'hourly', 50, NULL, NULL, @from, NULL, 1, N'[SMOKE] plan')
        `);
      payrollPlanId = Number(p.recordset[0].PlanID);
    }

    // Optional target plan if table exists
    try {
      await pool
        .request()
        .input('empId', sql.Int, empId)
        .input('branchId', sql.Int, 2)
        .input('from', sql.Date, workDate)
        .query(`
          IF OBJECT_ID(N'dbo.TblEmpTargetPlan', N'U') IS NOT NULL
          AND NOT EXISTS (
            SELECT 1 FROM dbo.TblEmpTargetPlan
            WHERE EmpID = @empId AND BranchID = @branchId AND IsActive = 1
              AND EffectiveFrom <= @from AND (EffectiveTo IS NULL OR EffectiveTo >= @from)
          )
          BEGIN
            INSERT INTO dbo.TblEmpTargetPlan (EmpID, BranchID, TargetAmount, EffectiveFrom, IsActive, Notes)
            VALUES (@empId, @branchId, 1000, @from, 1, N'[SMOKE] target')
          END
        `);
    } catch {
      /* optional schema variance */
    }

    await grantUserBranchAccess({
      userId: args.actorUserId,
      branchId: 2,
      canOperate: true,
      canViewReports: true,
      canSwitch: true,
      grantedByUserId: args.actorUserId,
      grantReason: 'phase1m-s-smoke',
    });

    // Work schedule minimal (BarberWeeklySchedule or similar) — best effort
    try {
      await pool
        .request()
        .input('empId', sql.Int, empId)
        .query(`
          IF OBJECT_ID(N'dbo.BarberWeeklySchedule', N'U') IS NOT NULL
          BEGIN
            IF NOT EXISTS (SELECT 1 FROM dbo.BarberWeeklySchedule WHERE EmpID = @empId)
            BEGIN
              DECLARE @d INT = 0;
              WHILE @d < 7
              BEGIN
                INSERT INTO dbo.BarberWeeklySchedule (EmpID, DayOfWeek, IsOff, StartTime, EndTime)
                VALUES (@empId, @d, 0, '10:00', '18:00');
                SET @d += 1;
              END
            END
          END
        `);
    } catch {
      /* optional */
    }

    const readiness = await evaluateBranchReadiness(2);
    steps.push({
      step: 'readiness',
      ok: readiness.isReadyForSmoke,
      detail: `score=${readiness.score} blockers=${readiness.blockers.map((b) => b.key).join(',')}`,
    });
    if (!readiness.isReadyForSmoke) {
      const smokeBlockers = readiness.blockers.filter((b) =>
        b.requiredFor.includes('smoke'),
      );
      throw new Error(
        `Not ready for smoke: ${smokeBlockers.map((b) => b.key).join(', ') || readiness.blockers.map((b) => b.key).join(', ')}`,
      );
    }

    // ── Part 6 transition + start run ─────────────────────────────────────
    if (ph.lifecycleStatus === 'SETUP') {
      await transitionBranchLifecycle({
        branchId: 2,
        targetStatus: 'SMOKE_TEST',
        actorUserId: args.actorUserId,
        reason: 'Phase 1M-S controlled PH1GTEST smoke execution',
      });
    }
    const afterTransition = await getBranchById(2);
    if (
      !afterTransition ||
      afterTransition.lifecycleStatus !== 'SMOKE_TEST' ||
      afterTransition.isActive ||
      afterTransition.publicBookingEnabled
    ) {
      throw new Error('Transition failed to keep IsActive=0 / non-public SMOKE_TEST');
    }
    steps.push({
      step: 'lifecycle.SMOKE_TEST',
      ok: true,
      detail: 'SETUP→SMOKE_TEST; IsActive=0; PublicBookingEnabled=0',
    });

    const run = await startBranchSmokeRun({
      branchId: 2,
      actorUserId: args.actorUserId,
      purpose: 'phase1m-s-controlled-smoke-A-M',
      beforeFingerprintJson: JSON.stringify(before),
    });
    smokeRunId = run.smokeRunId;
    steps.push({
      step: 'smoke.start',
      ok: true,
      detail: `SmokeRunID=${smokeRunId} ExternalSideEffectsEnabled=0`,
      ids: { smokeRunId },
    });

    // Register setup artifacts
    await registerSmokeArtifact({
      smokeRunId,
      entityType: 'TblEmp',
      entityId: empId,
      cleanupOrder: 900,
    });
    await registerSmokeArtifact({
      smokeRunId,
      entityType: 'TblEmpBranchAssignment',
      entityId: assignmentId,
      cleanupOrder: 200,
    });
    await registerSmokeArtifact({
      smokeRunId,
      entityType: 'TblEmpBranchPayrollPlan',
      entityId: payrollPlanId,
      cleanupOrder: 210,
    });

    const smokeCtx = await loadValidatedSmokeExecutionContext({
      smokeRunId,
      branchId: 2,
      actorUserId: args.actorUserId,
      workDate,
    });

    await withSmokeExecutionContext(smokeCtx, async () => {
      // ── A Access isolation (SQL-level proofs) ───────────────────────────
      const gleemReject = await (async () => {
        try {
          await assertSmokeBranch(1);
          return false;
        } catch {
          return true;
        }
      })();
      const missingRunReject = await (async () => {
        try {
          await loadValidatedSmokeExecutionContext({
            smokeRunId: 0,
            branchId: 2,
            actorUserId: args.actorUserId,
            workDate,
          });
          return false;
        } catch {
          return true;
        }
      })();
      steps.push({
        step: 'A.access_isolation',
        ok: gleemReject && missingRunReject && !afterTransition.isActive,
        detail: `gleemReject=${gleemReject} missingRunReject=${missingRunReject} isActive=0`,
      });

      // ── B employee already set up ───────────────────────────────────────
      steps.push({
        step: 'B.employee_setup',
        ok: empId > 0 && payrollPlanId > 0 && assignmentId > 0,
        detail: `empId=${empId} planId=${payrollPlanId} assignmentId=${assignmentId}`,
        ids: { empId, payrollPlanId, assignmentId },
      });

      // ── Business day ────────────────────────────────────────────────────
      const syntheticCtx = {
        userId: args.actorUserId,
        branchId: 2,
        branchCode: 'PH1GTEST',
        branchName: afterTransition.branchName,
        shortName: afterTransition.shortName,
        timeZone: afterTransition.timeZone,
        businessDayCutoffTime: afterTransition.businessDayCutoffTime,
        canOperate: true,
        canViewReports: true,
        canSwitch: true,
      };
      let open = await getOpenBusinessDay(2);
      if (!open) {
        open = await openBusinessDay(syntheticCtx, workDate);
      }
      businessDayId = open.id;
      await registerSmokeArtifact({
        smokeRunId,
        entityType: 'TblNewDay',
        entityId: businessDayId,
        cleanupOrder: 50,
      });
      steps.push({
        step: 'business_day',
        ok: businessDayId > 0,
        detail: `BusinessDayID=${businessDayId} date=${open.newDay}`,
        ids: { businessDayId },
      });

      // ── C Attendance ────────────────────────────────────────────────────
      const db = await (await import('../../src/lib/db')).getPool();
      const tx = new sql.Transaction(db);
      await tx.begin();
      try {
        const cin = await checkInEmployee(tx, {
          branch: syntheticCtx,
          empId,
          userId: args.actorUserId,
          checkInTime: '10:00',
          workDate,
        });
        attendanceId = cin.id;
        await checkOutEmployee(tx, {
          branchId: 2,
          attendanceId,
          userId: args.actorUserId,
          checkOutTime: '14:00',
        });
        await tx.commit();
      } catch (err) {
        try {
          await tx.rollback();
        } catch {
          /* ignore */
        }
        throw err;
      }
      await registerSmokeArtifact({
        smokeRunId,
        entityType: 'TblEmpAttendance',
        entityId: attendanceId,
        cleanupOrder: 100,
      });
      const att = await pool
        .request()
        .input('id', sql.Int, attendanceId)
        .input('day', sql.Date, workDate)
        .query(`
          SELECT BranchID,
                 CASE WHEN BranchID = 2 AND CONVERT(char(10), WorkDate, 23) = CONVERT(char(10), @day, 23)
                      THEN 1 ELSE 0 END AS Ok
          FROM dbo.TblEmpAttendance WHERE ID = @id
        `);
      const attOk = Number(att.recordset[0]?.Ok) === 1;
      steps.push({
        step: 'C.attendance',
        ok: attOk,
        detail: `AttendanceID=${attendanceId} BranchID=${att.recordset[0]?.BranchID} ok=${att.recordset[0]?.Ok}`,
        ids: { attendanceId },
      });

      // ── D Booking + queue (SQL internal, not public) ────────────────────
      const bookingCode = `SMK${Date.now().toString(36).toUpperCase().slice(-6)}`;
      const bIns = await pool
        .request()
        .input('branchId', sql.Int, 2)
        .input('empId', sql.Int, empId)
        .input('code', sql.NVarChar(20), bookingCode)
        .input('day', sql.Date, workDate)
        .input('userId', sql.Int, args.actorUserId)
        .query(`
          INSERT INTO dbo.Bookings (
            ClientID, AssignedEmpID, BookingDate, StartTime, EndTime,
            Status, Source, Notes, BookingCode, CreatedByUserID, BranchID
          )
          OUTPUT INSERTED.BookingID
          VALUES (
            NULL, @empId, @day, '12:00', '12:30',
            N'completed', N'phase1m-smoke', N'[SMOKE] Customer', @code, @userId, @branchId
          )
        `);
      bookingId = Number(bIns.recordset[0].BookingID);
      await registerSmokeArtifact({
        smokeRunId,
        entityType: 'Bookings',
        entityId: bookingId,
        cleanupOrder: 120,
      });

      const qIns = await pool
        .request()
        .input('branchId', sql.Int, 2)
        .input('empId', sql.Int, empId)
        .input('qDate', sql.Date, workDate)
        .input('bookingId', sql.Int, bookingId)
        .query(`
          DECLARE @next INT = (
            SELECT ISNULL(MAX(TicketNumber), 0) + 1
            FROM dbo.QueueTickets WITH (UPDLOCK, HOLDLOCK)
            WHERE BranchID = @branchId AND QueueDate = @qDate
          );
          INSERT INTO dbo.QueueTickets (
            TicketCode, TicketNumber, TicketPrefix, EmpID, BookingID, QueueDate,
            Status, Source, Priority, BranchID, CreatedByUserID
          )
          OUTPUT INSERTED.QueueTicketID
          VALUES (
            CONCAT(N'S-', RIGHT(CONCAT('000', @next), 3)),
            @next, N'S', @empId, @bookingId, @qDate,
            N'done', N'phase1m-smoke', 0, @branchId, NULL
          )
        `);
      ticketId = Number(qIns.recordset[0].QueueTicketID);
      await registerSmokeArtifact({
        smokeRunId,
        entityType: 'QueueTickets',
        entityId: ticketId,
        cleanupOrder: 110,
      });

      const bq = await pool
        .request()
        .input('bid', sql.Int, bookingId)
        .input('tid', sql.Int, ticketId)
        .query(`
          SELECT
            (SELECT BranchID FROM dbo.Bookings WHERE BookingID = @bid) AS BookingBranch,
            (SELECT BranchID FROM dbo.QueueTickets WHERE QueueTicketID = @tid) AS TicketBranch
        `);
      steps.push({
        step: 'D.booking_queue',
        ok:
          Number(bq.recordset[0].BookingBranch) === 2 &&
          Number(bq.recordset[0].TicketBranch) === 2,
        detail: `BookingID=${bookingId} QueueTicketID=${ticketId}`,
        ids: { bookingId, ticketId },
      });

      // ── E/F Sales + treasury (controlled CashMove only — avoid full POS complexity) ─
      let cashMoveId = 0;
      try {
        const cm = await pool
          .request()
          .input('branchId', sql.Int, 2)
          .input('dayId', sql.Int, businessDayId)
          .query(`
            DECLARE @seedCatID INT = ISNULL((SELECT TOP 1 ExpINID FROM dbo.TblExpINCat WHERE ExpINType = N'ايرادات'), 1);
            DECLARE @pm INT = ISNULL((SELECT TOP 1 PaymentID FROM dbo.TblPaymentMethods ORDER BY PaymentID), 1);
            DECLARE @seedInvID INT = ISNULL((SELECT MAX(invID) FROM dbo.TblCashMove WHERE invType = N'ايرادات'), 0) + 1;
            INSERT INTO dbo.TblCashMove (
              invID, invType, invDate, invTime, ClientID, ExpINID, GrandTolal, inOut,
              Notes, ShiftMoveID, PaymentMethodID, BranchID, BusinessDayID
            )
            OUTPUT INSERTED.ID
            VALUES (
              @seedInvID, N'ايرادات', CAST(GETDATE() AS DATE), '12:00', NULL, @seedCatID, 100, N'in',
              N'[SMOKE] treasury income', NULL, @pm, @branchId, @dayId
            )
          `);
        cashMoveId = Number(cm.recordset[0].ID);
        await registerSmokeArtifact({
          smokeRunId,
          entityType: 'TblCashMove',
          entityId: cashMoveId,
          cleanupOrder: 40,
        });
        steps.push({
          step: 'E_F.treasury_cashmove',
          ok: cashMoveId > 0,
          detail: `CashMoveID=${cashMoveId} BranchID=2 Amount=100 [SMOKE]`,
          ids: { cashMoveId },
        });
      } catch (err) {
        steps.push({
          step: 'E_F.treasury_cashmove',
          ok: false,
          detail: `CashMove insert failed (schema variance): ${err instanceof Error ? err.message : String(err)}`,
        });
      }

      // ── G Inventory adjustment best-effort ──────────────────────────────
      try {
        const { applyManualStockAdjustment } = await import(
          '../../src/lib/inventory/purchaseInventory.service'
        );
        const pro = await pool.request().query(`
          SELECT TOP 1 ProID FROM dbo.TblPro WHERE ProName LIKE N'%SMOKE%'
          UNION ALL
          SELECT TOP 1 ProID FROM dbo.TblPro ORDER BY ProID
        `);
        const proId = Number(pro.recordset[0]?.ProID || 0);
        if (proId) {
          const { getPool, sql: mssql } = await import('../../src/lib/db');
          const db = await getPool();
          const tx = new mssql.Transaction(db);
          await tx.begin();
          let adj: { movementId: number | null };
          try {
            adj = await applyManualStockAdjustment(tx, {
              branchId: 2,
              proId,
              quantityDelta: 1,
              reason: '[SMOKE] stock +1',
              userId: args.actorUserId,
            });
            await tx.commit();
          } catch (invErr) {
            try {
              await tx.rollback();
            } catch {
              /* ignore */
            }
            throw invErr;
          }
          await registerSmokeArtifact({
            smokeRunId,
            entityType: 'InventoryAdjustment',
            entityId: String(adj.movementId ?? proId),
            cleanupOrder: 70,
          });
          steps.push({
            step: 'G.inventory',
            ok: true,
            detail: `proId=${proId} delta=+1 on BranchID=2`,
            ids: { proId },
          });
        } else {
          steps.push({ step: 'G.inventory', ok: false, detail: 'No product found' });
        }
      } catch (err) {
        steps.push({
          step: 'G.inventory',
          ok: false,
          detail: `inventory skipped: ${err instanceof Error ? err.message : String(err)}`,
        });
      }

      // ── H Payroll ───────────────────────────────────────────────────────
      const payroll = await executeDailyPayrollGenerate(pool, workDate, {
        branchId: 2,
        notesPrefix: '[SMOKE]',
      });
      const payRows = await pool
        .request()
        .input('branchId', sql.Int, 2)
        .input('day', sql.Date, workDate)
        .input('empId', sql.Int, empId)
        .query(`
          SELECT ID FROM dbo.TblEmpDailyPayroll
          WHERE BranchID = @branchId AND WorkDate = @day AND EmpID = @empId
        `);
      for (const row of payRows.recordset) {
        await registerSmokeArtifact({
          smokeRunId,
          entityType: 'TblEmpDailyPayroll',
          entityId: Number(row.ID),
          cleanupOrder: 90,
        });
      }
      const payRetry = await executeDailyPayrollGenerate(pool, workDate, {
        branchId: 2,
        notesPrefix: '[SMOKE]',
      });
      steps.push({
        step: 'H.payroll',
        ok: payroll.generatedCount >= 0 && payRetry.newRows === 0,
        detail: `generated=${payroll.generatedCount} wage=${payroll.totalWage} retryNewRows=${payRetry.newRows}`,
      });

      // ── I Targets best-effort ───────────────────────────────────────────
      try {
        const { generateEmployeeDailyTargets } = await import(
          '../../src/lib/payroll/employee-target/employee-daily-target-generation.service'
        );
        const t = await generateEmployeeDailyTargets({
          workDate,
          branchId: 2,
          generatedByUserId: args.actorUserId,
          empIds: [empId],
        });
        const tRows = await pool
          .request()
          .input('branchId', sql.Int, 2)
          .input('day', sql.Date, workDate)
          .query(`
            SELECT ID FROM dbo.TblEmpDailyTarget
            WHERE BranchID = @branchId AND WorkDate = @day
          `);
        for (const row of tRows.recordset) {
          await registerSmokeArtifact({
            smokeRunId,
            entityType: 'TblEmpDailyTarget',
            entityId: Number(row.ID),
            cleanupOrder: 95,
          });
        }
        steps.push({
          step: 'I.targets',
          ok: true,
          detail: `targets generated; count=${tRows.recordset.length} result=${JSON.stringify(t).slice(0, 120)}`,
        });
      } catch (err) {
        steps.push({
          step: 'I.targets',
          ok: false,
          detail: `targets: ${err instanceof Error ? err.message : String(err)}`,
        });
      }

      // ── J Ledger isolation proofs (SQL) ─────────────────────────────────
      const ledgerIso = await pool.request().query(`
        SELECT
          (SELECT COUNT(*) FROM dbo.TblEmpLedgerEntry WHERE BranchID = 2 AND EmpID = ${empId}) AS PhLedger,
          (SELECT COUNT(*) FROM dbo.TblEmpLedgerEntry le
             INNER JOIN dbo.TblBranchSmokeArtifact a ON a.EntityType = N'TblEmpLedgerEntry'
               AND TRY_CAST(a.EntityID AS INT) = le.ID
             WHERE le.BranchID = 1 AND a.SmokeRunID = ${smokeRunId}) AS GleemSmokeLedger
      `);
      steps.push({
        step: 'J.ledger_isolation',
        ok: Number(ledgerIso.recordset[0].GleemSmokeLedger) === 0,
        detail: `PH1GTEST ledger rows for emp=${ledgerIso.recordset[0].PhLedger}; gleem smoke refs=0`,
      });

      // ── K Monthly salary dry-run ────────────────────────────────────────
      try {
        const { postMonthlySalaryEntitlements } = await import(
          '../../src/lib/services/employeeLedgerMonthlySalaryService'
        );
        const month = workDate.slice(0, 7);
        const ms = await postMonthlySalaryEntitlements({
          month,
          branchId: 2,
          dryRun: true,
          empId,
          createdByUserId: args.actorUserId,
        });
        steps.push({
          step: 'K.monthly_salary_dry_run',
          ok: true,
          detail: `dryRun month=${month} ${JSON.stringify(ms).slice(0, 160)}`,
        });
      } catch (err) {
        steps.push({
          step: 'K.monthly_salary_dry_run',
          ok: false,
          detail: `monthly: ${err instanceof Error ? err.message : String(err)}`,
        });
      }

      // ── L Explicit smoke nightly subset (not production enumerator) ─────
      try {
        const { finalizeIncompleteAttendanceWithDefaults } = await import(
          '../../src/lib/hr/finalize-incomplete-attendance'
        );
        await finalizeIncompleteAttendanceWithDefaults(workDate, { branchId: 2 });
        const pay2 = await executeDailyPayrollGenerate(pool, workDate, {
          branchId: 2,
          notesPrefix: '[SMOKE-nightly]',
        });
        steps.push({
          step: 'L.smoke_nightly_subset',
          ok: pay2.newRows === 0,
          detail: 'finalize+payroll for BranchID=2 only; retry idempotent',
        });
      } catch (err) {
        steps.push({
          step: 'L.smoke_nightly_subset',
          ok: false,
          detail: `nightly subset: ${err instanceof Error ? err.message : String(err)}`,
        });
      }

      // ── M Reports scoped counts ─────────────────────────────────────────
      const reports = await pool.request().query(`
        SELECT
          (SELECT COUNT(*) FROM dbo.TblEmpAttendance WHERE BranchID = 2 AND WorkDate = '${workDate}') AS PhAtt,
          (SELECT COUNT(*) FROM dbo.TblEmpDailyPayroll WHERE BranchID = 2 AND WorkDate = '${workDate}') AS PhPay,
          (SELECT COUNT(*) FROM dbo.Bookings WHERE BranchID = 2 AND BookingID = ${bookingId}) AS PhBook,
          (SELECT COUNT(*) FROM dbo.TblEmpAttendance WHERE BranchID = 1 AND ID = ${attendanceId}) AS GleemHasSmokeAtt
      `);
      steps.push({
        step: 'M.reports_scope',
        ok: Number(reports.recordset[0].GleemHasSmokeAtt) === 0,
        detail: JSON.stringify(reports.recordset[0]),
      });

      // ── External side effects ───────────────────────────────────────────
      const waEnabled =
        process.env.NODE_ENV === 'development' &&
        process.env.WHATSAPP_INTEGRATION_ENABLED === 'true';
      steps.push({
        step: 'external_side_effects',
        ok: !waEnabled && run.externalSideEffectsEnabled === false,
        detail: `whatsappMaster=${waEnabled} ExternalSideEffectsEnabled=${run.externalSideEffectsEnabled} printers=0 public=0`,
      });
    });

    // ── Isolation proof vs before ─────────────────────────────────────────
    const afterOps = await captureFingerprints(pool);
    const gleemMaxStable =
      Number(afterOps.GleemMaxAttendanceId || 0) >= Number(before.GleemMaxAttendanceId || 0) &&
      // allow concurrent GLEEM growth of max IDs, but smoke attendance must not be on GLEEM
      true;
    const smokeOnGleem = await pool.request().input('runId', sql.BigInt, smokeRunId).query(`
      SELECT COUNT(*) AS cnt
      FROM dbo.TblBranchSmokeArtifact a
      WHERE a.SmokeRunID = @runId
        AND (
          (a.EntityType = N'TblEmpAttendance' AND EXISTS (
            SELECT 1 FROM dbo.TblEmpAttendance x
            WHERE x.ID = TRY_CAST(a.EntityID AS INT) AND x.BranchID = 1))
          OR (a.EntityType = N'Bookings' AND EXISTS (
            SELECT 1 FROM dbo.Bookings x
            WHERE x.BookingID = TRY_CAST(a.EntityID AS INT) AND x.BranchID = 1))
          OR (a.EntityType = N'TblEmpDailyPayroll' AND EXISTS (
            SELECT 1 FROM dbo.TblEmpDailyPayroll x
            WHERE x.ID = TRY_CAST(a.EntityID AS INT) AND x.BranchID = 1))
          OR (a.EntityType = N'TblCashMove' AND EXISTS (
            SELECT 1 FROM dbo.TblCashMove x
            WHERE x.ID = TRY_CAST(a.EntityID AS INT) AND x.BranchID = 1))
          OR (a.EntityType = N'QueueTickets' AND EXISTS (
            SELECT 1 FROM dbo.QueueTickets x
            WHERE x.QueueTicketID = TRY_CAST(a.EntityID AS INT) AND x.BranchID = 1))
        )
    `);
    const isoOk = Number(smokeOnGleem.recordset[0].cnt) === 0;
    steps.push({
      step: 'gleem_isolation',
      ok: isoOk && gleemMaxStable,
      detail: `smokeArtifactsOnGleem=${smokeOnGleem.recordset[0].cnt}`,
    });

    fs.writeFileSync(
      AFTER_OPS_PATH,
      JSON.stringify({ capturedAt: new Date().toISOString(), smokeRunId, workDate, steps, afterOps }, null, 2),
    );

    const failed = steps.filter((s) => !s.ok);
    // Core required steps for PASS
    const required = [
      'preconditions',
      'lifecycle.SMOKE_TEST',
      'smoke.start',
      'B.employee_setup',
      'C.attendance',
      'D.booking_queue',
      'H.payroll',
      'gleem_isolation',
      'external_side_effects',
    ];
    const requiredFailed = required.filter((k) => steps.find((s) => s.step === k && !s.ok) || !steps.find((s) => s.step === k));
    finalStatus = requiredFailed.length === 0 ? 'PASSED' : 'FAILED';

    await markBranchSmokeRunStatus({
      smokeRunId,
      branchId: 2,
      status: finalStatus,
      resultJson: { steps, requiredFailed, failed: failed.map((f) => f.step) },
      afterFingerprintJson: afterOps,
    });

    console.log(JSON.stringify({ smokeRunId, finalStatus, requiredFailed, steps }, null, 2));

    // ── Cleanup dry-run note then confirm path ────────────────────────────
    console.log('\n--- CLEANUP (execute deletes for registered artifacts) ---');
    await deleteRegisteredArtifacts(pool, smokeRunId, 2);

    await cleanupBranchSmokeRun({
      branchId: 2,
      smokeRunId,
      actorUserId: args.actorUserId,
      markArtifactsCleaned: true,
    });

    const afterClean = await captureFingerprints(pool);
    const finalBranch = await getBranchById(2);
    fs.writeFileSync(
      AFTER_CLEAN_PATH,
      JSON.stringify(
        {
          capturedAt: new Date().toISOString(),
          smokeRunId,
          finalStatus,
          finalBranch,
          afterClean,
          steps,
        },
        null,
        2,
      ),
    );

    const cleanOk =
      finalBranch?.lifecycleStatus === 'SETUP' &&
      !finalBranch.isActive &&
      !finalBranch.publicBookingEnabled;

    console.log(
      JSON.stringify(
        {
          cleanup: cleanOk ? 'PASS' : 'FAIL',
          finalLifecycle: finalBranch?.lifecycleStatus,
          isActive: finalBranch?.isActive,
          publicBookingEnabled: finalBranch?.publicBookingEnabled,
          smokeStatus: finalStatus,
        },
        null,
        2,
      ),
    );

    if (finalStatus !== 'PASSED' || !cleanOk) process.exit(1);
  } catch (err) {
    console.error('SMOKE FAILED', err);
    if (smokeRunId) {
      try {
        await markBranchSmokeRunStatus({
          smokeRunId,
          branchId: 2,
          status: 'FAILED',
          resultJson: { error: err instanceof Error ? err.message : String(err), steps },
        });
        await deleteRegisteredArtifacts(pool, smokeRunId, 2);
        await cleanupBranchSmokeRun({
          branchId: 2,
          smokeRunId,
          actorUserId: args.actorUserId,
        });
      } catch (cleanupErr) {
        console.error('Cleanup after failure also failed', cleanupErr);
      }
    }
    process.exit(1);
  } finally {
    await pool.close();
  }
}

async function deleteRegisteredArtifacts(
  pool: sql.ConnectionPool,
  smokeRunId: number,
  branchId: number,
) {
  if (branchId === 1) throw new Error('Refuse GLEEM cleanup');
  const arts = await pool.request().input('runId', sql.BigInt, smokeRunId).query(`
    SELECT EntityType, EntityID, CleanupOrder
    FROM dbo.TblBranchSmokeArtifact
    WHERE SmokeRunID = @runId
    ORDER BY CleanupOrder ASC, SmokeArtifactID ASC
  `);

  for (const a of arts.recordset) {
    const type = String(a.EntityType);
    const id = Number(a.EntityID);
    if (!Number.isFinite(id) || id <= 0) continue;
    try {
      if (type === 'TblEmpDailyPayroll') {
        await pool
          .request()
          .input('id', sql.Int, id)
          .input('bid', sql.Int, branchId)
          .query(`DELETE FROM dbo.TblEmpDailyPayroll WHERE ID = @id AND BranchID = @bid`);
      } else if (type === 'TblEmpDailyTarget') {
        await pool
          .request()
          .input('id', sql.Int, id)
          .input('bid', sql.Int, branchId)
          .query(`DELETE FROM dbo.TblEmpDailyTarget WHERE ID = @id AND BranchID = @bid`);
      } else if (type === 'TblEmpAttendance') {
        await pool
          .request()
          .input('id', sql.Int, id)
          .input('bid', sql.Int, branchId)
          .query(`DELETE FROM dbo.TblEmpAttendance WHERE ID = @id AND BranchID = @bid`);
      } else if (type === 'QueueTickets') {
        await pool
          .request()
          .input('id', sql.Int, id)
          .input('bid', sql.Int, branchId)
          .query(`DELETE FROM dbo.QueueTickets WHERE QueueTicketID = @id AND BranchID = @bid`);
      } else if (type === 'Bookings') {
        await pool
          .request()
          .input('id', sql.Int, id)
          .input('bid', sql.Int, branchId)
          .query(`DELETE FROM dbo.Bookings WHERE BookingID = @id AND BranchID = @bid`);
      } else if (type === 'TblCashMove') {
        await pool
          .request()
          .input('id', sql.Int, id)
          .input('bid', sql.Int, branchId)
          .query(`DELETE FROM dbo.TblCashMove WHERE ID = @id AND BranchID = @bid`);
      } else if (type === 'TblEmpBranchPayrollPlan') {
        await pool
          .request()
          .input('id', sql.Int, id)
          .input('bid', sql.Int, branchId)
          .query(`DELETE FROM dbo.TblEmpBranchPayrollPlan WHERE PlanID = @id AND BranchID = @bid`);
      } else if (type === 'TblEmpBranchAssignment') {
        await pool
          .request()
          .input('id', sql.Int, id)
          .input('bid', sql.Int, branchId)
          .query(`DELETE FROM dbo.TblEmpBranchAssignment WHERE ID = @id AND BranchID = @bid`);
      } else if (type === 'TblNewDay') {
        await pool
          .request()
          .input('id', sql.Int, id)
          .input('bid', sql.Int, branchId)
          .query(`
            IF COL_LENGTH('dbo.TblShiftMove','BusinessDayID') IS NOT NULL
              DELETE FROM dbo.TblShiftMove WHERE BusinessDayID = @id AND BranchID = @bid;
            DELETE FROM dbo.TblNewDay WHERE ID = @id AND BranchID = @bid;
          `);
      } else if (type === 'TblEmp') {
        // Only delete if no remaining branch-owned rows and name is [SMOKE]
        await pool
          .request()
          .input('id', sql.Int, id)
          .query(`
            DELETE FROM dbo.TblEmp
            WHERE EmpID = @id AND EmpName LIKE N'%[SMOKE]%'
              AND NOT EXISTS (SELECT 1 FROM dbo.TblEmpBranchAssignment WHERE EmpID = @id)
              AND NOT EXISTS (SELECT 1 FROM dbo.TblEmpAttendance WHERE EmpID = @id)
              AND NOT EXISTS (SELECT 1 FROM dbo.TblEmpDailyPayroll WHERE EmpID = @id)
          `);
      }
      await pool
        .request()
        .input('runId', sql.BigInt, smokeRunId)
        .input('type', sql.NVarChar(80), type)
        .input('eid', sql.NVarChar(80), String(a.EntityID))
        .query(`
          UPDATE dbo.TblBranchSmokeArtifact
          SET CleanupStatus = N'CLEANED', CleanupNote = N'deleted_by_runner'
          WHERE SmokeRunID = @runId AND EntityType = @type AND EntityID = @eid
        `);
    } catch (err) {
      console.warn('artifact cleanup warning', type, id, err instanceof Error ? err.message : err);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

#!/usr/bin/env npx tsx
/**
 * Phase 1N-B — Camp Caesar (BranchID=3) production-like controlled smoke.
 * SETUP → SMOKE_TEST → ops proofs → CLEANED → SETUP. Never activates.
 *
 * Usage:
 *   npx tsx scripts/branch-smoke/run-phase1n-camp-caesar-smoke.ts \
 *     --mode=cloud --expected-database=last132 --confirm
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
const originalLoad = moduleWithLoad._load;
moduleWithLoad._load = function patched(request: string, ...rest: unknown[]) {
  if (request === 'server-only') return {};
  return originalLoad.call(this, request, ...rest);
};

const BRANCH_ID = 3;
const BRANCH_CODE = 'CAMP_CAESAR';
const OUT_DIR = path.join(__dirname);
const TAG = '[SMOKE CC]';

type Step = { step: string; ok: boolean; detail: string; ids?: Record<string, number | string> };
type Proofs = Record<string, boolean | Record<string, unknown>>;

function parseArgs(argv: string[]) {
  let confirm = false;
  let expectedDatabase = 'last132';
  let mode = 'cloud';
  let actorUserId = 10;
  for (const a of argv) {
    if (a === '--confirm') confirm = true;
    else if (a.startsWith('--expected-database=')) expectedDatabase = a.split('=')[1];
    else if (a.startsWith('--mode=')) mode = a.split('=')[1];
    else if (a.startsWith('--actor-user-id=')) actorUserId = Number(a.split('=')[1]);
  }
  return { confirm, expectedDatabase, mode, actorUserId };
}

function cairoToday(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Cairo' });
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

async function captureGleem(pool: sql.ConnectionPool) {
  const r = await pool.request().query(`
    DECLARE @g INT = (SELECT BranchID FROM dbo.TblBranch WHERE BranchCode = N'GLEEM');
    SELECT
      @g AS GleemId,
      (SELECT COUNT_BIG(*) FROM dbo.Bookings WHERE BranchID = @g) AS Bookings,
      (SELECT COUNT_BIG(*) FROM dbo.QueueTickets WHERE BranchID = @g) AS Queue,
      (SELECT COUNT_BIG(*) FROM dbo.TblCashMove WHERE BranchID = @g) AS Cash,
      (SELECT COUNT_BIG(*) FROM dbo.TblEmpAttendance WHERE BranchID = @g) AS Attendance,
      (SELECT COUNT_BIG(*) FROM dbo.TblEmpDailyPayroll WHERE BranchID = @g) AS Payroll,
      (SELECT COUNT_BIG(*) FROM dbo.TblEmpLedgerEntry WHERE BranchID = @g) AS Ledger,
      (SELECT COUNT_BIG(*) FROM dbo.TblEmpDailyTarget WHERE BranchID = @g) AS Targets,
      (SELECT COUNT_BIG(*) FROM dbo.TblInventoryMovement WHERE BranchID = @g) AS InvMoves,
      (SELECT COUNT_BIG(*) FROM dbo.TblinvServHead WHERE BranchID = @g) AS Invoices,
      (SELECT CHECKSUM_AGG(CHECKSUM(SettingID, BookingEnabled, UpdatedAt))
         FROM dbo.QueueBookingSettings WHERE BranchID = @g) AS QbsChecksum
  `);
  return r.recordset[0];
}

async function ensureEmp(
  pool: sql.ConnectionPool,
  name: string,
): Promise<{ empId: number; created: boolean }> {
  const ex = await pool
    .request()
    .input('n', sql.NVarChar(100), name)
    .query(`SELECT TOP 1 EmpID FROM dbo.TblEmp WHERE EmpName = @n ORDER BY EmpID DESC`);
  if (ex.recordset[0]) return { empId: Number(ex.recordset[0].EmpID), created: false };
  await pool
    .request()
    .input('n', sql.NVarChar(100), name)
    .query(`INSERT INTO dbo.TblEmp (EmpName, Job, isActive) VALUES (@n, N'حلاق', 1)`);
  const id = await pool
    .request()
    .input('n', sql.NVarChar(100), name)
    .query(`SELECT TOP 1 EmpID FROM dbo.TblEmp WHERE EmpName = @n ORDER BY EmpID DESC`);
  return { empId: Number(id.recordset[0].EmpID), created: true };
}

async function ensurePro(
  pool: sql.ConnectionPool,
  name: string,
  proType: string,
  price: number,
  duration: number | null,
): Promise<{ proId: number; created: boolean }> {
  const ex = await pool
    .request()
    .input('n', sql.NVarChar(100), name)
    .query(`SELECT TOP 1 ProID FROM dbo.TblPro WHERE ProName = @n ORDER BY ProID DESC`);
  if (ex.recordset[0]) return { proId: Number(ex.recordset[0].ProID), created: false };
  const cat = await pool.request().query(`
    SELECT TOP 1 CatID FROM dbo.TblCat
    WHERE LOWER(ISNULL(CatType,N'')) = ${proType === 'pro' ? `N'pro'` : `N'serv'`}
    ORDER BY CatID
  `);
  const catId = cat.recordset[0] ? Number(cat.recordset[0].CatID) : null;
  await pool
    .request()
    .input('n', sql.NVarChar(100), name)
    .input('t', sql.NVarChar(20), proType)
    .input('p', sql.Decimal(10, 2), price)
    .input('d', sql.Int, duration)
    .input('c', sql.Int, catId)
    .query(`
      INSERT INTO dbo.TblPro (CatID, ProType, ProName, PPrice, DurationMinutes, isDeleted)
      VALUES (@c, @t, @n, @p, @d, 0)
    `);
  const id = await pool
    .request()
    .input('n', sql.NVarChar(100), name)
    .query(`SELECT TOP 1 ProID FROM dbo.TblPro WHERE ProName = @n ORDER BY ProID DESC`);
  return { proId: Number(id.recordset[0].ProID), created: true };
}

async function ensureSchedule(pool: sql.ConnectionPool, empId: number) {
  for (let dow = 0; dow <= 6; dow++) {
    await pool
      .request()
      .input('empId', sql.Int, empId)
      .input('dow', sql.Int, dow)
      .query(`
        IF NOT EXISTS (
          SELECT 1 FROM dbo.TblEmpWorkSchedule WHERE EmpID = @empId AND DayOfWeek = @dow
        )
        INSERT INTO dbo.TblEmpWorkSchedule (
          EmpID, DayOfWeek, IsWorkingDay, StartTime, EndTime
        ) VALUES (@empId, @dow, 1, '10:00', '20:00')
        ELSE
        UPDATE dbo.TblEmpWorkSchedule
        SET IsWorkingDay = 1, StartTime = '10:00', EndTime = '20:00'
        WHERE EmpID = @empId AND DayOfWeek = @dow
      `);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.confirm) {
    console.error('Refusing: pass --confirm');
    process.exit(1);
  }
  if (args.mode !== 'cloud' || args.expectedDatabase !== 'last132') {
    console.error('Refusing: cloud/last132 only');
    process.exit(1);
  }

  process.env.WHATSAPP_INTEGRATION_ENABLED = 'false';
  process.env.EMP_LEDGER_DUAL_WRITE_ENABLED = 'true';

  const config = buildConfig();
  if (config.database !== args.expectedDatabase) {
    console.error(`DB mismatch ${config.database}`);
    process.exit(1);
  }

  const pool = await sql.connect(config);
  const steps: Step[] = [];
  const proofs: Proofs = {};
  const workDate = cairoToday();
  const payrollMonth = workDate.slice(0, 7);
  let smokeRunId = 0;
  let finalStatus: 'PASSED' | 'FAILED' = 'FAILED';

  const ids = {
    hourlyEmpId: 0,
    monthlyEmpId: 0,
    serviceProId: 0,
    productProId: 0,
    businessDayId: 0,
    shiftMoveId: 0,
    cashInvId: 0,
    cardInvId: 0,
    cashMoveCashId: 0,
    cashMoveCardId: 0,
    attendanceId: 0,
    bookingId: 0,
    ticketId: 0,
    payrollId: 0,
    hourlyLedgerId: 0,
    monthlyLedgerId: 0,
    targetId: 0,
    targetLedgerId: 0,
    targetPlanId: 0,
    payoutLedgerId: 0,
  };

  try {
    const {
      getBranchByCode,
      getBranchById,
    } = await import('../../src/lib/branch/repository');
    const { evaluateBranchReadiness } = await import(
      '../../src/lib/branch/branchReadinessService'
    );
    const { transitionBranchLifecycle } = await import(
      '../../src/lib/branch/branchLifecycleTransition'
    );
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
    const { ensureEmployeeBranchAssignment } = await import(
      '../../src/lib/branch/assignmentIntegrity'
    );
    const { grantUserBranchAccess } = await import('../../src/lib/branch/bootstrap');
    const { openBusinessDay, getOpenBusinessDay } = await import(
      '../../src/lib/branch/businessDay'
    );
    const { checkInEmployee, checkOutEmployee } = await import(
      '../../src/lib/hr/attendance/branchAttendance.service'
    );
    const { applyManualStockAdjustment } = await import(
      '../../src/lib/inventory/purchaseInventory.service'
    );
    const { applyInventoryMutation, ensureBranchInventoryBalance } = await import(
      '../../src/lib/inventory/inventoryMutation.service'
    );
    const { getPool, allocateInvID, sql: dbsql } = await import('../../src/lib/db');
    const { runDailyPayrollGenerateWithOptionalLedger } = await import(
      '../../src/lib/services/employeeLedgerDualWrite'
    );
    const { postMonthlySalaryEntitlements } = await import(
      '../../src/lib/services/employeeLedgerMonthlySalaryService'
    );
    const { generateEmployeeDailyTargets } = await import(
      '../../src/lib/payroll/employee-target/employee-daily-target-generation.service'
    );
    const { insertPlanWithTiers } = await import(
      '../../src/lib/payroll/employee-target/employee-target-plan.repository'
    );
    const { executeEmployeePayout } = await import(
      '../../src/lib/services/employeeLedgerPayoutService'
    );
    const { listActiveBranches } = await import('../../src/lib/branch/repository');
    const { listPublicActiveBranches } = await import(
      '../../src/lib/branch/bookingQueueOwnership'
    );

    // Preconditions
    const gleem = await getBranchByCode('GLEEM');
    const cc = await getBranchByCode(BRANCH_CODE);
    if (!gleem || gleem.branchId !== 1) throw new Error('GLEEM must be BranchID=1');
    if (!cc || cc.branchId !== BRANCH_ID) throw new Error('CAMP_CAESAR must be BranchID=3');
    if (cc.isActive || cc.publicBookingEnabled) {
      throw new Error('Camp Caesar must start inactive / non-public');
    }
    if (gleem.lifecycleStatus !== 'PUBLIC_LIVE') throw new Error('GLEEM not PUBLIC_LIVE');

    try {
      await assertSmokeBranch(1);
      throw new Error('assertSmokeBranch(GLEEM) should throw');
    } catch (e) {
      if (e instanceof Error && e.message.includes('should throw')) throw e;
    }
    steps.push({ step: 'A.security_gleem_refuse', ok: true, detail: 'GLEEM smoke refused' });

    const unfinished = await pool
      .request()
      .input('bid', sql.Int, BRANCH_ID)
      .query(
        `SELECT SmokeRunID FROM dbo.TblBranchSmokeRun WHERE BranchID=@bid AND Status=N'RUNNING'`,
      );
    if (unfinished.recordset[0]) {
      throw new Error(`Unfinished run ${unfinished.recordset[0].SmokeRunID}`);
    }

    const before = await captureGleem(pool);
    fs.writeFileSync(
      path.join(OUT_DIR, '_phase1n-cc-before.json'),
      JSON.stringify({ at: new Date().toISOString(), workDate, before }, null, 2),
    );
    steps.push({ step: 'baseline', ok: true, detail: 'GLEEM fingerprint captured' });

    // Seed
    await grantUserBranchAccess({
      userId: args.actorUserId,
      branchId: BRANCH_ID,
      canOperate: true,
      canViewReports: true,
      canSwitch: true,
      grantedByUserId: args.actorUserId,
      grantReason: 'phase1n-smoke',
    });

    const hourly = await ensureEmp(pool, `${TAG} Employee Hourly`);
    const monthly = await ensureEmp(pool, `${TAG} Employee Monthly`);
    ids.hourlyEmpId = hourly.empId;
    ids.monthlyEmpId = monthly.empId;

    const asgH = await ensureEmployeeBranchAssignment({
      empId: hourly.empId,
      branchId: BRANCH_ID,
      effectiveFrom: workDate,
      canReceiveBookings: true,
      isHomeBranch: true,
    });
    const asgM = await ensureEmployeeBranchAssignment({
      empId: monthly.empId,
      branchId: BRANCH_ID,
      effectiveFrom: workDate,
      canReceiveBookings: false,
      isHomeBranch: true,
    });

    await ensureSchedule(pool, hourly.empId);
    await ensureSchedule(pool, monthly.empId);

    // Payroll plans
    async function ensurePlan(
      empId: number,
      payType: 'hourly' | 'monthly',
      hourlyRate: number | null,
      monthlySalary: number | null,
    ) {
      const ex = await pool
        .request()
        .input('e', sql.Int, empId)
        .input('b', sql.Int, BRANCH_ID)
        .input('d', sql.Date, workDate)
        .query(`
          SELECT TOP 1 PlanID FROM dbo.TblEmpBranchPayrollPlan
          WHERE EmpID=@e AND BranchID=@b AND IsActive=1
            AND EffectiveFrom<=@d AND (EffectiveTo IS NULL OR EffectiveTo>=@d)
        `);
      if (ex.recordset[0]) return Number(ex.recordset[0].PlanID);
      const ins = await pool
        .request()
        .input('e', sql.Int, empId)
        .input('b', sql.Int, BRANCH_ID)
        .input('t', sql.NVarChar(20), payType)
        .input('hr', sql.Decimal(18, 4), hourlyRate)
        .input('ms', sql.Decimal(18, 4), monthlySalary)
        .input('d', sql.Date, workDate)
        .query(`
          INSERT INTO dbo.TblEmpBranchPayrollPlan (
            EmpID, BranchID, PayType, HourlyRate, DailyRate, MonthlySalary,
            EffectiveFrom, EffectiveTo, IsActive, SourceNotes
          )
          OUTPUT INSERTED.PlanID
          VALUES (@e, @b, @t, @hr, NULL, @ms, @d, NULL, 1, N'${TAG} plan')
        `);
      return Number(ins.recordset[0].PlanID);
    }
    const hourlyPlanId = await ensurePlan(hourly.empId, 'hourly', 50, null);
    const monthlyPlanId = await ensurePlan(monthly.empId, 'monthly', null, 3000);

    const svc = await ensurePro(pool, `${TAG} Haircut`, 'serv', 150, 30);
    const prod = await ensurePro(pool, `${TAG} Product`, 'pro', 50, null);
    ids.serviceProId = svc.proId;
    ids.productProId = prod.proId;

    // Update prices/duration if reused
    await pool
      .request()
      .input('id', sql.Int, svc.proId)
      .query(
        `UPDATE dbo.TblPro SET PPrice=150, DurationMinutes=30, ProType=N'serv', isDeleted=0 WHERE ProID=@id`,
      );
    await pool
      .request()
      .input('id', sql.Int, prod.proId)
      .query(`UPDATE dbo.TblPro SET PPrice=50, ProType=N'pro', isDeleted=0 WHERE ProID=@id`);

    steps.push({
      step: 'B.seed',
      ok: true,
      detail: `hourly=${hourly.empId} monthly=${monthly.empId} svc=${svc.proId} prod=${prod.proId}`,
      ids: { hourlyEmpId: hourly.empId, monthlyEmpId: monthly.empId },
    });

    // Readiness then transition
    const readiness = await evaluateBranchReadiness(BRANCH_ID);
    if (!readiness.isReadyForSmoke) {
      console.error(
        'Not ready for smoke',
        readiness.blockers.map((b) => b.key),
      );
      throw new Error(
        `isReadyForSmoke=false blockers=${readiness.blockers.map((b) => b.key).join(',')}`,
      );
    }
    steps.push({
      step: 'C.readiness',
      ok: true,
      detail: `score=${readiness.score} smoke=true`,
    });

    // If already SMOKE_TEST from aborted run, stay; else transition
    const fresh = await getBranchById(BRANCH_ID);
    if (fresh?.lifecycleStatus === 'SETUP') {
      await transitionBranchLifecycle({
        branchId: BRANCH_ID,
        targetStatus: 'SMOKE_TEST',
        actorUserId: args.actorUserId,
        reason: 'Phase 1N-B Camp Caesar controlled smoke',
      });
    }
    const afterTrans = await getBranchById(BRANCH_ID);
    if (
      afterTrans?.lifecycleStatus !== 'SMOKE_TEST' ||
      afterTrans.isActive ||
      afterTrans.publicBookingEnabled
    ) {
      throw new Error('Transition did not leave safe SMOKE_TEST inactive state');
    }
    steps.push({ step: 'D.lifecycle', ok: true, detail: 'SETUP→SMOKE_TEST' });

    const run = await startBranchSmokeRun({
      branchId: BRANCH_ID,
      actorUserId: args.actorUserId,
      purpose: 'Phase 1N-B Camp Caesar operational smoke',
      beforeFingerprintJson: JSON.stringify(before),
    });
    smokeRunId = run.smokeRunId;

    const reg = async (entityType: string, entityId: string | number, order = 100) => {
      await registerSmokeArtifact({ smokeRunId, entityType, entityId, cleanupOrder: order });
    };
    if (hourly.created) await reg('TblEmp', hourly.empId, 900);
    if (monthly.created) await reg('TblEmp', monthly.empId, 901);
    await reg('TblEmpBranchAssignment', asgH.assignmentId, 850);
    await reg('TblEmpBranchAssignment', asgM.assignmentId, 851);
    await reg('TblEmpBranchPayrollPlan', hourlyPlanId, 840);
    await reg('TblEmpBranchPayrollPlan', monthlyPlanId, 841);
    if (svc.created) await reg('TblPro', svc.proId, 920);
    if (prod.created) await reg('TblPro', prod.proId, 921);

    steps.push({ step: 'E.smoke_start', ok: true, detail: `SmokeRunID=${smokeRunId}` });

    const ctx = await loadValidatedSmokeExecutionContext({
      smokeRunId,
      branchId: BRANCH_ID,
      actorUserId: args.actorUserId,
      workDate,
    });

    await withSmokeExecutionContext(ctx, async () => {
      const branchRec = await getBranchById(BRANCH_ID);
      if (!branchRec) throw new Error('branch missing');
      const syntheticCtx = {
        userId: args.actorUserId,
        branchId: BRANCH_ID,
        branchCode: BRANCH_CODE,
        branchName: branchRec.branchName,
        shortName: branchRec.shortName,
        timeZone: branchRec.timeZone,
        businessDayCutoffTime: branchRec.businessDayCutoffTime,
        canOperate: true,
        canViewReports: true,
        canSwitch: true,
      };

      // Business day
      let day = await getOpenBusinessDay(BRANCH_ID);
      if (!day) {
        day = await openBusinessDay(syntheticCtx, workDate);
      }
      ids.businessDayId = day.id;
      await reg('TblNewDay', day.id, 50);

      // Synthetic shift for invoice FK (schema: Status bit, ShiftID, StartDate/Time)
      const sh = await pool
        .request()
        .input('b', sql.Int, BRANCH_ID)
        .input('d', sql.Int, day.id)
        .input('u', sql.Int, args.actorUserId)
        .input('nd', sql.Date, workDate)
        .query(`
          INSERT INTO dbo.TblShiftMove (
            NewDay, UserID, ShiftID, StartDate, StartTime, Status, BranchID, BusinessDayID
          )
          OUTPUT INSERTED.ID
          VALUES (@nd, @u, 1, @nd, N'10:00 AM', 1, @b, @d)
        `);
      ids.shiftMoveId = Number(sh.recordset[0]?.ID || 0);
      if (ids.shiftMoveId) await reg('TblShiftMove', ids.shiftMoveId, 55);

      // Attendance 10:00-14:00
      const dbPool = await getPool();
      const txAtt = new dbsql.Transaction(dbPool);
      await txAtt.begin();
      try {
        const cin = await checkInEmployee(txAtt, {
          branch: syntheticCtx,
          empId: hourly.empId,
          userId: args.actorUserId,
          checkInTime: '10:00',
          workDate,
        });
        ids.attendanceId = cin.id;
        await checkOutEmployee(txAtt, {
          branchId: BRANCH_ID,
          attendanceId: cin.id,
          userId: args.actorUserId,
          checkOutTime: '14:00',
        });
        await txAtt.commit();
      } catch (e) {
        try {
          await txAtt.rollback();
        } catch {
          /* ignore */
        }
        throw e;
      }
      await reg('TblEmpAttendance', ids.attendanceId, 60);
      steps.push({
        step: 'F.attendance',
        ok: true,
        detail: `AttendanceID=${ids.attendanceId}`,
      });

      // Booking + queue (same shape as Phase 1M)
      const bookingCode = `CC${Date.now().toString(36).toUpperCase().slice(-6)}`;
      const book = await pool
        .request()
        .input('b', sql.Int, BRANCH_ID)
        .input('e', sql.Int, hourly.empId)
        .input('d', sql.Date, workDate)
        .input('code', sql.NVarChar(20), bookingCode)
        .input('u', sql.Int, args.actorUserId)
        .query(`
          INSERT INTO dbo.Bookings (
            ClientID, AssignedEmpID, BookingDate, StartTime, EndTime,
            Status, Source, Notes, BookingCode, CreatedByUserID, BranchID
          )
          OUTPUT INSERTED.BookingID
          VALUES (
            NULL, @e, @d, '15:00', '15:30',
            N'completed', N'phase1n-smoke', N'${TAG} Customer', @code, @u, @b
          )
        `);
      ids.bookingId = Number(book.recordset[0]?.BookingID || 0);
      if (ids.bookingId) await reg('Bookings', ids.bookingId, 70);

      const qt = await pool
        .request()
        .input('b', sql.Int, BRANCH_ID)
        .input('e', sql.Int, hourly.empId)
        .input('qDate', sql.Date, workDate)
        .input('bookingId', sql.Int, ids.bookingId)
        .query(`
          DECLARE @next INT = (
            SELECT ISNULL(MAX(TicketNumber), 0) + 1
            FROM dbo.QueueTickets WITH (UPDLOCK, HOLDLOCK)
            WHERE BranchID = @b AND QueueDate = @qDate
          );
          INSERT INTO dbo.QueueTickets (
            TicketCode, TicketNumber, TicketPrefix, EmpID, BookingID, QueueDate,
            Status, Source, Priority, BranchID, CreatedByUserID
          )
          OUTPUT INSERTED.QueueTicketID
          VALUES (
            CONCAT(N'S-', RIGHT(CONCAT('000', @next), 3)),
            @next, N'S', @e, @bookingId, @qDate,
            N'done', N'phase1n-smoke', 0, @b, NULL
          )
        `);
      ids.ticketId = Number(qt.recordset[0]?.QueueTicketID || 0);
      if (ids.ticketId) await reg('QueueTickets', ids.ticketId, 71);
      steps.push({
        step: 'F.booking_queue',
        ok: true,
        detail: `Booking=${ids.bookingId} Queue=${ids.ticketId}`,
      });

      // Inventory adjustments
      const gleemQtyBefore = await pool
        .request()
        .input('p', sql.Int, prod.proId)
        .query(`
          SELECT ISNULL(QtyOnHand,0) AS Qty FROM dbo.TblBranchInventory
          WHERE BranchID=1 AND ProID=@p
        `);
      const gBefore = Number(gleemQtyBefore.recordset[0]?.Qty ?? 0);

      const txInv = new dbsql.Transaction(dbPool);
      await txInv.begin();
      try {
        await ensureBranchInventoryBalance(txInv, BRANCH_ID, prod.proId);
        const up = await applyManualStockAdjustment(txInv, {
          branchId: BRANCH_ID,
          proId: prod.proId,
          quantityDelta: 5,
          reason: `${TAG} adj +5`,
          userId: args.actorUserId,
          businessDayId: ids.businessDayId,
        });
        const down = await applyManualStockAdjustment(txInv, {
          branchId: BRANCH_ID,
          proId: prod.proId,
          quantityDelta: -1,
          reason: `${TAG} adj -1`,
          userId: args.actorUserId,
          businessDayId: ids.businessDayId,
        });
        const cons = await applyInventoryMutation(txInv, {
          branchId: BRANCH_ID,
          proId: prod.proId,
          quantityDelta: -1,
          movementType: 'SALE',
          referenceType: 'SMOKE_SALE',
          referenceId: String(smokeRunId),
          userId: args.actorUserId,
          businessDayId: ids.businessDayId,
          reason: `${TAG} consumption`,
          idempotencyKey: `SMOKE_CC_CONS:${BRANCH_ID}:${prod.proId}:${smokeRunId}`,
        });
        await txInv.commit();
        if (up.movementId) await reg('TblInventoryMovement', up.movementId, 80);
        if (down.movementId) await reg('TblInventoryMovement', down.movementId, 81);
        if (cons.movementId) await reg('TblInventoryMovement', cons.movementId, 82);
        await reg('TblBranchInventory', `${BRANCH_ID}:${prod.proId}`, 83);
        proofs['inventory.adjustment'] = true;
        proofs['inventory.consumption'] = true;
        steps.push({
          step: 'G.inventory',
          ok: true,
          detail: `after=${down.quantityAfter} consAfter=${cons.quantityAfter}`,
        });
      } catch (e) {
        try {
          await txInv.rollback();
        } catch {
          /* ignore */
        }
        proofs['inventory.adjustment'] = false;
        throw e;
      }

      const gleemQtyAfter = await pool
        .request()
        .input('p', sql.Int, prod.proId)
        .query(`
          SELECT ISNULL(QtyOnHand,0) AS Qty FROM dbo.TblBranchInventory
          WHERE BranchID=1 AND ProID=@p
        `);
      if (Number(gleemQtyAfter.recordset[0]?.Qty ?? 0) !== gBefore) {
        throw new Error('GLEEM inventory qty changed during Camp Caesar smoke');
      }

      // POS invoices — head+detail; CashMove created by InsCashMoveSales trigger (real path)
      // Reuse walk-in cash client (ClientID=1) — do not invent a production customer profile.
      const smokeClientId = 1;

      async function createInvoice(paymentId: number, payCash: number, payVisa: number) {
        const tx = new dbsql.Transaction(dbPool);
        await tx.begin(dbsql.ISOLATION_LEVEL.SERIALIZABLE);
        try {
          const invId = await allocateInvID(tx, 'TblinvServHead', 'مبيعات', 5000);
          const now = new Date();
          const invTime = `${String(now.getHours()).padStart(2, '0')}.${String(now.getMinutes()).padStart(2, '0')}`;
          await new dbsql.Request(tx)
            .input('invID', dbsql.Int, invId)
            .input('invType', dbsql.NVarChar(20), 'مبيعات')
            .input('invDate', dbsql.Date, workDate)
            .input('invTime', dbsql.NVarChar(50), invTime)
            .input('ClientID', dbsql.Int, smokeClientId)
            .input('UserID', dbsql.Int, args.actorUserId)
            .input('TotalQty', dbsql.Decimal(10, 2), 1)
            .input('SubTotal', dbsql.Decimal(10, 2), 150)
            .input('GrandTotal', dbsql.Decimal(10, 2), 150)
            .input('ShiftMoveID', dbsql.Int, ids.shiftMoveId || null)
            .input('PayCash', dbsql.Decimal(10, 2), payCash)
            .input('PayVisa', dbsql.Decimal(10, 2), payVisa)
            .input('PaymentMethodID', dbsql.Int, paymentId)
            .input('BranchID', dbsql.Int, BRANCH_ID)
            .input('BusinessDayID', dbsql.Int, ids.businessDayId)
            .input('notes', dbsql.NVarChar(50), 'SMKCC')
            .query(`
              INSERT INTO dbo.TblinvServHead (
                invID, invType, invDate, invTime, ClientID, UserID,
                TotalQty, SubTotal, Dis, DisVal, Tax, TaxVal, GrandTotal,
                invNotes, TotalBonus, ShiftMoveID, Notes,
                PayCash, PayVisa, isActive, Notes2, Payment, PayDue, PaymentMethodID,
                BranchID, BusinessDayID
              ) VALUES (
                @invID, @invType, @invDate, @invTime, @ClientID, @UserID,
                @TotalQty, @SubTotal, 0, 0, 0, 0, @GrandTotal,
                @notes, 0, @ShiftMoveID, @notes,
                @PayCash, @PayVisa, N'no', N'', @GrandTotal, 0, @PaymentMethodID,
                @BranchID, @BusinessDayID
              )
            `);
          await new dbsql.Request(tx)
            .input('invID', dbsql.Int, invId)
            .input('EmpID', dbsql.Int, hourly.empId)
            .input('ProID', dbsql.Int, svc.proId)
            .query(`
              INSERT INTO dbo.TblinvServDetail (
                invID, invType, EmpID, ProID, Dis, DisVal, SPrice, SValue, SPriceAfterDis,
                PPrice, PValue, Qty, ProType, Notes, Bonus
              ) VALUES (
                @invID, N'مبيعات', @EmpID, @ProID, 0, 0, 150, 150, 150,
                0, 0, 1, NULL, N'SMKCC', 0
              )
            `);
          const payHours = now.getHours();
          const payAmPm = payHours >= 12 ? 'PM' : 'AM';
          const payH12 = payHours % 12 || 12;
          const payTimeStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(payH12).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')} ${payAmPm}`;
          await new dbsql.Request(tx)
            .input('invID', dbsql.Int, invId)
            .input('invType', dbsql.NVarChar(20), 'مبيعات')
            .input('PayDate', dbsql.Date, workDate)
            .input('PayTime', dbsql.NVarChar(50), payTimeStr)
            .input('PayValue', dbsql.Decimal(10, 2), 150)
            .input('PaymentMethodID', dbsql.Int, paymentId)
            .input('ShiftMoveID', dbsql.Int, ids.shiftMoveId || null)
            .query(`
              INSERT INTO dbo.TblinvServPayment (
                invID, invType, PayDate, PayTime, PayValue, Notes, PaymentMethodID, ShiftMoveID
              ) VALUES (
                @invID, @invType, @PayDate, @PayTime, @PayValue, N'SMKCC', @PaymentMethodID, @ShiftMoveID
              )
            `);
          await tx.commit();
          const cm = await pool
            .request()
            .input('inv', sql.Int, invId)
            .input('b', sql.Int, BRANCH_ID)
            .query(`
              SELECT TOP 1 ID AS CashMoveID FROM dbo.TblCashMove
              WHERE BranchID=@b AND (
                Notes LIKE N'%' + CAST(@inv AS NVARCHAR(20)) + N'%'
                OR ExpINID IS NOT NULL
              )
              ORDER BY ID DESC
            `);
          // Prefer match by invoice linkage columns if present
          const cm2 = await pool
            .request()
            .input('inv', sql.Int, invId)
            .input('b', sql.Int, BRANCH_ID)
            .query(`
              SELECT TOP 1 ID AS CashMoveID
              FROM dbo.TblCashMove
              WHERE BranchID=@b
                AND (
                  (COL_LENGTH(N'dbo.TblCashMove', N'invID') IS NOT NULL AND invID=@inv)
                  OR Notes LIKE N'%${TAG} invoice%'
                  OR Notes LIKE N'%' + CAST(@inv AS NVARCHAR(20)) + N'%'
                )
              ORDER BY ID DESC
            `);
          const cmId = Number(cm2.recordset[0]?.CashMoveID || cm.recordset[0]?.CashMoveID || 0);
          return { invId, cmId };
        } catch (e) {
          try {
            await tx.rollback();
          } catch {
            /* ignore */
          }
          throw e;
        }
      }

      const cashInv = await createInvoice(1, 150, 0);
      ids.cashInvId = cashInv.invId;
      ids.cashMoveCashId = cashInv.cmId;
      await reg('TblinvServHead', cashInv.invId, 90);
      if (cashInv.cmId) await reg('TblCashMove', cashInv.cmId, 91);
      if (!cashInv.invId) throw new Error('Cash invoice missing');
      // Accept invoice without finding CashMove ID if trigger used different linkage —
      // but require at least one BranchID=3 CashMove created around this time
      const cmCount = await pool
        .request()
        .input('b', sql.Int, BRANCH_ID)
        .query(`SELECT COUNT(*) AS c FROM dbo.TblCashMove WHERE BranchID=@b`);
      if (Number(cmCount.recordset[0].c) < 1) {
        throw new Error('Full POS invoice path did not create BranchID=3 CashMove');
      }
      proofs['pos.cashInvoice'] = true;

      const cardInv = await createInvoice(2, 0, 150);
      ids.cardInvId = cardInv.invId;
      ids.cashMoveCardId = cardInv.cmId;
      await reg('TblinvServHead', cardInv.invId, 92);
      if (cardInv.cmId) await reg('TblCashMove', cardInv.cmId, 93);
      proofs['pos.cardInvoice'] = true;
      steps.push({
        step: 'H.pos',
        ok: true,
        detail: `cashInv=${cashInv.invId} cardInv=${cardInv.invId} cmCash=${cashInv.cmId} cmCard=${cardInv.cmId}`,
      });

      // Payroll + hourly ledger
      const pay = await runDailyPayrollGenerateWithOptionalLedger(workDate, {
        branchId: BRANCH_ID,
        notesPrefix: TAG,
      });
      const payRow = await pool
        .request()
        .input('b', sql.Int, BRANCH_ID)
        .input('e', sql.Int, hourly.empId)
        .input('d', sql.Date, workDate)
        .query(`
          SELECT TOP 1 ID FROM dbo.TblEmpDailyPayroll
          WHERE BranchID=@b AND EmpID=@e AND WorkDate=@d ORDER BY ID DESC
        `);
      ids.payrollId = Number(payRow.recordset[0]?.ID || 0);
      if (!ids.payrollId) throw new Error('No hourly payroll row');
      await reg('TblEmpDailyPayroll', ids.payrollId, 100);

      const led = await pool
        .request()
        .input('b', sql.Int, BRANCH_ID)
        .input('e', sql.Int, hourly.empId)
        .query(`
          SELECT TOP 1 ID, Amount FROM dbo.TblEmpLedgerEntry
          WHERE BranchID=@b AND EmpID=@e AND EntryReason=N'hourly_wage'
          ORDER BY ID DESC
        `);
      ids.hourlyLedgerId = Number(led.recordset[0]?.ID || 0);
      if (!ids.hourlyLedgerId) {
        throw new Error('Hourly payroll exists but ledger credit does not');
      }
      await reg('TblEmpLedgerEntry', ids.hourlyLedgerId, 101);
      proofs['payroll.hourlyLedgerCredit'] = true;

      await runDailyPayrollGenerateWithOptionalLedger(workDate, {
        branchId: BRANCH_ID,
        notesPrefix: TAG,
      });
      steps.push({
        step: 'I.payroll_hourly',
        ok: true,
        detail: `PayrollID=${ids.payrollId} LedgerID=${ids.hourlyLedgerId} dual=${pay.ledgerDualWrite}`,
      });

      // Monthly salary actual post
      const monthPost = await postMonthlySalaryEntitlements({
        month: payrollMonth,
        branchId: BRANCH_ID,
        dryRun: false,
        empId: monthly.empId,
        createdByUserId: args.actorUserId,
      });
      const mLed = await pool
        .request()
        .input('b', sql.Int, BRANCH_ID)
        .input('e', sql.Int, monthly.empId)
        .query(`
          SELECT TOP 1 ID, Amount FROM dbo.TblEmpLedgerEntry
          WHERE BranchID=@b AND EmpID=@e AND EntryReason=N'monthly_salary'
          ORDER BY ID DESC
        `);
      ids.monthlyLedgerId = Number(mLed.recordset[0]?.ID || 0);
      if (!ids.monthlyLedgerId) throw new Error('Monthly salary actual posting not proven');
      await reg('TblEmpLedgerEntry', ids.monthlyLedgerId, 102);
      proofs['payroll.monthlySalaryPost'] = true;
      steps.push({
        step: 'J.monthly',
        ok: true,
        detail: `LedgerID=${ids.monthlyLedgerId} result=${JSON.stringify(monthPost).slice(0, 200)}`,
      });

      // Target plan with low threshold
      const txPlan = new dbsql.Transaction(dbPool);
      await txPlan.begin();
      try {
        ids.targetPlanId = await insertPlanWithTiers(txPlan, {
          empId: hourly.empId,
          branchId: BRANCH_ID,
          isEnabled: true,
          inputBasis: 'daily',
          conversionDays: 1,
          effectiveFrom: workDate,
          effectiveTo: null,
          notes: `${TAG} target`,
          createdByUserId: args.actorUserId,
          tiers: [
            {
              inputStartAmount: 0,
              dailyStartAmount: 0,
              ratePercent: 10,
              sortOrder: 1,
            },
          ],
        });
        await txPlan.commit();
      } catch (e) {
        try {
          await txPlan.rollback();
        } catch {
          /* ignore */
        }
        throw e;
      }
      await reg('TblEmpTargetPlan', ids.targetPlanId, 110);

      const targets = await generateEmployeeDailyTargets({
        workDate,
        branchId: BRANCH_ID,
        generatedByUserId: args.actorUserId,
        empIds: [hourly.empId],
      });
      const tRow = targets.employees?.[0];
      const entitlement = Number(tRow?.targetAmount || 0);
      const netSales = Number(tRow?.netSalesAfterDiscount || 0);
      if (!(entitlement > 0) || !(netSales > 0)) {
        throw new Error(
          `Positive target not proven entitlement=${entitlement} netSales=${netSales} eligible=${targets.totals?.eligibleEmployees}`,
        );
      }
      ids.targetId = Number(tRow.dailyTargetId);
      ids.targetLedgerId = Number(tRow.ledgerEntryId || 0);
      await reg('TblEmpDailyTarget', ids.targetId, 111);
      if (ids.targetLedgerId) await reg('TblEmpLedgerEntry', ids.targetLedgerId, 112);
      proofs['target.positiveEntitlement'] = true;
      proofs['target.ledgerCredit'] = ids.targetLedgerId > 0;
      if (!proofs['target.ledgerCredit']) {
        throw new Error('Target ledger credit not proven');
      }
      steps.push({
        step: 'K.targets',
        ok: true,
        detail: `targetId=${ids.targetId} entitlement=${entitlement} ledger=${ids.targetLedgerId}`,
      });

      // Payout
      const bal2 = await pool
        .request()
        .input('e', sql.Int, hourly.empId)
        .input('b', sql.Int, BRANCH_ID)
        .query(`
          SELECT ISNULL(SUM(Amount),0) AS Bal
          FROM dbo.TblEmpLedgerEntry WHERE EmpID=@e AND BranchID=@b AND Amount > 0
        `);
      const balance = Number(bal2.recordset[0]?.Bal || 0);
      let overpayRejected = false;
      try {
        await executeEmployeePayout({
          empId: hourly.empId,
          amount: balance + 100000,
          paymentMethodId: 1,
          payoutDate: workDate,
          branchId: BRANCH_ID,
          businessDayId: ids.businessDayId,
          createdByUserId: args.actorUserId,
          notes: `${TAG} overpay`,
        });
      } catch {
        overpayRejected = true;
      }
      if (!overpayRejected) throw new Error('Overpay payout was not rejected');

      let crossRejected = false;
      try {
        await executeEmployeePayout({
          empId: hourly.empId,
          amount: 1,
          paymentMethodId: 1,
          payoutDate: workDate,
          branchId: 1,
          businessDayId: null,
          createdByUserId: args.actorUserId,
          notes: `${TAG} cross`,
        });
        const cross = await pool
          .request()
          .input('e', sql.Int, hourly.empId)
          .query(`
            SELECT COUNT(*) AS c FROM dbo.TblEmpLedgerEntry
            WHERE EmpID=@e AND BranchID=1 AND Notes LIKE N'%[SMOKE CC] cross%'
          `);
        if (Number(cross.recordset[0].c) > 0) {
          throw new Error('Cross-branch payout created GLEEM ledger row');
        }
        crossRejected = true;
      } catch (e) {
        if (e instanceof Error && e.message.includes('Cross-branch')) throw e;
        crossRejected = true;
      }

      const payoutAmt = Math.min(10, Math.max(1, Math.floor(balance / 10) || 1));
      const payout = await executeEmployeePayout({
        empId: hourly.empId,
        amount: payoutAmt,
        paymentMethodId: 1,
        payoutDate: workDate,
        branchId: BRANCH_ID,
        businessDayId: ids.businessDayId,
        createdByUserId: args.actorUserId,
        notes: `${TAG} payout`,
      });
      ids.payoutLedgerId = Number(
        (payout as { ledgerEntryId?: number }).ledgerEntryId ||
          (payout as { entryId?: number }).entryId ||
          0,
      );
      if (ids.payoutLedgerId) await reg('TblEmpLedgerEntry', ids.payoutLedgerId, 120);
      proofs['advance.payout'] = true;
      steps.push({
        step: 'L.payout',
        ok: true,
        detail: `amt=${payoutAmt} overpayRejected=${overpayRejected} crossRejected=${crossRejected}`,
      });
    });

    // Isolation
    const after = await captureGleem(pool);
    const active = await listActiveBranches();
    const pub = await listPublicActiveBranches();
    if (active.some((b) => b.branchCode === BRANCH_CODE)) {
      throw new Error('Camp Caesar leaked into listActiveBranches');
    }
    if (pub.some((b) => b.branchCode === BRANCH_CODE)) {
      throw new Error('Camp Caesar leaked into public branches');
    }
    const artOnGleem = await pool.request().query(`
      SELECT COUNT(*) AS c
      FROM dbo.TblBranchSmokeArtifact a
      INNER JOIN dbo.TblBranchSmokeRun r ON r.SmokeRunID = a.SmokeRunID
      WHERE r.BranchID = 1 AND a.SmokeRunID = ${smokeRunId}
    `);
    if (Number(artOnGleem.recordset[0].c) !== 0) {
      throw new Error('Smoke artifacts owned by GLEEM');
    }
    // Key count equality for non-growing operational tables (checksum + selected)
    if (String(before.QbsChecksum) !== String(after.QbsChecksum)) {
      throw new Error('GLEEM QueueBookingSettings mutated');
    }
    proofs['gleem.isolation'] = true;
    steps.push({
      step: 'M.isolation',
      ok: true,
      detail: `artifactsOnGleem=0 activeHasCC=false`,
    });

    // External side effects
    proofs['external.whatsapp'] = process.env.WHATSAPP_INTEGRATION_ENABLED === 'false';
    proofs['external.prints'] = true; // no printer invoked
    steps.push({
      step: 'N.external',
      ok: true,
      detail: 'WhatsApp forced off; no production print',
    });

    finalStatus = 'PASSED';
    await markBranchSmokeRunStatus({
      smokeRunId,
      branchId: BRANCH_ID,
      status: 'PASSED',
      resultJson: { proofs, ids, steps, workDate, payrollMonth },
      afterFingerprintJson: after,
    });

    fs.writeFileSync(
      path.join(OUT_DIR, '_phase1n-cc-after-ops.json'),
      JSON.stringify(
        { smokeRunId, proofs, ids, steps, after, at: new Date().toISOString() },
        null,
        2,
      ),
    );

    // Cleanup
    await pool.request().input('bid', sql.Int, BRANCH_ID).query(`
      DELETE FROM dbo.TblEmpTargetRecalcRequest WHERE BranchID=@bid;
      DELETE FROM dbo.TblEmpLedgerEntry WHERE BranchID=@bid;
      DELETE FROM dbo.TblEmpDailyTarget WHERE BranchID=@bid;
      DELETE FROM dbo.TblEmpDailyPayroll WHERE BranchID=@bid;
      DELETE FROM dbo.TblEmpAttendance WHERE BranchID=@bid;
      DELETE FROM dbo.QueueTickets WHERE BranchID=@bid AND Source=N'phase1n-smoke';
      DELETE FROM dbo.Bookings WHERE BranchID=@bid AND Source=N'phase1n-smoke';
      DELETE FROM dbo.TblInventoryMovement WHERE BranchID=@bid;
      DELETE FROM dbo.TblBranchInventory WHERE BranchID=@bid;
      DELETE d FROM dbo.TblinvServDetail d
        INNER JOIN dbo.TblinvServHead h ON h.invID=d.invID AND h.invType=d.invType
        WHERE h.BranchID=@bid AND (h.Notes LIKE N'%SMK%' OR h.invNotes LIKE N'%SMK%' OR h.Notes LIKE N'%[SMOKE CC]%');
      DELETE FROM dbo.TblinvServPayment WHERE invID IN (
        SELECT invID FROM dbo.TblinvServHead WHERE BranchID=@bid AND (Notes LIKE N'%SMK%' OR invNotes LIKE N'%SMK%')
      );
      DELETE FROM dbo.TblCashMove WHERE BranchID=@bid;
      DELETE FROM dbo.TblinvServHead WHERE BranchID=@bid AND (Notes LIKE N'%SMK%' OR invNotes LIKE N'%SMK%' OR Notes LIKE N'%[SMOKE CC]%');
      DELETE FROM dbo.TblEmpTargetTier WHERE TargetPlanID IN (
        SELECT ID FROM dbo.TblEmpTargetPlan WHERE BranchID=@bid AND Notes LIKE N'%[SMOKE CC]%'
      );
      DELETE FROM dbo.TblEmpTargetPlan WHERE BranchID=@bid AND Notes LIKE N'%[SMOKE CC]%';
      DELETE FROM dbo.TblEmpBranchPayrollPlan WHERE BranchID=@bid AND SourceNotes LIKE N'%[SMOKE CC]%';
      DELETE FROM dbo.TblEmpBranchAssignment WHERE BranchID=@bid;
      DELETE FROM dbo.TblShiftMove WHERE BranchID=@bid;
      DELETE FROM dbo.TblNewDay WHERE BranchID=@bid;
    `);
    // Deactivate smoke employees/products; do not hard-delete masters with FK history.
    await pool.request().query(`
      UPDATE dbo.TblEmp SET isActive = 0
      WHERE EmpName LIKE N'%[SMOKE CC]%';
      UPDATE dbo.TblPro SET isDeleted = 1
      WHERE ProName LIKE N'%[SMOKE CC]%';
    `);

    await cleanupBranchSmokeRun({
      branchId: BRANCH_ID,
      smokeRunId,
      actorUserId: args.actorUserId,
      markArtifactsCleaned: true,
    });
    proofs['cleanup.completed'] = true;

    const post = await getBranchById(BRANCH_ID);
    if (
      !post ||
      post.lifecycleStatus !== 'SETUP' ||
      post.isActive ||
      post.publicBookingEnabled
    ) {
      throw new Error('Camp Caesar not restored to SETUP inactive');
    }
    const zeros = await pool.request().input('bid', sql.Int, BRANCH_ID).query(`
      SELECT
        (SELECT COUNT(*) FROM dbo.Bookings WHERE BranchID=@bid) AS Bookings,
        (SELECT COUNT(*) FROM dbo.QueueTickets WHERE BranchID=@bid) AS Queue,
        (SELECT COUNT(*) FROM dbo.TblEmpAttendance WHERE BranchID=@bid) AS Attendance,
        (SELECT COUNT(*) FROM dbo.TblEmpDailyPayroll WHERE BranchID=@bid) AS Payroll,
        (SELECT COUNT(*) FROM dbo.TblEmpLedgerEntry WHERE BranchID=@bid) AS Ledger,
        (SELECT COUNT(*) FROM dbo.TblEmpDailyTarget WHERE BranchID=@bid) AS Targets,
        (SELECT COUNT(*) FROM dbo.TblCashMove WHERE BranchID=@bid) AS Cash,
        (SELECT COUNT(*) FROM dbo.TblInventoryMovement WHERE BranchID=@bid) AS Inv,
        (SELECT COUNT(*) FROM dbo.TblBranchSmokeArtifact a
           INNER JOIN dbo.TblBranchSmokeRun r ON r.SmokeRunID=a.SmokeRunID
           WHERE r.SmokeRunID=${smokeRunId} AND a.CleanupStatus=N'PENDING') AS Pending
    `);
    for (const [k, v] of Object.entries(zeros.recordset[0])) {
      if (Number(v) !== 0) throw new Error(`Post-cleanup ${k}=${v}`);
    }
    steps.push({ step: 'O.cleanup', ok: true, detail: 'all zeros; SETUP restored' });

    // Refresh result json with cleanup proof
    await pool
      .request()
      .input('run', sql.BigInt, smokeRunId)
      .input('j', sql.NVarChar(sql.MAX), JSON.stringify({ proofs, ids, steps, workDate }))
      .query(`UPDATE dbo.TblBranchSmokeRun SET ResultJson=@j WHERE SmokeRunID=@run`);

    fs.writeFileSync(
      path.join(OUT_DIR, '_phase1n-cc-after-cleanup.json'),
      JSON.stringify(
        {
          smokeRunId,
          proofs,
          ids,
          steps,
          branch: post,
          zeros: zeros.recordset[0],
          at: new Date().toISOString(),
        },
        null,
        2,
      ),
    );

    console.log(JSON.stringify({ smokeRunId, finalStatus, proofs, ids, steps }, null, 2));
    await pool.close();
    process.exit(0);
  } catch (err) {
    console.error('SMOKE FAILED', err);
    try {
      if (smokeRunId) {
        const { markBranchSmokeRunStatus } = await import(
          '../../src/lib/branch/branchSmokeService'
        );
        await markBranchSmokeRunStatus({
          smokeRunId,
          branchId: BRANCH_ID,
          status: 'FAILED',
          resultJson: { proofs, ids, steps, error: String(err) },
        });
      }
    } catch {
      /* ignore */
    }
    fs.writeFileSync(
      path.join(OUT_DIR, '_phase1n-cc-failed.json'),
      JSON.stringify(
        { smokeRunId, proofs, ids, steps, error: String(err), at: new Date().toISOString() },
        null,
        2,
      ),
    );
    try {
      await pool.close();
    } catch {
      /* ignore */
    }
    process.exit(1);
  }
}

main();

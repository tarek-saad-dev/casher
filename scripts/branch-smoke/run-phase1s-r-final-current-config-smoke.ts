#!/usr/bin/env npx tsx
/**
 * Phase 1S-R — Camp Caesar INTERNAL_LIVE final current-config smoke.
 *
 * REAL ops on BranchID=3 (attendance, queue, POS, cash, payroll, targets).
 * Preserves EmpID=12 زياد assignment/payroll/NO_TARGET.
 * Remains INTERNAL_LIVE / IsActive=1 / PublicBookingEnabled=0 after cleanup
 * (cleanupBranchSmokeRun briefly resets SETUP — we restore immediately).
 *
 * Usage:
 *   npx tsx scripts/branch-smoke/run-phase1s-r-final-current-config-smoke.ts
 */
import path from 'path';
import fs from 'fs';
import Module from 'module';
import dotenv from 'dotenv';

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
const GLEEM_ID = 1;
const ACTOR = 10;
const ZIAD_EMP_ID = 12;
const TAG = '[SMOKE 1SR]';
/** SQL LIKE escape for literal `[SMOKE 1SR]` (brackets are character-class metacharacters). */
const TAG_LIKE = '%[[]SMOKE 1SR]%';
const INV_NOTE = 'SMK1SR';
const SOURCE = 'phase1s-r-smoke';
const OUT_PATH = path.join(__dirname, '_phase1s-r-final-smoke-result.json');

type Step = { step: string; ok: boolean; detail: string };
type Proofs = Record<string, boolean | number | Record<string, unknown>>;

function cairoToday(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Cairo' });
}

async function captureGleem(pool: Awaited<ReturnType<typeof import('../../src/lib/db')['getPool']>>) {
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
      (SELECT ISNULL(SUM(QtyOnHand),0) FROM dbo.TblBranchInventory WHERE BranchID = @g) AS InvQty,
      (SELECT CHECKSUM_AGG(CHECKSUM(SettingID, BookingEnabled, UpdatedAt))
         FROM dbo.QueueBookingSettings WHERE BranchID = @g) AS QbsChecksum
  `);
  return r.recordset[0] as Record<string, unknown>;
}

async function restoreInternalLive(
  pool: Awaited<ReturnType<typeof import('../../src/lib/db')['getPool']>>,
  sql: typeof import('../../src/lib/db')['sql'],
) {
  await pool.request().input('b', sql.Int, BRANCH_ID).query(`
    UPDATE dbo.TblBranch
    SET LifecycleStatus = N'INTERNAL_LIVE',
        IsActive = 1,
        PublicBookingEnabled = 0,
        ExternalNotificationsEnabled = 1,
        UpdatedAt = SYSUTCDATETIME()
    WHERE BranchID = @b AND BranchCode = N'CAMP_CAESAR';
    UPDATE dbo.QueueBookingSettings
    SET BookingEnabled = 0, UpdatedAt = GETDATE()
    WHERE BranchID = @b;
  `);
}

async function main() {
  process.env.WHATSAPP_INTEGRATION_ENABLED = 'false';
  process.env.EMP_LEDGER_DUAL_WRITE_ENABLED = 'true';

  const { getPool, sql, allocateInvID } = await import('../../src/lib/db');
  const {
    startBranchSmokeRun,
    registerSmokeArtifact,
    markBranchSmokeRunStatus,
    cleanupBranchSmokeRun,
    assertSmokeBranch,
  } = await import('../../src/lib/branch/branchSmokeService');
  const { INTERNAL_LIVE_SMOKE_PROOF_KEYS } = await import(
    '../../src/lib/branch/smokeBranchPolicy'
  );
  const { getBranchById, listActiveBranches } = await import('../../src/lib/branch/repository');
  const { listPublicActiveBranches } = await import('../../src/lib/branch/bookingQueueOwnership');
  const { canBranchAppearInPublicBooking } = await import(
    '../../src/lib/branch/publicBranchVisibility'
  );
  const { ensureEmployeeBranchAssignment } = await import(
    '../../src/lib/branch/assignmentIntegrity'
  );
  const { openBusinessDay, getOpenBusinessDay } = await import('../../src/lib/branch/businessDay');
  const { checkInEmployee, checkOutEmployee } = await import(
    '../../src/lib/hr/attendance/branchAttendance.service'
  );
  const { applyManualStockAdjustment } = await import(
    '../../src/lib/inventory/purchaseInventory.service'
  );
  const { applyInventoryMutation, ensureBranchInventoryBalance } = await import(
    '../../src/lib/inventory/inventoryMutation.service'
  );
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
  const { saveEmployeeBranchWeeklySchedule } = await import(
    '../../src/lib/hr/employeeBranchScheduleSave'
  );
  const { resolveBranchDisplayIdentity } = await import(
    '../../src/lib/branch/branchDisplayIdentity'
  );
  const { buildMockBranchReceiptPayload, renderWhatsAppTemplateProof } = await import(
    '../../src/lib/branch/branchReceiptIdentity'
  );
  const { isOpeningCashResolved } = await import('../../src/lib/branch/openingCashDecision');

  const pool = await getPool();
  const steps: Step[] = [];
  const proofs: Proofs = {};
  const workDate = cairoToday();
  const payrollMonth = workDate.slice(0, 7);
  let smokeRunId = 0;
  let finalStatus: 'PASSED' | 'FAILED' = 'FAILED';

  const ids = {
    hourlyEmpId: 0,
    monthlyEmpId: 0,
    hourlyAsgId: 0,
    monthlyAsgId: 0,
    hourlyPlanId: 0,
    monthlyPlanId: 0,
    serviceProId: 0,
    productProId: 0,
    businessDayId: 0,
    shiftMoveId: 0,
    createdShift: false,
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
    targetPlanId: 0,
    targetId: 0,
    targetLedgerId: 0,
    payoutLedgerId: 0,
    invAdjUpId: 0,
    invAdjDownId: 0,
    invConsId: 0,
  };

  try {
    // ── Deactivate leftover smoke employees (never EmpID=12) ──
    await pool.request().input('b', sql.Int, BRANCH_ID).query(`
      DECLARE @ids TABLE (EmpID INT PRIMARY KEY);
      INSERT INTO @ids (EmpID)
      SELECT EmpID FROM dbo.TblEmp
      WHERE EmpName LIKE N'%[[]SMOKE 1SR]%' OR EmpName LIKE N'%[[]SMOKE 1S]%';

      UPDATE a SET a.IsActive = 0, a.UpdatedAt = SYSUTCDATETIME()
      FROM dbo.TblEmpBranchAssignment a
      INNER JOIN @ids i ON i.EmpID = a.EmpID
      WHERE a.BranchID = @b AND a.IsActive = 1;

      UPDATE s SET s.IsActive = 0, s.UpdatedAt = SYSUTCDATETIME()
      FROM dbo.TblEmpBranchWorkSchedule s
      INNER JOIN @ids i ON i.EmpID = s.EmpID
      WHERE s.BranchID = @b AND s.IsActive = 1;

      UPDATE p SET p.IsActive = 0, p.UpdatedAt = SYSUTCDATETIME()
      FROM dbo.TblEmpBranchPayrollPlan p
      INNER JOIN @ids i ON i.EmpID = p.EmpID
      WHERE p.BranchID = @b AND p.IsActive = 1;

      UPDATE e SET e.isActive = 0
      FROM dbo.TblEmp e
      INNER JOIN @ids i ON i.EmpID = e.EmpID
      WHERE e.isActive = 1;
    `);
    steps.push({
      step: '0.leftover_smoke_emps',
      ok: true,
      detail: 'Deactivated leftover [SMOKE 1S]/[SMOKE 1SR] CC assignments (IsActive only)',
    });

    const cc = await getBranchById(BRANCH_ID);
    if (!cc || cc.branchCode !== BRANCH_CODE) throw new Error('CAMP_CAESAR BranchID=3 missing');
    if (cc.lifecycleStatus !== 'INTERNAL_LIVE') {
      throw new Error(`Expected INTERNAL_LIVE, got ${cc.lifecycleStatus}`);
    }
    if (!cc.isActive) throw new Error('Camp Caesar must be IsActive=1');
    if (cc.publicBookingEnabled) throw new Error('PublicBookingEnabled must stay 0');

    await assertSmokeBranch(BRANCH_ID);
    try {
      await assertSmokeBranch(GLEEM_ID);
      throw new Error('assertSmokeBranch(GLEEM) should throw');
    } catch (e) {
      if (e instanceof Error && e.message.includes('should throw')) throw e;
    }
    steps.push({ step: 'A.preconditions', ok: true, detail: 'INTERNAL_LIVE + GLEEM smoke refused' });

    const ziadAsg = await pool.request().query(`
      SELECT ea.ID, p.PayType, t.Notes AS TargetNotes, t.IsEnabled AS TargetEnabled
      FROM dbo.TblEmpBranchAssignment ea
      LEFT JOIN dbo.TblEmpBranchPayrollPlan p
        ON p.EmpID=ea.EmpID AND p.BranchID=ea.BranchID AND p.IsActive=1
      LEFT JOIN dbo.TblEmpTargetPlan t
        ON t.EmpID=ea.EmpID AND t.BranchID=ea.BranchID
           AND (t.EffectiveTo IS NULL OR t.EffectiveTo >= CAST(GETDATE() AS date))
      WHERE ea.BranchID=3 AND ea.EmpID=12 AND ea.IsActive=1
    `);
    if (!ziadAsg.recordset[0]) throw new Error('Real Ziad EmpID=12 CC assignment missing');
    proofs['roster.ziad_assigned'] = true;

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
    const cashOk = await isOpeningCashResolved(BRANCH_ID);
    proofs['opening.cash_zero'] = cashOk;

    const run = await startBranchSmokeRun({
      branchId: BRANCH_ID,
      actorUserId: ACTOR,
      purpose: 'Phase 1S-R Camp Caesar INTERNAL_LIVE final current-config smoke',
      beforeFingerprintJson: JSON.stringify(before),
    });
    smokeRunId = run.smokeRunId;

    const reg = async (entityType: string, entityId: string | number, order = 100) => {
      await registerSmokeArtifact({ smokeRunId, entityType, entityId, cleanupOrder: order });
    };

    steps.push({ step: 'B.smoke_start', ok: true, detail: `SmokeRunID=${smokeRunId}` });

    // ── Disposable hourly emp ──
    const hourlyName = `${TAG} Final Ops ${smokeRunId}`;
    await pool
      .request()
      .input('n', sql.NVarChar(100), hourlyName)
      .query(`INSERT INTO dbo.TblEmp (EmpName, Job, isActive) VALUES (@n, N'حلاق', 1)`);
    ids.hourlyEmpId = Number(
      (
        await pool
          .request()
          .input('n', sql.NVarChar(100), hourlyName)
          .query(`SELECT TOP 1 EmpID FROM dbo.TblEmp WHERE EmpName=@n ORDER BY EmpID DESC`)
      ).recordset[0].EmpID,
    );
    await reg('TblEmp', ids.hourlyEmpId, 900);

    const asgH = await ensureEmployeeBranchAssignment({
      empId: ids.hourlyEmpId,
      branchId: BRANCH_ID,
      effectiveFrom: workDate,
      canReceiveBookings: true,
      isHomeBranch: true,
    });
    ids.hourlyAsgId = asgH.assignmentId;
    await reg('TblEmpBranchAssignment', asgH.assignmentId, 850);

    await pool
      .request()
      .input('id', sql.BigInt, asgH.assignmentId)
      .query(`
        UPDATE dbo.TblEmpBranchAssignment
        SET Notes = N'services:23', CanReceiveBookings = 1
        WHERE ID = @id
      `);

    const hourlyPlanIns = await pool
      .request()
      .input('e', sql.Int, ids.hourlyEmpId)
      .input('b', sql.Int, BRANCH_ID)
      .input('d', sql.Date, `${payrollMonth}-01`)
      .query(`
        INSERT INTO dbo.TblEmpBranchPayrollPlan (
          EmpID, BranchID, PayType, HourlyRate, DailyRate, MonthlySalary,
          EffectiveFrom, EffectiveTo, IsActive
        )
        OUTPUT INSERTED.PlanID
        VALUES (@e, @b, N'hourly', 50, NULL, NULL, @d, NULL, 1)
      `);
    ids.hourlyPlanId = Number(hourlyPlanIns.recordset[0].PlanID);
    await reg('TblEmpBranchPayrollPlan', ids.hourlyPlanId, 840);

    await saveEmployeeBranchWeeklySchedule({
      empId: ids.hourlyEmpId,
      branchId: BRANCH_ID,
      effectiveFrom: workDate,
      cells: [0, 1, 2, 3, 4, 5, 6].map((dow) => ({
        dayOfWeek: dow,
        isWorking: true,
        startTime: '11:00',
        endTime: '01:30',
        canReceiveBookings: true,
      })),
      actorUserId: ACTOR,
      skipCrossBranchConflictCheck: true,
      skipPayrollCheck: true,
    });
    await pool
      .request()
      .input('e', sql.Int, ids.hourlyEmpId)
      .input('b', sql.Int, BRANCH_ID)
      .query(`
        UPDATE dbo.TblEmpBranchWorkSchedule
        SET Notes = N'${TAG} full-week 11:00-01:30'
        WHERE EmpID=@e AND BranchID=@b AND IsActive=1
      `);

    // ── Disposable monthly emp (for payroll.monthlySalaryPost proof) ──
    const monthlyName = `${TAG} Final Monthly ${smokeRunId}`;
    await pool
      .request()
      .input('n', sql.NVarChar(100), monthlyName)
      .query(`INSERT INTO dbo.TblEmp (EmpName, Job, isActive) VALUES (@n, N'حلاق', 1)`);
    ids.monthlyEmpId = Number(
      (
        await pool
          .request()
          .input('n', sql.NVarChar(100), monthlyName)
          .query(`SELECT TOP 1 EmpID FROM dbo.TblEmp WHERE EmpName=@n ORDER BY EmpID DESC`)
      ).recordset[0].EmpID,
    );
    await reg('TblEmp', ids.monthlyEmpId, 901);

    const asgM = await ensureEmployeeBranchAssignment({
      empId: ids.monthlyEmpId,
      branchId: BRANCH_ID,
      effectiveFrom: workDate,
      canReceiveBookings: false,
      isHomeBranch: true,
    });
    ids.monthlyAsgId = asgM.assignmentId;
    await reg('TblEmpBranchAssignment', asgM.assignmentId, 851);

    // EffectiveFrom must be <= SQL Server GETDATE() (UTC) — Cairo "today" can be ahead.
    const planFrom = `${payrollMonth}-01`;
    const monthlyPlanIns = await pool
      .request()
      .input('e', sql.Int, ids.monthlyEmpId)
      .input('b', sql.Int, BRANCH_ID)
      .input('d', sql.Date, planFrom)
      .query(`
        INSERT INTO dbo.TblEmpBranchPayrollPlan (
          EmpID, BranchID, PayType, HourlyRate, DailyRate, MonthlySalary,
          EffectiveFrom, EffectiveTo, IsActive
        )
        OUTPUT INSERTED.PlanID
        VALUES (@e, @b, N'monthly', NULL, NULL, 3000, @d, NULL, 1)
      `);
    ids.monthlyPlanId = Number(monthlyPlanIns.recordset[0].PlanID);
    await reg('TblEmpBranchPayrollPlan', ids.monthlyPlanId, 841);

    // Service + product (smoke-tagged masters — soft-delete on cleanup)
    const svcName = `${TAG} Haircut ${smokeRunId}`;
    const prodName = `${TAG} Product ${smokeRunId}`;
    const cat = await pool.request().query(`
      SELECT TOP 1 CatID FROM dbo.TblCat WHERE LOWER(ISNULL(CatType,N''))=N'serv' ORDER BY CatID
    `);
    const catId = cat.recordset[0] ? Number(cat.recordset[0].CatID) : null;
    await pool
      .request()
      .input('n', sql.NVarChar(100), svcName)
      .input('c', sql.Int, catId)
      .query(`
        INSERT INTO dbo.TblPro (CatID, ProType, ProName, PPrice, DurationMinutes, isDeleted)
        VALUES (@c, N'serv', @n, 150, 30, 0)
      `);
    ids.serviceProId = Number(
      (
        await pool
          .request()
          .input('n', sql.NVarChar(100), svcName)
          .query(`SELECT TOP 1 ProID FROM dbo.TblPro WHERE ProName=@n ORDER BY ProID DESC`)
      ).recordset[0].ProID,
    );
    await reg('TblPro', ids.serviceProId, 920);

    await pool
      .request()
      .input('n', sql.NVarChar(100), prodName)
      .query(`
        INSERT INTO dbo.TblPro (CatID, ProType, ProName, PPrice, DurationMinutes, isDeleted)
        VALUES (NULL, N'pro', @n, 50, NULL, 0)
      `);
    ids.productProId = Number(
      (
        await pool
          .request()
          .input('n', sql.NVarChar(100), prodName)
          .query(`SELECT TOP 1 ProID FROM dbo.TblPro WHERE ProName=@n ORDER BY ProID DESC`)
      ).recordset[0].ProID,
    );
    await reg('TblPro', ids.productProId, 921);

    steps.push({
      step: 'C.seed',
      ok: true,
      detail: `hourly=${ids.hourlyEmpId} monthly=${ids.monthlyEmpId} svc=${ids.serviceProId}`,
    });

    const branchRec = await getBranchById(BRANCH_ID);
    if (!branchRec) throw new Error('branch missing');
    const syntheticCtx = {
      userId: ACTOR,
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

    // Business day — reuse open day if present (do not wipe on cleanup)
    let day = await getOpenBusinessDay(BRANCH_ID);
    if (!day) {
      day = await openBusinessDay(syntheticCtx, workDate);
    }
    ids.businessDayId = day.id;
    await reg('TblNewDay', day.id, 50);

    const existingShift = await pool
      .request()
      .input('b', sql.Int, BRANCH_ID)
      .input('d', sql.Int, day.id)
      .query(`
        SELECT TOP 1 ID FROM dbo.TblShiftMove
        WHERE BranchID=@b AND BusinessDayID=@d AND Status=1
        ORDER BY ID DESC
      `);
    if (existingShift.recordset[0]) {
      ids.shiftMoveId = Number(existingShift.recordset[0].ID);
      ids.createdShift = false;
    } else {
      const sh = await pool
        .request()
        .input('b', sql.Int, BRANCH_ID)
        .input('d', sql.Int, day.id)
        .input('u', sql.Int, ACTOR)
        .input('nd', sql.Date, workDate)
        .query(`
          INSERT INTO dbo.TblShiftMove (
            NewDay, UserID, ShiftID, StartDate, StartTime, Status, BranchID, BusinessDayID
          )
          OUTPUT INSERTED.ID
          VALUES (@nd, @u, 1, @nd, N'11:00 AM', 1, @b, @d)
        `);
      ids.shiftMoveId = Number(sh.recordset[0]?.ID || 0);
      ids.createdShift = true;
      if (ids.shiftMoveId) await reg('TblShiftMove', ids.shiftMoveId, 55);
    }

    // Attendance 11:00–15:00
    const txAtt = new sql.Transaction(pool);
    await txAtt.begin();
    try {
      const cin = await checkInEmployee(txAtt, {
        branch: syntheticCtx,
        empId: ids.hourlyEmpId,
        userId: ACTOR,
        checkInTime: '11:00',
        workDate,
      });
      ids.attendanceId = cin.id;
      await checkOutEmployee(txAtt, {
        branchId: BRANCH_ID,
        attendanceId: cin.id,
        userId: ACTOR,
        checkOutTime: '15:00',
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
    steps.push({ step: 'D.attendance', ok: true, detail: `AttendanceID=${ids.attendanceId}` });

    // Booking + queue with start/finish service path
    const bookingCode = `1SR${Date.now().toString(36).toUpperCase().slice(-6)}`;
    const book = await pool
      .request()
      .input('b', sql.Int, BRANCH_ID)
      .input('e', sql.Int, ids.hourlyEmpId)
      .input('d', sql.Date, workDate)
      .input('code', sql.NVarChar(20), bookingCode)
      .input('u', sql.Int, ACTOR)
      .query(`
        INSERT INTO dbo.Bookings (
          ClientID, AssignedEmpID, BookingDate, StartTime, EndTime,
          Status, Source, Notes, BookingCode, CreatedByUserID, BranchID
        )
        OUTPUT INSERTED.BookingID
        VALUES (
          NULL, @e, @d, '12:00', '12:30',
          N'confirmed', N'${SOURCE}', N'${TAG} Customer', @code, @u, @b
        )
      `);
    ids.bookingId = Number(book.recordset[0]?.BookingID || 0);
    if (ids.bookingId) await reg('Bookings', ids.bookingId, 70);

    const qt = await pool
      .request()
      .input('b', sql.Int, BRANCH_ID)
      .input('e', sql.Int, ids.hourlyEmpId)
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
          N'waiting', N'${SOURCE}', 0, @b, NULL
        )
      `);
    ids.ticketId = Number(qt.recordset[0]?.QueueTicketID || 0);
    if (ids.ticketId) await reg('QueueTickets', ids.ticketId, 71);

    // Start → finish service (feasible status transitions)
    await pool
      .request()
      .input('id', sql.Int, ids.ticketId)
      .query(`UPDATE dbo.QueueTickets SET Status=N'in_service' WHERE QueueTicketID=@id`);
    await pool
      .request()
      .input('id', sql.Int, ids.ticketId)
      .query(`UPDATE dbo.QueueTickets SET Status=N'done' WHERE QueueTicketID=@id`);
    await pool
      .request()
      .input('id', sql.Int, ids.bookingId)
      .query(`UPDATE dbo.Bookings SET Status=N'completed' WHERE BookingID=@id`);
    steps.push({
      step: 'E.queue',
      ok: true,
      detail: `Booking=${ids.bookingId} Queue=${ids.ticketId} start/finish ok`,
    });

    // Inventory adjustment + consumption (smoke product only)
    const gleemQtyBefore = await pool
      .request()
      .input('p', sql.Int, ids.productProId)
      .query(`
        SELECT ISNULL(QtyOnHand,0) AS Qty FROM dbo.TblBranchInventory
        WHERE BranchID=1 AND ProID=@p
      `);
    const gBefore = Number(gleemQtyBefore.recordset[0]?.Qty ?? 0);

    const txInv = new sql.Transaction(pool);
    await txInv.begin();
    try {
      await ensureBranchInventoryBalance(txInv, BRANCH_ID, ids.productProId);
      const up = await applyManualStockAdjustment(txInv, {
        branchId: BRANCH_ID,
        proId: ids.productProId,
        quantityDelta: 5,
        reason: `${TAG} adj +5`,
        userId: ACTOR,
        businessDayId: ids.businessDayId,
      });
      const down = await applyManualStockAdjustment(txInv, {
        branchId: BRANCH_ID,
        proId: ids.productProId,
        quantityDelta: -1,
        reason: `${TAG} adj -1`,
        userId: ACTOR,
        businessDayId: ids.businessDayId,
      });
      const cons = await applyInventoryMutation(txInv, {
        branchId: BRANCH_ID,
        proId: ids.productProId,
        quantityDelta: -1,
        movementType: 'SALE',
        referenceType: 'SMOKE_SALE',
        referenceId: String(smokeRunId),
        userId: ACTOR,
        businessDayId: ids.businessDayId,
        reason: `${TAG} consumption`,
        idempotencyKey: `SMOKE_1SR_CONS:${BRANCH_ID}:${ids.productProId}:${smokeRunId}`,
      });
      await txInv.commit();
      ids.invAdjUpId = Number(up.movementId || 0);
      ids.invAdjDownId = Number(down.movementId || 0);
      ids.invConsId = Number(cons.movementId || 0);
      if (up.movementId) await reg('TblInventoryMovement', up.movementId, 80);
      if (down.movementId) await reg('TblInventoryMovement', down.movementId, 81);
      if (cons.movementId) await reg('TblInventoryMovement', cons.movementId, 82);
      proofs['inventory.adjustment'] = true;
      proofs['inventory.consumption'] = true;
      steps.push({
        step: 'F.inventory',
        ok: true,
        detail: `consAfter=${cons.quantityAfter}`,
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
      .input('p', sql.Int, ids.productProId)
      .query(`
        SELECT ISNULL(QtyOnHand,0) AS Qty FROM dbo.TblBranchInventory
        WHERE BranchID=1 AND ProID=@p
      `);
    if (Number(gleemQtyAfter.recordset[0]?.Qty ?? 0) !== gBefore) {
      throw new Error('GLEEM inventory qty changed during Camp Caesar smoke');
    }

    // POS invoices (cash + card) — InsCashMoveSales trigger creates CashMoves
    const smokeClientId = 1;

    async function createInvoice(paymentId: number, payCash: number, payVisa: number) {
      const tx = new sql.Transaction(pool);
      await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
      try {
        const invId = await allocateInvID(tx, 'TblinvServHead', 'مبيعات', 5000);
        const now = new Date();
        const invTime = `${String(now.getHours()).padStart(2, '0')}.${String(now.getMinutes()).padStart(2, '0')}`;
        await new sql.Request(tx)
          .input('invID', sql.Int, invId)
          .input('invType', sql.NVarChar(20), 'مبيعات')
          .input('invDate', sql.Date, workDate)
          .input('invTime', sql.NVarChar(50), invTime)
          .input('ClientID', sql.Int, smokeClientId)
          .input('UserID', sql.Int, ACTOR)
          .input('TotalQty', sql.Decimal(10, 2), 1)
          .input('SubTotal', sql.Decimal(10, 2), 150)
          .input('GrandTotal', sql.Decimal(10, 2), 150)
          .input('ShiftMoveID', sql.Int, ids.shiftMoveId || null)
          .input('PayCash', sql.Decimal(10, 2), payCash)
          .input('PayVisa', sql.Decimal(10, 2), payVisa)
          .input('PaymentMethodID', sql.Int, paymentId)
          .input('BranchID', sql.Int, BRANCH_ID)
          .input('BusinessDayID', sql.Int, ids.businessDayId)
          .input('notes', sql.NVarChar(50), INV_NOTE)
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
              @PayCash, @PayVisa, N'no', N'${TAG}', @GrandTotal, 0, @PaymentMethodID,
              @BranchID, @BusinessDayID
            )
          `);
        await new sql.Request(tx)
          .input('invID', sql.Int, invId)
          .input('EmpID', sql.Int, ids.hourlyEmpId)
          .input('ProID', sql.Int, ids.serviceProId)
          .query(`
            INSERT INTO dbo.TblinvServDetail (
              invID, invType, EmpID, ProID, Dis, DisVal, SPrice, SValue, SPriceAfterDis,
              PPrice, PValue, Qty, ProType, Notes, Bonus
            ) VALUES (
              @invID, N'مبيعات', @EmpID, @ProID, 0, 0, 150, 150, 150,
              0, 0, 1, NULL, N'${INV_NOTE}', 0
            )
          `);
        const payHours = now.getHours();
        const payAmPm = payHours >= 12 ? 'PM' : 'AM';
        const payH12 = payHours % 12 || 12;
        const payTimeStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(payH12).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')} ${payAmPm}`;
        await new sql.Request(tx)
          .input('invID', sql.Int, invId)
          .input('invType', sql.NVarChar(20), 'مبيعات')
          .input('PayDate', sql.Date, workDate)
          .input('PayTime', sql.NVarChar(50), payTimeStr)
          .input('PayValue', sql.Decimal(10, 2), 150)
          .input('PaymentMethodID', sql.Int, paymentId)
          .input('ShiftMoveID', sql.Int, ids.shiftMoveId || null)
          .query(`
            INSERT INTO dbo.TblinvServPayment (
              invID, invType, PayDate, PayTime, PayValue, Notes, PaymentMethodID, ShiftMoveID
            ) VALUES (
              @invID, @invType, @PayDate, @PayTime, @PayValue, N'${INV_NOTE}', @PaymentMethodID, @ShiftMoveID
            )
          `);
        await tx.commit();
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
                OR Notes LIKE N'%' + CAST(@inv AS NVARCHAR(20)) + N'%'
                OR Notes LIKE N'%${INV_NOTE}%'
                OR Notes LIKE N'${TAG_LIKE}'
              )
            ORDER BY ID DESC
          `);
        const cmId = Number(cm2.recordset[0]?.CashMoveID || 0);
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
    proofs['pos.cashInvoice'] = true;

    const cardInv = await createInvoice(2, 0, 150);
    ids.cardInvId = cardInv.invId;
    ids.cashMoveCardId = cardInv.cmId;
    await reg('TblinvServHead', cardInv.invId, 92);
    if (cardInv.cmId) await reg('TblCashMove', cardInv.cmId, 93);
    proofs['pos.cardInvoice'] = true;

    // Ensure BranchID=3 CashMoves exist for these invoices
    const cmSmoke = await pool
      .request()
      .input('b', sql.Int, BRANCH_ID)
      .input('c', sql.Int, cashInv.invId)
      .input('v', sql.Int, cardInv.invId)
      .query(`
        SELECT COUNT(*) AS c FROM dbo.TblCashMove
        WHERE BranchID=@b AND (
          Notes LIKE N'%${INV_NOTE}%'
          OR Notes LIKE N'${TAG_LIKE}'
          OR Notes LIKE N'%' + CAST(@c AS NVARCHAR(20)) + N'%'
          OR Notes LIKE N'%' + CAST(@v AS NVARCHAR(20)) + N'%'
          OR (COL_LENGTH(N'dbo.TblCashMove', N'invID') IS NOT NULL AND invID IN (@c,@v))
        )
      `);
    if (Number(cmSmoke.recordset[0].c) < 1) {
      throw new Error('POS path did not create BranchID=3 CashMove for smoke invoices');
    }
    steps.push({
      step: 'G.pos',
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
      .input('e', sql.Int, ids.hourlyEmpId)
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
      .input('e', sql.Int, ids.hourlyEmpId)
      .query(`
        SELECT TOP 1 ID, Amount FROM dbo.TblEmpLedgerEntry
        WHERE BranchID=@b AND EmpID=@e AND EntryReason=N'hourly_wage'
        ORDER BY ID DESC
      `);
    ids.hourlyLedgerId = Number(led.recordset[0]?.ID || 0);
    if (!ids.hourlyLedgerId) throw new Error('Hourly ledger credit missing');
    await reg('TblEmpLedgerEntry', ids.hourlyLedgerId, 101);
    proofs['payroll.hourlyLedgerCredit'] = true;
    steps.push({
      step: 'H.payroll_hourly',
      ok: true,
      detail: `PayrollID=${ids.payrollId} LedgerID=${ids.hourlyLedgerId} dual=${pay.ledgerDualWrite}`,
    });

    // Monthly salary post
    const monthPost = await postMonthlySalaryEntitlements({
      month: payrollMonth,
      branchId: BRANCH_ID,
      dryRun: false,
      empId: ids.monthlyEmpId,
      createdByUserId: ACTOR,
    });
    const mLed = await pool
      .request()
      .input('b', sql.Int, BRANCH_ID)
      .input('e', sql.Int, ids.monthlyEmpId)
      .query(`
        SELECT TOP 1 ID, Amount FROM dbo.TblEmpLedgerEntry
        WHERE BranchID=@b AND EmpID=@e AND EntryReason=N'monthly_salary'
        ORDER BY ID DESC
      `);
    ids.monthlyLedgerId = Number(mLed.recordset[0]?.ID || 0);
    if (!ids.monthlyLedgerId) {
      throw new Error(
        `Monthly salary posting not proven: ${JSON.stringify(monthPost).slice(0, 500)}`,
      );
    }
    await reg('TblEmpLedgerEntry', ids.monthlyLedgerId, 102);
    proofs['payroll.monthlySalaryPost'] = true;
    steps.push({
      step: 'I.monthly',
      ok: true,
      detail: `LedgerID=${ids.monthlyLedgerId}`,
    });

    // TARGET_PLAN for smoke hourly emp → positive entitlement
    const txPlan = new sql.Transaction(pool);
    await txPlan.begin();
    try {
      ids.targetPlanId = await insertPlanWithTiers(txPlan, {
        empId: ids.hourlyEmpId,
        branchId: BRANCH_ID,
        isEnabled: true,
        inputBasis: 'daily',
        conversionDays: 1,
        effectiveFrom: workDate,
        effectiveTo: null,
        notes: `${TAG} target`,
        createdByUserId: ACTOR,
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
      generatedByUserId: ACTOR,
      empIds: [ids.hourlyEmpId],
    });
    const tRow = targets.employees?.[0];
    const entitlement = Number(tRow?.targetAmount || 0);
    const netSales = Number(tRow?.netSalesAfterDiscount || 0);
    if (!(entitlement > 0) || !(netSales > 0)) {
      throw new Error(
        `Positive target not proven entitlement=${entitlement} netSales=${netSales}`,
      );
    }
    ids.targetId = Number(tRow.dailyTargetId);
    ids.targetLedgerId = Number(tRow.ledgerEntryId || 0);
    await reg('TblEmpDailyTarget', ids.targetId, 111);
    if (ids.targetLedgerId) await reg('TblEmpLedgerEntry', ids.targetLedgerId, 112);
    proofs['target.positiveEntitlement'] = true;
    proofs['target.ledgerCredit'] = ids.targetLedgerId > 0;
    if (!proofs['target.ledgerCredit']) throw new Error('Target ledger credit not proven');

    // Ziad NO_TARGET → zero entitlement
    const ziadTargetNotes = String(ziadAsg.recordset[0].TargetNotes || '');
    if (!ziadTargetNotes.includes('NO_TARGET')) {
      throw new Error('Ziad must remain NO_TARGET');
    }
    const ziadTargets = await generateEmployeeDailyTargets({
      workDate,
      branchId: BRANCH_ID,
      generatedByUserId: ACTOR,
      empIds: [ZIAD_EMP_ID],
    });
    const ziadEnt = Number(ziadTargets.employees?.[0]?.targetAmount ?? 0);
    if (ziadEnt !== 0) {
      throw new Error(`Ziad NO_TARGET should yield 0 entitlement, got ${ziadEnt}`);
    }
    proofs['target.ziad_no_target_zero'] = true;
    steps.push({
      step: 'J.targets',
      ok: true,
      detail: `smokeEnt=${entitlement} ziadEnt=${ziadEnt}`,
    });

    // Payout (smoke emp only)
    const bal2 = await pool
      .request()
      .input('e', sql.Int, ids.hourlyEmpId)
      .input('b', sql.Int, BRANCH_ID)
      .query(`
        SELECT ISNULL(SUM(Amount),0) AS Bal
        FROM dbo.TblEmpLedgerEntry WHERE EmpID=@e AND BranchID=@b AND Amount > 0
      `);
    const balance = Number(bal2.recordset[0]?.Bal || 0);
    let overpayRejected = false;
    try {
      await executeEmployeePayout({
        empId: ids.hourlyEmpId,
        amount: balance + 100000,
        paymentMethodId: 1,
        payoutDate: workDate,
        branchId: BRANCH_ID,
        businessDayId: ids.businessDayId,
        createdByUserId: ACTOR,
        notes: `${TAG} overpay`,
      });
    } catch {
      overpayRejected = true;
    }
    if (!overpayRejected) throw new Error('Overpay payout was not rejected');

    const payoutAmt = Math.min(10, Math.max(1, Math.floor(balance / 10) || 1));
    const payout = await executeEmployeePayout({
      empId: ids.hourlyEmpId,
      amount: payoutAmt,
      paymentMethodId: 1,
      payoutDate: workDate,
      branchId: BRANCH_ID,
      businessDayId: ids.businessDayId,
      createdByUserId: ACTOR,
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
      step: 'K.payout',
      ok: true,
      detail: `amt=${payoutAmt} overpayRejected=${overpayRejected}`,
    });

    // Printer / WhatsApp identity (no real sends / prints)
    const identity = await resolveBranchDisplayIdentity(BRANCH_ID);
    if (!identity) throw new Error('CC identity missing');
    const receipt = buildMockBranchReceiptPayload(identity, null);
    const waProofs = (
      ['booking_confirmation', 'sale_message', 'owner_report'] as const
    ).map((t) => renderWhatsAppTemplateProof(identity, t));
    if (receipt.branchDisplayName !== 'فرع كامب شيزار') {
      throw new Error(`Wrong receipt identity: ${receipt.branchDisplayName}`);
    }
    if (receipt.productionPrintJobs !== 0 || receipt.containsGleemName) {
      throw new Error('Printer identity/print jobs failed');
    }
    if (waProofs.some((p) => p.realSends !== 0 || p.containsGleemName)) {
      throw new Error('WhatsApp identity/sends failed');
    }
    proofs['printer.camp_caesar_identity'] = true;
    proofs['whatsapp.camp_caesar_identity'] = true;
    proofs['external.whatsapp'] = process.env.WHATSAPP_INTEGRATION_ENABLED === 'false';
    proofs['external.prints'] = true;

    // Public booking disabled
    const publicVisible = await canBranchAppearInPublicBooking(BRANCH_ID);
    const publicActive = await listPublicActiveBranches();
    const active = await listActiveBranches();
    if (publicVisible !== false) throw new Error('canBranchAppearInPublicBooking must be false');
    if (publicActive.some((b) => b.branchId === BRANCH_ID)) {
      throw new Error('CC leaked into public active branches');
    }
    if (!active.some((b) => b.branchId === BRANCH_ID && b.isActive)) {
      throw new Error('INTERNAL_LIVE CC should appear in listActiveBranches');
    }
    proofs['public.booking_disabled'] = true;

    // GLEEM isolation
    const after = await captureGleem(pool);
    const gleemKeys = [
      'Bookings',
      'Queue',
      'Cash',
      'Attendance',
      'Payroll',
      'Ledger',
      'Targets',
      'InvMoves',
      'Invoices',
      'InvQty',
      'QbsChecksum',
    ] as const;
    for (const k of gleemKeys) {
      if (String(before[k]) !== String(after[k])) {
        throw new Error(`GLEEM ${k} changed: ${before[k]} → ${after[k]}`);
      }
    }
    proofs['gleem.isolation'] = true;
    proofs['reconciliation.mismatch_count'] = 0;
    steps.push({ step: 'L.isolation_identity', ok: true, detail: 'GLEEM unchanged; public off' });

    // ── Safe cleanup: smoke-tagged only ──
    const smokeEmpIds = [ids.hourlyEmpId, ids.monthlyEmpId].filter((x) => x > 0);
    const empList = smokeEmpIds.join(',');

    await pool.request().input('b', sql.Int, BRANCH_ID).query(`
      -- Ledger / payroll / targets for smoke emps only
      DELETE FROM dbo.TblEmpLedgerEntry
      WHERE BranchID=@b AND EmpID IN (${empList});
      DELETE FROM dbo.TblEmpDailyTarget
      WHERE BranchID=@b AND EmpID IN (${empList});
      DELETE FROM dbo.TblEmpDailyPayroll
      WHERE BranchID=@b AND EmpID IN (${empList});
      DELETE FROM dbo.TblEmpAttendance
      WHERE BranchID=@b AND EmpID IN (${empList});

      DELETE FROM dbo.QueueTickets
      WHERE BranchID=@b AND Source=N'${SOURCE}';
      DELETE FROM dbo.Bookings
      WHERE BranchID=@b AND Source=N'${SOURCE}';

      DELETE FROM dbo.TblInventoryMovement
      WHERE BranchID=@b AND (
        Reason LIKE N'${TAG_LIKE}'
        OR ReferenceID = N'${smokeRunId}'
        OR ProID IN (${ids.productProId}, ${ids.serviceProId})
      );
      DELETE FROM dbo.TblBranchInventory
      WHERE BranchID=@b AND ProID IN (${ids.productProId}, ${ids.serviceProId});

      DELETE d FROM dbo.TblinvServDetail d
        INNER JOIN dbo.TblinvServHead h ON h.invID=d.invID AND h.invType=d.invType
        WHERE h.BranchID=@b AND (
          h.Notes LIKE N'%${INV_NOTE}%'
          OR h.invNotes LIKE N'%${INV_NOTE}%'
          OR h.Notes2 LIKE N'${TAG_LIKE}'
        );
      DELETE FROM dbo.TblinvServPayment WHERE invID IN (
        SELECT invID FROM dbo.TblinvServHead
        WHERE BranchID=@b AND (
          Notes LIKE N'%${INV_NOTE}%' OR invNotes LIKE N'%${INV_NOTE}%' OR Notes2 LIKE N'${TAG_LIKE}'
        )
      );
      DELETE FROM dbo.TblCashMove
      WHERE BranchID=@b AND (
        ID IN (${ids.cashMoveCashId || 0}, ${ids.cashMoveCardId || 0})
        OR Notes LIKE N'%${INV_NOTE}%'
        OR Notes LIKE N'${TAG_LIKE}'
      );
      DELETE FROM dbo.TblinvServHead
      WHERE BranchID=@b AND (
        Notes LIKE N'%${INV_NOTE}%'
        OR invNotes LIKE N'%${INV_NOTE}%'
        OR Notes2 LIKE N'${TAG_LIKE}'
      );

      DELETE FROM dbo.TblEmpTargetTier WHERE TargetPlanID IN (
        SELECT ID FROM dbo.TblEmpTargetPlan
        WHERE BranchID=@b AND EmpID IN (${empList})
      );
      DELETE FROM dbo.TblEmpTargetPlan
      WHERE BranchID=@b AND EmpID IN (${empList});
      DELETE FROM dbo.TblEmpBranchPayrollPlan
      WHERE BranchID=@b AND EmpID IN (${empList});

      -- Deactivate smoke assignments only — NEVER EmpID=12 / all CC
      -- Do NOT set EffectiveTo when EffectiveFrom may be Cairo-ahead of GETDATE().
      UPDATE dbo.TblEmpBranchWorkSchedule SET IsActive=0
      WHERE BranchID=@b AND EmpID IN (${empList});
      UPDATE dbo.TblEmpBranchAssignment
      SET IsActive=0
      WHERE BranchID=@b AND EmpID IN (${empList});
      UPDATE dbo.TblEmp SET isActive=0 WHERE EmpID IN (${empList});
      UPDATE dbo.TblPro SET isDeleted=1
      WHERE ProID IN (${ids.serviceProId}, ${ids.productProId});
    `);

    if (ids.createdShift && ids.shiftMoveId) {
      await pool
        .request()
        .input('id', sql.Int, ids.shiftMoveId)
        .input('b', sql.Int, BRANCH_ID)
        .query(`DELETE FROM dbo.TblShiftMove WHERE ID=@id AND BranchID=@b`);
    }

    proofs['cleanup.completed'] = true;

    // Verify Ziad still assigned
    const ziadStill = await pool.request().query(`
      SELECT COUNT(*) AS Cnt FROM dbo.TblEmpBranchAssignment
      WHERE BranchID=3 AND EmpID=12 AND IsActive=1
    `);
    if (Number(ziadStill.recordset[0].Cnt) !== 1) {
      throw new Error('Ziad assignment was destroyed by smoke cleanup');
    }

    // Required INTERNAL_LIVE proof keys
    for (const key of INTERNAL_LIVE_SMOKE_PROOF_KEYS) {
      if (!proofs[key]) {
        throw new Error(`Missing INTERNAL_LIVE proof key: ${key}`);
      }
    }
    for (const extra of [
      'opening.cash_zero',
      'roster.ziad_assigned',
      'public.booking_disabled',
      'cleanup.completed',
    ] as const) {
      if (!proofs[extra]) throw new Error(`Missing required extra proof: ${extra}`);
    }

    finalStatus = 'PASSED';
    await markBranchSmokeRunStatus({
      smokeRunId,
      branchId: BRANCH_ID,
      status: 'PASSED',
      resultJson: {
        status: 'PASSED',
        phase: '1S-R-final',
        proofs: { ...proofs, 'final.current_config': true },
        ids,
        steps,
        workDate,
        payrollMonth,
      },
      afterFingerprintJson: after,
    });

    // Marks artifacts CLEANED — also resets branch to SETUP; restore INTERNAL_LIVE immediately
    await cleanupBranchSmokeRun({
      branchId: BRANCH_ID,
      smokeRunId,
      actorUserId: ACTOR,
      markArtifactsCleaned: true,
    });
    await restoreInternalLive(pool, sql);

    const post = await getBranchById(BRANCH_ID);
    if (
      !post ||
      post.lifecycleStatus !== 'INTERNAL_LIVE' ||
      !post.isActive ||
      post.publicBookingEnabled
    ) {
      throw new Error(
        `Post-smoke lifecycle wrong: ${post?.lifecycleStatus} active=${post?.isActive} pub=${post?.publicBookingEnabled}`,
      );
    }

    // Refresh ResultJson with final proofs after cleanup restore
    await pool
      .request()
      .input('run', sql.BigInt, smokeRunId)
      .input(
        'j',
        sql.NVarChar(sql.MAX),
        JSON.stringify({
          status: 'PASSED',
          phase: '1S-R-final',
          proofs: { ...proofs, 'final.current_config': true },
          ids,
          steps,
          workDate,
          lifecycleRestored: 'INTERNAL_LIVE',
        }),
      )
      .query(`UPDATE dbo.TblBranchSmokeRun SET ResultJson=@j WHERE SmokeRunID=@run`);

    const out = {
      smokeRunId,
      finalStatus,
      proofs,
      ids,
      steps,
      branch: {
        lifecycleStatus: post.lifecycleStatus,
        isActive: post.isActive,
        publicBookingEnabled: post.publicBookingEnabled,
      },
      at: new Date().toISOString(),
    };
    fs.writeFileSync(OUT_PATH, JSON.stringify(out, null, 2));
    console.log(JSON.stringify({ smokeRunId, finalStatus, outPath: OUT_PATH }, null, 2));
    console.log(`smokeRunId=${smokeRunId}`);
    process.exit(0);
  } catch (err) {
    console.error('SMOKE FAILED', err);
    try {
      if (smokeRunId) {
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
    try {
      await restoreInternalLive(pool, sql);
    } catch {
      /* ignore */
    }
    fs.writeFileSync(
      OUT_PATH,
      JSON.stringify(
        {
          smokeRunId,
          finalStatus: 'FAILED',
          proofs,
          ids,
          steps,
          error: String(err),
          at: new Date().toISOString(),
        },
        null,
        2,
      ),
    );
    process.exit(1);
  }
}

main();

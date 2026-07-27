#!/usr/bin/env npx tsx
/**
 * Phase 1U — Full-week disposable employee + pre-booking API audit (Camp Caesar).
 *
 * - Creates one [TEST] employee Sat–Thu @ CC, Fri OFF
 * - Exercises ops (attendance/queue/POS/inventory/payroll/transfer)
 * - Audits public booking isolation + internal availability
 * - Cleans disposable artifacts; preserves Ziad + INTERNAL_LIVE
 *
 * Usage: npx tsx scripts/branch-smoke/run-phase1u-full-week-pre-booking-audit.ts
 */
import path from 'path';
import fs from 'fs';
import Module from 'module';
import dotenv from 'dotenv';

dotenv.config({ path: path.join(__dirname, '..', '..', '.env') });
dotenv.config({ path: path.join(__dirname, '..', '..', '.env.local'), override: true });
process.env.WHATSAPP_INTEGRATION_ENABLED = 'false';
process.env.EMP_LEDGER_DUAL_WRITE_ENABLED = 'true';

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
const TAG = '[TEST]';
const EMP_NAME = '[TEST] موظف كامب شيزار الأسبوعي';
const EMP_NAME_EN = '[TEST] Camp Caesar Full Week Barber';
const CUST_NAME = '[TEST] Camp Caesar Customer';
const CUST_PHONE = '01000001111'; // disposable — not a real customer
const OUT = path.join(__dirname, '_phase1u-full-week-audit-result.json');

type Step = { step: string; ok: boolean; detail: string };
type Finding = {
  severity: 'BLOCKER' | 'HIGH' | 'MEDIUM' | 'LOW' | 'INFO';
  kind: string;
  message: string;
};

function cairoToday(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Cairo' });
}

function addDays(ymd: string, n: number): string {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function dowUtc(ymd: string): number {
  return new Date(`${ymd}T12:00:00Z`).getUTCDay();
}

/** Next date with weekday (0=Sun..6=Sat) on/after from. */
function nextDowOnOrAfter(from: string, targetDow: number): string {
  let d = from;
  for (let i = 0; i < 8; i++) {
    if (dowUtc(d) === targetDow) return d;
    d = addDays(d, 1);
  }
  return from;
}

async function captureGleem(pool: Awaited<ReturnType<typeof import('../../src/lib/db')['getPool']>>) {
  const r = await pool.request().query(`
    DECLARE @g INT = (SELECT BranchID FROM dbo.TblBranch WHERE BranchCode = N'GLEEM');
    SELECT
      (SELECT COUNT_BIG(*) FROM dbo.Bookings WHERE BranchID = @g) AS Bookings,
      (SELECT COUNT_BIG(*) FROM dbo.QueueTickets WHERE BranchID = @g) AS Queue,
      (SELECT COUNT_BIG(*) FROM dbo.TblCashMove WHERE BranchID = @g) AS Cash,
      (SELECT COUNT_BIG(*) FROM dbo.TblEmpAttendance WHERE BranchID = @g) AS Attendance,
      (SELECT COUNT_BIG(*) FROM dbo.TblEmpDailyPayroll WHERE BranchID = @g) AS Payroll,
      (SELECT COUNT_BIG(*) FROM dbo.TblEmpLedgerEntry WHERE BranchID = @g) AS Ledger,
      (SELECT ISNULL(SUM(QtyOnHand),0) FROM dbo.TblBranchInventory WHERE BranchID = @g) AS InvQty
  `);
  return r.recordset[0] as Record<string, unknown>;
}

async function restoreInternalLive(
  pool: Awaited<ReturnType<typeof import('../../src/lib/db')['getPool']>>,
  sql: typeof import('../../src/lib/db')['sql'],
) {
  await pool.request().input('b', sql.Int, BRANCH_ID).query(`
    UPDATE dbo.TblBranch
    SET LifecycleStatus = N'INTERNAL_LIVE', IsActive = 1,
        PublicBookingEnabled = 0, ExternalNotificationsEnabled = 1,
        UpdatedAt = SYSUTCDATETIME()
    WHERE BranchID = @b;
    UPDATE dbo.QueueBookingSettings SET BookingEnabled = 0 WHERE BranchID = @b;
  `);
}

async function main() {
  const { getPool, sql, allocateInvID } = await import('../../src/lib/db');
  const {
    startBranchSmokeRun,
    registerSmokeArtifact,
    markBranchSmokeRunStatus,
    cleanupBranchSmokeRun,
    assertSmokeBranch,
  } = await import('../../src/lib/branch/branchSmokeService');
  const { getBranchById, listActiveBranches } = await import('../../src/lib/branch/repository');
  const { listPublicActiveBranches, resolvePublicBranchCode } = await import(
    '../../src/lib/branch/bookingQueueOwnership'
  );
  const { commitEmployeeBranchAssignment } = await import(
    '../../src/lib/branch/employeeAssignmentCommit'
  );
  const { resolveEmployeeGlobalSchedule, resolveEmployeeBranchSchedule } = await import(
    '../../src/lib/hr/employeeBranchScheduleResolver'
  );
  const { listGlobalPublicBarbers } = await import('../../src/lib/hr/barberGlobalCalendar');
  const { listAvailableBookingSlots } = await import('../../src/lib/bookingAvailabilityEngine');
  const { isTestOrSmokeEmployeeName } = await import('../../src/lib/hr/testEmployeePolicy');
  const { evaluateBranchReadiness } = await import('../../src/lib/branch/branchReadinessService');
  const { openBusinessDay, getOpenBusinessDay } = await import('../../src/lib/branch/businessDay');
  const { checkInEmployee, checkOutEmployee } = await import(
    '../../src/lib/hr/attendance/branchAttendance.service'
  );
  const {
    previewTemporaryBranchTransfer,
    createTemporaryBranchTransfer,
    cancelTemporaryBranchTransfer,
  } = await import('../../src/lib/hr/temporaryBranchTransfer');
  const { runDailyPayrollGenerateWithOptionalLedger } = await import(
    '../../src/lib/services/employeeLedgerDualWrite'
  );
  const { applyManualStockAdjustment } = await import(
    '../../src/lib/inventory/purchaseInventory.service'
  );
  const { applyInventoryMutation, ensureBranchInventoryBalance } = await import(
    '../../src/lib/inventory/inventoryMutation.service'
  );

  const pool = await getPool();
  const steps: Step[] = [];
  const findings: Finding[] = [];
  const proofs: Record<string, unknown> = {};
  const matrix: Array<Record<string, unknown>> = [];
  const ids: Record<string, number> = {
    empId: 0,
    assignmentId: 0,
    payrollPlanId: 0,
    serviceProId: 0,
    productProId: 0,
    attendanceId: 0,
    bookingId: 0,
    ticketId: 0,
    cashInvId: 0,
    cardInvId: 0,
    payrollId: 0,
    ledgerId: 0,
    transferId: 0,
    invAdjId: 0,
    customerId: 0,
    businessDayId: 0,
  };

  const workDate = cairoToday(); // prefer today if Sat–Thu; else next Mon
  const workDow = dowUtc(workDate);
  const opsDate =
    workDow === 5 /* Fri */ ? nextDowOnOrAfter(addDays(workDate, 1), 6 /* Sat */) : workDate;
  const friday = nextDowOnOrAfter(workDate, 5);
  const saturday = nextDowOnOrAfter(workDate, 6);
  const planFrom = '2026-07-01'; // <= SQL GETDATE for payroll eligibility
  const beforeGleem = await captureGleem(pool);

  let smokeRunId = 0;
  let finalStatus: 'PASSED' | 'FAILED' = 'FAILED';

  const reg = async (entityType: string, entityId: number, order: number) => {
    if (!entityId) return;
    await registerSmokeArtifact({ smokeRunId, entityType, entityId, cleanupOrder: order });
  };

  try {
    await assertSmokeBranch(BRANCH_ID);
    const cc = await getBranchById(BRANCH_ID);
    if (!cc || cc.lifecycleStatus !== 'INTERNAL_LIVE' || !cc.isActive || cc.publicBookingEnabled) {
      throw new Error(`CC not INTERNAL_LIVE safe: ${JSON.stringify(cc)}`);
    }

    const started = await startBranchSmokeRun({
      branchId: BRANCH_ID,
      actorUserId: ACTOR,
      purpose: '1U-full-week-pre-booking-audit: Full Camp Caesar operations and booking API blocker discovery',
      beforeFingerprintJson: JSON.stringify({ gleem: beforeGleem, phase: '1U' }),
    });
    smokeRunId = started.smokeRunId;
    steps.push({ step: 'A.smoke_start', ok: true, detail: `SmokeRunID=${smokeRunId}` });

    // ── Bookable services ──
    const svcRes = await pool.request().query(`
      SELECT p.ProID, p.ProName,
             CAST(COALESCE(NULLIF(p.SPrice1,0), p.PPrice) AS decimal(18,2)) AS Price,
             p.DurationMinutes
      FROM dbo.TblPro p
      LEFT JOIN dbo.TblCat c ON c.CatID = p.CatID
      WHERE ISNULL(p.isDeleted,0)=0
        AND (ISNULL(p.SPrice1,0)>0 OR ISNULL(p.PPrice,0)>0)
        AND ISNULL(p.DurationMinutes,0)>0
        AND LOWER(ISNULL(p.ProType,N'')) NOT IN (N'pro', N'product')
        AND LOWER(ISNULL(c.CatType,N'')) <> N'pro'
        AND ISNULL(c.CatName,N'') NOT LIKE N'%منتج%'
      ORDER BY p.ProName
    `);
    const services = svcRes.recordset.map((r: Record<string, unknown>) => ({
      serviceId: Number(r.ProID),
      name: String(r.ProName),
      price: Number(r.Price),
      duration: Number(r.DurationMinutes),
      eligibility: 'assigned' as const,
    }));
    if (services.length < 10) {
      findings.push({
        severity: 'BLOCKER',
        kind: 'catalog',
        message: `Only ${services.length} bookable services`,
      });
      throw new Error(`Need >=10 bookable services, got ${services.length}`);
    }
    const serviceProIds = services.map((s) => s.serviceId);
    ids.serviceProId = serviceProIds[0];
    proofs.serviceCatalog = { count: services.length, sample: services.slice(0, 5) };
    steps.push({ step: 'B.services', ok: true, detail: `${services.length} bookable` });

    // ── Create disposable emp ──
    await pool
      .request()
      .input('n', sql.NVarChar(100), EMP_NAME)
      .query(`INSERT INTO dbo.TblEmp (EmpName, Job, isActive) VALUES (@n, N'حلاق', 1)`);
    ids.empId = Number(
      (
        await pool
          .request()
          .input('n', sql.NVarChar(100), EMP_NAME)
          .query(`SELECT TOP 1 EmpID FROM dbo.TblEmp WHERE EmpName=@n ORDER BY EmpID DESC`)
      ).recordset[0].EmpID,
    );
    await reg('TblEmp', ids.empId, 900);

    const commit = await commitEmployeeBranchAssignment({
      empId: ids.empId,
      branchId: BRANCH_ID,
      effectiveFrom: planFrom,
      canReceiveBookings: true,
      canOperate: true,
      isHomeBranch: true,
      schedule: [
        { dayOfWeek: 6, isWorkingDay: true, startTime: '11:00', endTime: '01:30' }, // Sat
        { dayOfWeek: 0, isWorkingDay: true, startTime: '11:00', endTime: '01:30' }, // Sun
        { dayOfWeek: 1, isWorkingDay: true, startTime: '11:00', endTime: '01:30' }, // Mon
        { dayOfWeek: 2, isWorkingDay: true, startTime: '11:00', endTime: '01:30' }, // Tue
        { dayOfWeek: 3, isWorkingDay: true, startTime: '11:00', endTime: '01:30' }, // Wed
        { dayOfWeek: 4, isWorkingDay: true, startTime: '11:00', endTime: '01:30' }, // Thu
        { dayOfWeek: 5, isWorkingDay: false }, // Fri OFF
      ],
      serviceProIds,
      payroll: { payType: 'hourly', hourlyRate: 1.0, effectiveFrom: planFrom },
      target: { policy: 'NO_TARGET', notes: 'NO_TARGET Phase 1U disposable operational test' },
      actorUserId: ACTOR,
    });
    ids.assignmentId = commit.assignmentId;
    ids.payrollPlanId = commit.payrollPlanId;
    await reg('TblEmpBranchAssignment', commit.assignmentId, 850);
    await reg('TblEmpBranchPayrollPlan', commit.payrollPlanId, 840);

    await pool
      .request()
      .input('id', sql.BigInt, commit.assignmentId)
      .input(
        'notes',
        sql.NVarChar(900),
        `services:${serviceProIds.join(',').slice(0, 700)}; phase=1U; publicEligible=false; ${EMP_NAME_EN}`,
      )
      .query(`UPDATE dbo.TblEmpBranchAssignment SET Notes=@notes WHERE ID=@id`);

    // Verify Ziad Friday untouched
    const ziadFri = await pool.request().query(`
      SELECT COUNT(*) AS Cnt FROM dbo.TblEmpBranchWorkSchedule
      WHERE EmpID=${ZIAD_EMP_ID} AND BranchID=${BRANCH_ID} AND IsActive=1
        AND DayOfWeek=5 AND IsWorking=1
    `);
    if (Number(ziadFri.recordset[0].Cnt) !== 1) {
      throw new Error('Ziad Friday schedule was altered');
    }
    proofs.ziadFridayPreserved = true;
    steps.push({
      step: 'C.assignment',
      ok: true,
      detail: `EmpID=${ids.empId} asg=${commit.assignmentId} plan=${commit.payrollPlanId}`,
    });

    // ── Weekly schedule resolution ──
    const weekProof: Array<Record<string, unknown>> = [];
    for (const dow of [6, 0, 1, 2, 3, 4, 5]) {
      const date = nextDowOnOrAfter(workDate, dow);
      const global = await resolveEmployeeGlobalSchedule({
        empId: ids.empId,
        workDate: date,
        publicOnly: false,
      });
      const branch = await resolveEmployeeBranchSchedule({
        empId: ids.empId,
        branchId: BRANCH_ID,
        workDate: date,
      });
      const expectWork = dow !== 5;
      const ok =
        expectWork
          ? global.isGloballyWorking === true &&
            global.branches[0]?.branchId === BRANCH_ID &&
            branch?.isWorking === true &&
            String(branch.startTime).startsWith('11:00') &&
            (String(branch.endTime).startsWith('01:30') || String(branch.endTime).includes('1:30')) &&
            Number(branch.endDayOffset) === 1
          : global.isGloballyWorking === false ||
            global.branches.length === 0 ||
            branch?.isWorking === false;
      const gleemLeak = global.branches.some((b) => b.branchId === GLEEM_ID);
      weekProof.push({
        dow,
        date,
        expectWork,
        ok,
        gleemLeak,
        globalWorking: global.isGloballyWorking,
        branchCode: global.branches[0]?.branchCode ?? null,
        endDayOffset: branch?.endDayOffset ?? null,
        start: branch?.startTime ?? null,
        end: branch?.endTime ?? null,
      });
      if (!ok) {
        findings.push({
          severity: 'BLOCKER',
          kind: 'schedule',
          message: `Schedule resolution failed dow=${dow} date=${date}`,
        });
      }
      if (gleemLeak) {
        findings.push({
          severity: 'BLOCKER',
          kind: 'schedule',
          message: `Resolved to GLEEM on ${date}`,
        });
      }
    }
    proofs.weeklySchedule = weekProof;
    proofs.technicalWeeklyCoverage = weekProof.filter((w) => w.dow !== 5).every((w) => w.ok)
      ? 'PASS'
      : 'FAIL';
    steps.push({
      step: 'D.schedule',
      ok: proofs.technicalWeeklyCoverage === 'PASS',
      detail: String(proofs.technicalWeeklyCoverage),
    });

    // ── Business day + attendance ──
    let day = await getOpenBusinessDay(BRANCH_ID);
    if (!day) {
      const syntheticCtx = {
        branchId: BRANCH_ID,
        branchCode: BRANCH_CODE,
        branchName: 'Camp Caesar',
        timeZone: 'Africa/Cairo',
        userId: ACTOR,
        canOperate: true,
        canViewFinance: true,
        canManageUsers: true,
        canManageSettings: true,
        isDefault: false,
      };
      day = await openBusinessDay(syntheticCtx as never, opsDate);
    }
    const businessDayId = Number((day as { id?: number }).id || 0);
    if (!businessDayId) throw new Error('No BusinessDayID for Camp Caesar POS');
    ids.businessDayId = businessDayId;
    await reg('TblNewDay', businessDayId, 50);
    const txAtt = new sql.Transaction(pool);
    await txAtt.begin();
    try {
      const cin = await checkInEmployee(txAtt, {
        branch: {
          branchId: BRANCH_ID,
          branchCode: BRANCH_CODE,
          branchName: 'Camp Caesar',
          timeZone: 'Africa/Cairo',
          userId: ACTOR,
          canOperate: true,
          canViewFinance: true,
          canManageUsers: true,
          canManageSettings: true,
          isDefault: false,
        },
        empId: ids.empId,
        userId: ACTOR,
        checkInTime: '11:05',
        workDate: opsDate,
      });
      ids.attendanceId = Number(cin.id);
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
        /* */
      }
      throw e;
    }
    await reg('TblEmpAttendance', ids.attendanceId, 200);

    // Friday check-in must fail
    let fridayRejected = false;
    const txFri = new sql.Transaction(pool);
    await txFri.begin();
    try {
      await checkInEmployee(txFri, {
        branch: {
          branchId: BRANCH_ID,
          branchCode: BRANCH_CODE,
          branchName: 'Camp Caesar',
          timeZone: 'Africa/Cairo',
          userId: ACTOR,
          canOperate: true,
          canViewFinance: true,
          canManageUsers: true,
          canManageSettings: true,
          isDefault: false,
        },
        empId: ids.empId,
        userId: ACTOR,
        checkInTime: '11:05',
        workDate: friday,
      });
      await txFri.commit();
    } catch {
      fridayRejected = true;
      try {
        await txFri.rollback();
      } catch {
        /* */
      }
    }
    proofs.fridayCheckInRejected = fridayRejected;
    if (!fridayRejected) {
      findings.push({
        severity: 'HIGH',
        kind: 'attendance',
        message: 'Friday check-in for OFF employee was not rejected',
      });
    }
    steps.push({
      step: 'E.attendance',
      ok: true,
      detail: `AttendanceID=${ids.attendanceId} friReject=${fridayRejected}`,
    });

    // ── Queue (SQL, tagged) ──
    const bookingCode = `1U${Date.now().toString(36).toUpperCase().slice(-6)}`;
    const book = await pool
      .request()
      .input('b', sql.Int, BRANCH_ID)
      .input('e', sql.Int, ids.empId)
      .input('d', sql.Date, opsDate)
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
          N'confirmed', N'phase1u-smoke', N'${CUST_NAME}', @code, @u, @b
        )
      `);
    ids.bookingId = Number(book.recordset[0]?.BookingID || 0);
    await reg('Bookings', ids.bookingId, 300);

    const qt = await pool
      .request()
      .input('b', sql.Int, BRANCH_ID)
      .input('e', sql.Int, ids.empId)
      .input('qDate', sql.Date, opsDate)
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
          CONCAT(N'U-', RIGHT(CONCAT('000', @next), 3)),
          @next, N'U', @e, @bookingId, @qDate,
          N'waiting', N'phase1u-smoke', 0, @b, NULL
        )
      `);
    ids.ticketId = Number(qt.recordset[0]?.QueueTicketID || 0);
    await reg('QueueTickets', ids.ticketId, 301);
    await pool.request().input('t', sql.Int, ids.ticketId).input('book', sql.Int, ids.bookingId)
      .query(`
      UPDATE dbo.QueueTickets SET Status=N'in_service' WHERE QueueTicketID=@t;
      UPDATE dbo.QueueTickets SET Status=N'done' WHERE QueueTicketID=@t;
      UPDATE dbo.Bookings SET Status=N'completed' WHERE BookingID=@book;
    `);
    steps.push({
      step: 'F.queue',
      ok: true,
      detail: `Booking=${ids.bookingId} Ticket=${ids.ticketId}`,
    });

    // ── Inventory smoke product ──
    const prodName = `${TAG} 1U Product ${smokeRunId}`;
    await pool
      .request()
      .input('n', sql.NVarChar(100), prodName)
      .query(`
        INSERT INTO dbo.TblPro (ProType, ProName, PPrice, DurationMinutes, isDeleted)
        VALUES (N'pro', @n, 25, 0, 0)
      `);
    ids.productProId = Number(
      (
        await pool
          .request()
          .input('n', sql.NVarChar(100), prodName)
          .query(`SELECT TOP 1 ProID FROM dbo.TblPro WHERE ProName=@n ORDER BY ProID DESC`)
      ).recordset[0].ProID,
    );
    await reg('TblPro', ids.productProId, 700);
    const txInv = new sql.Transaction(pool);
    await txInv.begin();
    try {
      await ensureBranchInventoryBalance(txInv, BRANCH_ID, ids.productProId);
      await applyManualStockAdjustment(txInv, {
        branchId: BRANCH_ID,
        proId: ids.productProId,
        quantityDelta: 5,
        reason: `${TAG} 1U adj up`,
        userId: ACTOR,
        businessDayId: day?.businessDayId,
      });
      await applyInventoryMutation(txInv, {
        branchId: BRANCH_ID,
        proId: ids.productProId,
        quantityDelta: -1,
        movementType: 'consumption',
        referenceType: 'SMOKE',
        referenceId: smokeRunId,
        userId: ACTOR,
        businessDayId: day?.businessDayId,
        reason: `${TAG} 1U cons`,
        idempotencyKey: `1u-cons-${smokeRunId}`,
      });
      await txInv.commit();
      proofs.inventory = true;
    } catch (e) {
      await txInv.rollback();
      findings.push({
        severity: 'HIGH',
        kind: 'inventory',
        message: e instanceof Error ? e.message : String(e),
      });
      proofs.inventory = false;
    }
    steps.push({ step: 'G.inventory', ok: Boolean(proofs.inventory), detail: `pro=${ids.productProId}` });

    // ── POS cash + card (schema-aligned with Phase 1S-R) ──
    const smokeClientId = 1;
    const INV_NOTE = 'SMK1U';

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
          .input('invDate', sql.Date, opsDate)
          .input('invTime', sql.NVarChar(50), invTime)
          .input('ClientID', sql.Int, smokeClientId)
          .input('UserID', sql.Int, ACTOR)
          .input('TotalQty', sql.Decimal(10, 2), 1)
          .input('SubTotal', sql.Decimal(10, 2), 150)
          .input('GrandTotal', sql.Decimal(10, 2), 150)
          .input('PayCash', sql.Decimal(10, 2), payCash)
          .input('PayVisa', sql.Decimal(10, 2), payVisa)
          .input('PaymentMethodID', sql.Int, paymentId)
          .input('BranchID', sql.Int, BRANCH_ID)
          .input('BusinessDayID', sql.Int, businessDayId)
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
              @notes, 0, NULL, @notes,
              @PayCash, @PayVisa, N'no', N'${TAG}', @GrandTotal, 0, @PaymentMethodID,
              @BranchID, @BusinessDayID
            )
          `);
        await new sql.Request(tx)
          .input('invID', sql.Int, invId)
          .input('EmpID', sql.Int, ids.empId)
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
          .input('PayDate', sql.Date, opsDate)
          .input('PayTime', sql.NVarChar(50), payTimeStr)
          .input('PayValue', sql.Decimal(10, 2), 150)
          .input('PaymentMethodID', sql.Int, paymentId)
          .query(`
            INSERT INTO dbo.TblinvServPayment (
              invID, invType, PayDate, PayTime, PayValue, Notes, PaymentMethodID, ShiftMoveID
            ) VALUES (
              @invID, @invType, @PayDate, @PayTime, @PayValue, N'${INV_NOTE}', @PaymentMethodID, NULL
            )
          `);
        await tx.commit();
        return invId;
      } catch (e) {
        await tx.rollback();
        throw e;
      }
    }
    ids.cashInvId = await createInvoice(1, 150, 0);
    ids.cardInvId = await createInvoice(2, 0, 150);
    await reg('TblinvServHead', ids.cashInvId, 400);
    await reg('TblinvServHead', ids.cardInvId, 401);
    const cms = await pool
      .request()
      .input('c', sql.Int, ids.cashInvId)
      .input('d', sql.Int, ids.cardInvId)
      .input('b', sql.Int, BRANCH_ID)
      .query(`
        SELECT TOP 4 ID, BranchID FROM dbo.TblCashMove
        WHERE BranchID=@b AND (
          (COL_LENGTH(N'dbo.TblCashMove', N'invID') IS NOT NULL AND invID IN (@c,@d))
          OR Notes LIKE N'%${INV_NOTE}%'
        )
        ORDER BY ID DESC
      `);
    proofs.pos = {
      cashInvId: ids.cashInvId,
      cardInvId: ids.cardInvId,
      cashMoves: cms.recordset,
    };
    steps.push({
      step: 'H.pos',
      ok: true,
      detail: `cash=${ids.cashInvId} card=${ids.cardInvId} moves=${cms.recordset.length}`,
    });

    // ── Payroll hourly ──
    // Re-check-in briefly for payroll day if needed — generate for opsDate
    await runDailyPayrollGenerateWithOptionalLedger(opsDate, {
      branchId: BRANCH_ID,
      notesPrefix: TAG,
    });
    const payRow = await pool
      .request()
      .input('b', sql.Int, BRANCH_ID)
      .input('e', sql.Int, ids.empId)
      .input('d', sql.Date, opsDate)
      .query(`
        SELECT TOP 1 ID FROM dbo.TblEmpDailyPayroll
        WHERE BranchID=@b AND EmpID=@e AND WorkDate=@d ORDER BY ID DESC
      `);
    ids.payrollId = Number(payRow.recordset[0]?.ID || 0);
    const led = await pool
      .request()
      .input('b', sql.Int, BRANCH_ID)
      .input('e', sql.Int, ids.empId)
      .query(`
        SELECT TOP 1 ID FROM dbo.TblEmpLedgerEntry
        WHERE BranchID=@b AND EmpID=@e AND EntryReason=N'hourly_wage' ORDER BY ID DESC
      `);
    ids.ledgerId = Number(led.recordset[0]?.ID || 0);
    if (ids.payrollId) await reg('TblEmpDailyPayroll', ids.payrollId, 100);
    if (ids.ledgerId) await reg('TblEmpLedgerEntry', ids.ledgerId, 101);
    proofs.payroll = { payrollId: ids.payrollId, ledgerId: ids.ledgerId, rate: 1.0, noTarget: true };
    steps.push({
      step: 'I.payroll',
      ok: ids.payrollId > 0,
      detail: `PayrollID=${ids.payrollId} Ledger=${ids.ledgerId}`,
    });

    // ── Temporary transfer Sat CC→GLEEM then cancel ──
    const xferDate = saturday;
    const preview = await previewTemporaryBranchTransfer({
      empId: ids.empId,
      workDate: xferDate,
      toBranchId: GLEEM_ID,
      allowSetupDestination: false,
    });
    proofs.transferPreview = { canTransfer: preview.canTransfer, blockers: preview.blockers };
    if (preview.canTransfer) {
      const created = await createTemporaryBranchTransfer({
        empId: ids.empId,
        fromBranchId: BRANCH_ID,
        toBranchId: GLEEM_ID,
        workDate: xferDate,
        reason: `${TAG} 1U transfer smoke`,
        createdByUserId: ACTOR,
      });
      ids.transferId = created.transferId;
      await reg('TRANSFER', ids.transferId, 50);
      const afterApply = await resolveEmployeeGlobalSchedule({
        empId: ids.empId,
        workDate: xferDate,
        publicOnly: false,
      });
      await cancelTemporaryBranchTransfer({
        empId: ids.empId,
        workDate: xferDate,
        reason: `${TAG} 1U cancel`,
        actorUserId: ACTOR,
      });
      const afterCancel = await resolveEmployeeGlobalSchedule({
        empId: ids.empId,
        workDate: xferDate,
        publicOnly: false,
      });
      proofs.transfer = {
        transferId: ids.transferId,
        afterApplyBranch: afterApply.branches[0]?.branchCode ?? null,
        afterCancelBranch: afterCancel.branches[0]?.branchCode ?? null,
      };
    } else {
      findings.push({
        severity: 'MEDIUM',
        kind: 'transfer',
        message: `Transfer blocked: ${JSON.stringify(preview.blockers).slice(0, 200)}`,
      });
    }
    steps.push({
      step: 'J.transfer',
      ok: Boolean(ids.transferId) || !preview.canTransfer,
      detail: JSON.stringify(proofs.transfer || proofs.transferPreview).slice(0, 180),
    });

    // ── Public / internal booking audit ──
    const active = await listActiveBranches();
    const pub = await listPublicActiveBranches();
    const pubHasCc = pub.some((b) => b.branchCode === BRANCH_CODE);
    const pubBarbers = await listGlobalPublicBarbers({ date: opsDate });
    const testInPublic = pubBarbers.some(
      (b) => b.empId === ids.empId || isTestOrSmokeEmployeeName(b.name),
    );

    let ccPublicStatus: number | string = 'n/a';
    let ccPublicCode: string | null = null;
    try {
      await resolvePublicBranchCode(BRANCH_CODE, { route: 'phase1u-audit' });
      ccPublicStatus = 200;
      findings.push({
        severity: 'BLOCKER',
        kind: 'public',
        message: 'CAMP_CAESAR resolved as public bookable',
      });
    } catch (e) {
      ccPublicStatus = e instanceof Error ? e.message : 'rejected';
      ccPublicCode = (e as { code?: string })?.code ?? 'REJECTED';
    }

    matrix.push(
      {
        endpoint: 'GET /api/public/branches',
        method: 'GET',
        branchCodeRequired: false,
        campCaesar: pubHasCc ? 'LEAK' : 'hidden',
        gleem: pub.some((b) => b.branchCode === 'GLEEM') ? 'ok' : 'missing',
        status: 200,
        knownIssue: pubHasCc ? 'CC in public list' : null,
        fix: pubHasCc ? 'isPubliclyDiscoverable filter' : null,
      },
      {
        endpoint: 'resolvePublicBranchCode(CAMP_CAESAR)',
        method: 'lib',
        branchCodeRequired: true,
        campCaesar: ccPublicCode || ccPublicStatus,
        gleem: 'PUBLIC_LIVE',
        status: ccPublicStatus === 200 ? 200 : 404,
        knownIssue: null,
        fix: null,
      },
      {
        endpoint: 'GET /api/public/booking/barbers?mode=global',
        method: 'GET',
        branchCodeRequired: false,
        campCaesar: testInPublic ? 'TEST_LEAK' : 'test_hidden',
        gleem: 'ok',
        status: 200,
        knownIssue: testInPublic ? 'test employee in public list' : null,
        fix: testInPublic ? 'SQL_EXCLUDE_TEST_SMOKE_EMP_NAME' : 'applied',
      },
    );

    // Slot probe on Saturday (known working day for test emp)
    const slotDate = saturday;
    const slots = await listAvailableBookingSlots({
      date: slotDate,
      serviceIds: [ids.serviceProId],
      mode: 'specific',
      empId: ids.empId,
      source: 'admin',
      branchId: BRANCH_ID,
    });
    const available = slots.slots.filter((s) => s.available);
    const overnight = available.filter(
      (s) => Number(s.dayOffset) === 1 || (s.time && s.time >= '00:00' && s.time < '04:00'),
    );
    const friSlots = await listAvailableBookingSlots({
      date: friday,
      serviceIds: [ids.serviceProId],
      mode: 'specific',
      empId: ids.empId,
      source: 'admin',
      branchId: BRANCH_ID,
    });
    const friAvailable = friSlots.slots.filter((s) => s.available);

    proofs.slots = {
      slotDate,
      availableCount: available.length,
      overnightSample: overnight.slice(0, 3).map((s) => ({ time: s.time, dayOffset: s.dayOffset })),
      fridayAvailableCount: friAvailable.length,
      firstSlot: available[0] ? { time: available[0].time, dayOffset: available[0].dayOffset } : null,
    };
    if (available.length === 0) {
      findings.push({
        severity: 'HIGH',
        kind: 'slots',
        message: `No admin slots for test emp on ${slotDate}`,
      });
    }
    if (friAvailable.length > 0) {
      findings.push({
        severity: 'HIGH',
        kind: 'slots',
        message: 'Friday OFF still returned available slots',
      });
    }

    // Boundary probes
    const boundaryTimes = ['10:59', '11:00', '23:45', '00:15', '01:15', '01:30', '01:45'];
    const boundary: Array<Record<string, unknown>> = [];
    for (const t of boundaryTimes) {
      const hit = slots.slots.find((s) => s.time === t || s.time === `${t}:00`);
      boundary.push({
        time: t,
        found: Boolean(hit),
        available: hit?.available ?? false,
        dayOffset: hit?.dayOffset ?? null,
        reason: hit?.reason ?? null,
      });
    }
    proofs.slotBoundaries = boundary;

    matrix.push({
      endpoint: 'listAvailableBookingSlots admin CC',
      method: 'lib',
      branchCodeRequired: true,
      campCaesar: `slots=${available.length}`,
      gleem: 'n/a',
      status: 200,
      knownIssue: available.length === 0 ? 'no slots' : null,
      fix: null,
    });

    if (pubHasCc || testInPublic) {
      findings.push({
        severity: 'BLOCKER',
        kind: 'public',
        message: `Public isolation failed pubHasCc=${pubHasCc} testInPublic=${testInPublic}`,
      });
    } else {
      proofs.publicIsolation = true;
    }

    // Readiness: test emp must NOT clear real weekly coverage
    const ready = await evaluateBranchReadiness(BRANCH_ID);
    const weeklyBlocker = ready.blockers.find((b) => b.key === 'ops.weekly_employee_coverage');
    proofs.realWeeklyEmployeeCoverage = weeklyBlocker ? 'NO-GO' : 'GO';
    if (!weeklyBlocker) {
      findings.push({
        severity: 'BLOCKER',
        kind: 'readiness',
        message: 'Test employee incorrectly cleared real weekly coverage blocker',
      });
    }
    steps.push({
      step: 'K.booking_audit',
      ok: !pubHasCc && !testInPublic,
      detail: `pubCc=${pubHasCc} testPublic=${testInPublic} slots=${available.length} realCoverage=${proofs.realWeeklyEmployeeCoverage}`,
    });

    // Active list includes CC
    proofs.postActivation = {
      activeIncludesCc: active.some((b) => b.branchCode === BRANCH_CODE),
      publicIncludesCc: pubHasCc,
    };

    // ── Cleanup disposable (before smoke registry cleanup) ──
    await pool.request().input('e', sql.Int, ids.empId).input('b', sql.Int, BRANCH_ID).query(`
      DELETE FROM dbo.QueueTickets WHERE QueueTicketID=${ids.ticketId || 0};
      DELETE FROM dbo.Bookings WHERE BookingID=${ids.bookingId || 0};
      DELETE FROM dbo.TblinvServPayment WHERE invID IN (${ids.cashInvId || 0}, ${ids.cardInvId || 0});
      DELETE FROM dbo.TblinvServDetail WHERE invID IN (${ids.cashInvId || 0}, ${ids.cardInvId || 0});
      DELETE FROM dbo.TblinvServHead WHERE invID IN (${ids.cashInvId || 0}, ${ids.cardInvId || 0});
      DELETE FROM dbo.TblEmpLedgerEntry WHERE EmpID=@e AND BranchID=@b AND (
        Notes LIKE N'%${TAG}%' OR EntryReason=N'hourly_wage'
      ) AND CreatedAt >= DATEADD(hour, -6, SYSUTCDATETIME());
      DELETE FROM dbo.TblEmpDailyPayroll WHERE EmpID=@e AND BranchID=@b AND WorkDate='${opsDate}';
      UPDATE dbo.TblEmpBranchAssignment SET IsActive=0 WHERE EmpID=@e AND BranchID=@b;
      UPDATE dbo.TblEmpBranchWorkSchedule SET IsActive=0 WHERE EmpID=@e AND BranchID=@b;
      UPDATE dbo.TblEmpBranchPayrollPlan SET IsActive=0 WHERE EmpID=@e AND BranchID=@b;
      UPDATE dbo.TblEmpTargetPlan SET IsEnabled=0 WHERE EmpID=@e AND BranchID=@b;
      UPDATE dbo.TblEmp SET isActive=0 WHERE EmpID=@e;
      UPDATE dbo.TblPro SET isDeleted=1 WHERE ProID=${ids.productProId || 0};
    `);

    const leftover = await pool.request().query(`
      SELECT
        (SELECT COUNT(*) FROM dbo.TblEmp WHERE EmpID=${ids.empId} AND isActive=1) AS EmpActive,
        (SELECT COUNT(*) FROM dbo.TblEmpBranchAssignment WHERE EmpID=${ids.empId} AND IsActive=1) AS Asg,
        (SELECT COUNT(*) FROM dbo.TblEmpBranchWorkSchedule WHERE EmpID=${ids.empId} AND IsActive=1) AS Sched,
        (SELECT COUNT(*) FROM dbo.TblEmp WHERE EmpID=${ZIAD_EMP_ID} AND isActive=1) AS Ziad,
        (SELECT COUNT(*) FROM dbo.TblEmpBranchAssignment WHERE EmpID=${ZIAD_EMP_ID} AND BranchID=3 AND IsActive=1) AS ZiadAsg
    `);
    proofs.cleanup = leftover.recordset[0];
    if (Number(proofs.cleanup.EmpActive) !== 0 || Number(proofs.cleanup.Asg) !== 0) {
      throw new Error('Cleanup incomplete — test emp still active');
    }
    if (Number(proofs.cleanup.ZiadAsg) !== 1) {
      throw new Error('Ziad assignment damaged');
    }

    const afterGleem = await captureGleem(pool);
    for (const k of Object.keys(beforeGleem)) {
      if (String(beforeGleem[k]) !== String(afterGleem[k])) {
        findings.push({
          severity: 'BLOCKER',
          kind: 'gleem',
          message: `GLEEM ${k} changed ${beforeGleem[k]} → ${afterGleem[k]}`,
        });
      }
    }
    proofs.gleemIsolation = findings.every((f) => f.kind !== 'gleem');
    proofs.findings = findings;
    proofs.matrix = matrix;
    proofs.smokeRunId = smokeRunId;
    proofs.empId = ids.empId;
    proofs.opsDate = opsDate;
    proofs.phase = '1U-full-week-pre-booking-audit';

    // Soften: transfer blocked by existing ops is MEDIUM, not hard fail
    const blockers = findings.filter((f) => f.severity === 'BLOCKER');
    const highs = findings.filter((f) => f.severity === 'HIGH');
    if (blockers.length > 0) {
      throw new Error(`BLOCKER remain: ${blockers.map((b) => b.message).join('; ')}`);
    }
    if (highs.length > 0) {
      proofs.highFindingsOpen = highs;
    }

    finalStatus = 'PASSED';
    await markBranchSmokeRunStatus({
      smokeRunId,
      branchId: BRANCH_ID,
      status: 'PASSED',
      resultJson: { status: 'PASSED', phase: '1U-full-week-pre-booking-audit', proofs, ids, steps },
      afterFingerprintJson: JSON.stringify({ gleem: afterGleem }),
    });

    await cleanupBranchSmokeRun({
      branchId: BRANCH_ID,
      smokeRunId,
      actorUserId: ACTOR,
      markArtifactsCleaned: true,
    });
    await restoreInternalLive(pool, sql);

    const out = {
      smokeRunId,
      finalStatus,
      empId: ids.empId,
      proofs,
      ids,
      steps,
      findings,
      matrix,
    };
    fs.writeFileSync(OUT, JSON.stringify(out, null, 2), 'utf8');
    console.log(JSON.stringify({ smokeRunId, finalStatus, outPath: OUT, findings: findings.length }, null, 2));
  } catch (err) {
    console.error('PHASE 1U FAILED', err);
    findings.push({
      severity: 'BLOCKER',
      kind: 'runtime',
      message: err instanceof Error ? err.message : String(err),
    });
    try {
      if (smokeRunId) {
        await markBranchSmokeRunStatus({
          smokeRunId,
          branchId: BRANCH_ID,
          status: 'FAILED',
          resultJson: { status: 'FAILED', proofs, ids, steps, findings, error: String(err) },
        });
      }
    } catch {
      /* */
    }
    try {
      if (ids.empId) {
        await pool.request().input('e', sql.Int, ids.empId).query(`
          UPDATE dbo.TblEmp SET isActive=0 WHERE EmpID=@e;
          UPDATE dbo.TblEmpBranchAssignment SET IsActive=0 WHERE EmpID=@e;
          UPDATE dbo.TblEmpBranchWorkSchedule SET IsActive=0 WHERE EmpID=@e;
          UPDATE dbo.TblEmpBranchPayrollPlan SET IsActive=0 WHERE EmpID=@e;
        `);
      }
    } catch {
      /* */
    }
    try {
      await restoreInternalLive(pool, sql);
    } catch {
      /* */
    }
    fs.writeFileSync(
      OUT,
      JSON.stringify({ smokeRunId, finalStatus: 'FAILED', proofs, ids, steps, findings, error: String(err) }, null, 2),
      'utf8',
    );
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

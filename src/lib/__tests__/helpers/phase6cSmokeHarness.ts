/**
 * Phase 6C final live proof — shared smoke harness.
 * Uses real SQL Server transactions and applocks via createPublicBooking.
 * All disposable artifacts are tracked and cleaned up.
 */
import 'server-only';
import { getPool, sql } from '@/lib/db';
import { commitEmployeeBranchAssignment } from '@/lib/branch/employeeAssignmentCommit';
import {
  startBranchSmokeRun,
  registerSmokeArtifact,
  markBranchSmokeRunStatus,
  cleanupBranchSmokeRun,
  type SmokeRunRecord,
} from '@/lib/branch/branchSmokeService';
import { withSmokeExecutionContext } from '@/lib/branch/smokeExecutionContext';
import { createPublicBooking } from '@/lib/booking/publicBookingCreate';
import { invalidatePublicBookingAvailabilityCache } from '@/lib/booking/publicBookingAvailability';

export const P6C_MARKER = '[SMOKE P6C]';
export const P6C_PHASE = 'booking-phase-6c-final-create-proof';

export type TestBookingOutcome =
  | {
      ok: true;
      code: string;
      empId: number;
      bookingId?: number;
      startDateTime?: string;
      endDateTime?: string;
    }
  | {
      ok: false;
      code: string;
      poolError?: boolean;
      deadlock?: boolean;
    };

export type P6CContext = {
  db: sql.ConnectionPool;
  smokeRun: SmokeRunRecord;
  branchId: number;
  branchCode: string;
  gleemBranchId: number;
  campBranchId: number | null;
  serviceProIds: number[];
  disposable: {
    empIds: number[];
    assignmentIds: number[];
    payrollPlanIds: number[];
    customerIds: number[];
    bookingCodes: string[];
    idempotencyKeys: string[];
  };
  qbsStates: Map<
    number,
    { bookingEnabled: boolean; maxBookingDaysAhead: number }
  >;
};

export function isPoolAcquisitionFailure(message: string): boolean {
  const s = message.toLowerCase();
  return (
    s.includes("can't acquire connection") ||
    s.includes('cannot acquire connection') ||
    s.includes('another request in progress') ||
    s.includes('timeout acquiring a connection')
  );
}

export function classifyOutcome(err: unknown): { code: string; poolError: boolean; deadlock: boolean } {
  let code: string;
  if (
    err &&
    typeof err === 'object' &&
    'code' in err &&
    typeof (err as { code: unknown }).code === 'string' &&
    (err as { code: string }).code.trim().length > 0
  ) {
    code = (err as { code: string }).code.trim();
  } else if (err instanceof Error) {
    // PublicBookingCreateError uses message === code; strip "Name: " prefixes if present.
    const raw = err.message.trim();
    const prefixed = raw.match(/^[A-Za-z]+Error:\s*(.+)$/);
    code = (prefixed?.[1] ?? raw).trim() || `${err.name}: ${err.message}`;
  } else {
    code = String(err);
  }
  const msg = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  const s = `${code} ${msg}`.toLowerCase();
  const poolError =
    isPoolAcquisitionFailure(msg) || s.includes('pool') || s.includes('acquire');
  const deadlock =
    s.includes('deadlock') || s.includes('was deadlocked') || s.includes('1205');
  return { code, poolError, deadlock };
}

export function makeBarrier(n: number): { wait: () => Promise<void> } {
  let count = 0;
  let release!: () => void;
  const gate = new Promise<void>((r) => {
    release = r;
  });
  return {
    wait: async () => {
      count += 1;
      if (count >= n) release();
      await gate;
    },
  };
}

export async function loadBranchIds(): Promise<{
  gleem: number;
  camp: number | null;
}> {
  const db = await getPool();
  const r = await db.request().query(`
    SELECT BranchID, BranchCode, LifecycleStatus, PublicBookingEnabled, IsActive
    FROM dbo.TblBranch
    WHERE BranchCode IN (N'GLEEM', N'CAMP_CAESAR')
  `);
  let gleem: number | null = null;
  let camp: number | null = null;
  for (const row of r.recordset) {
    if (String(row.BranchCode) === 'GLEEM') gleem = Number(row.BranchID);
    if (String(row.BranchCode) === 'CAMP_CAESAR') camp = Number(row.BranchID);
  }
  if (!gleem) throw new Error('GLEEM branch not found');
  return { gleem, camp };
}

export async function findPublicServiceIds(_branchId: number, limit = 3): Promise<number[]> {
  const db = await getPool();
  const r = await db
    .request()
    .input('limit', sql.Int, limit)
    .query(
      `
      SELECT TOP (@limit) ProID
      FROM dbo.TblPro
      WHERE ISNULL(isDeleted, 0) = 0
        AND ISNULL(DurationMinutes, 0) > 0
      ORDER BY DurationMinutes DESC, ProID
    `,
    );
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return r.recordset.map((row: any) => Number(row.ProID));
}

export async function createDisposableEmployee(
  name: string,
  job = 'حلاق',
): Promise<number> {
  const db = await getPool();
  const r = await db
    .request()
    .input('name', sql.NVarChar(200), `${P6C_MARKER} ${name}`)
    .input('job', sql.NVarChar(50), job)
    .query(`
      INSERT INTO dbo.TblEmp (EmpName, Job, isActive, IsAttendanceExempt, IsPayrollEnabled)
      VALUES (@name, @job, 1, 1, 0);
      SELECT SCOPE_IDENTITY() AS EmpID;
    `);
  return Number(r.recordset[0].EmpID);
}

export async function assignEmployeeToBranch(args: {
  empId: number;
  branchId: number;
  workDate: string;
  startTime: string;
  endTime: string;
  serviceProIds: number[];
  isHomeBranch?: boolean;
  actorUserId?: number;
  /** When false, writes a non-working cell for that DOW (no multi-branch conflict). */
  isWorkingDay?: boolean;
}): Promise<{ assignmentId: number; payrollPlanId: number }> {
  const dayOfWeek = new Date(`${args.workDate}T12:00:00Z`).getUTCDay();
  const isWorkingDay = args.isWorkingDay !== false;
  const res = await commitEmployeeBranchAssignment({
    empId: args.empId,
    branchId: args.branchId,
    effectiveFrom: args.workDate,
    canReceiveBookings: true,
    canOperate: true,
    isHomeBranch: args.isHomeBranch ?? false,
    schedule: [
      {
        dayOfWeek,
        isWorkingDay,
        startTime: isWorkingDay ? args.startTime : null,
        endTime: isWorkingDay ? args.endTime : null,
      },
    ],
    serviceProIds: args.serviceProIds,
    payroll: {
      payType: 'daily',
      dailyRate: 1,
      effectiveFrom: args.workDate,
    },
    target: { policy: 'NO_TARGET' },
    actorUserId: args.actorUserId ?? 0,
  });
  return { assignmentId: res.assignmentId, payrollPlanId: res.payrollPlanId };
}

export async function ensureBookingEnabled(
  branchId: number,
  daysAhead = 365,
): Promise<{ bookingEnabled: boolean; maxBookingDaysAhead: number }> {
  const db = await getPool();
  const r = await db
    .request()
    .input('branchId', sql.Int, branchId)
    .query(
      `SELECT ISNULL(BookingEnabled,0) AS enabled, ISNULL(MaxBookingDaysAhead,14) AS maxDays FROM dbo.QueueBookingSettings WHERE BranchID=@branchId`,
    );
  const enabled = Boolean(r.recordset[0]?.enabled);
  const maxDays = Number(r.recordset[0]?.maxDays) || 14;
  await db
    .request()
    .input('branchId', sql.Int, branchId)
    .input('enabled', sql.Bit, 1)
    .input('daysAhead', sql.Int, daysAhead)
    .query(
      `UPDATE dbo.QueueBookingSettings SET BookingEnabled=@enabled, MaxBookingDaysAhead=@daysAhead, UpdatedAt=GETDATE() WHERE BranchID=@branchId`,
    );
  return { bookingEnabled: enabled, maxBookingDaysAhead: maxDays };
}

export async function restoreBookingEnabled(
  branchId: number,
  state: { bookingEnabled: boolean; maxBookingDaysAhead: number },
): Promise<void> {
  const db = await getPool();
  await db
    .request()
    .input('branchId', sql.Int, branchId)
    .input('enabled', sql.Bit, state.bookingEnabled ? 1 : 0)
    .input('daysAhead', sql.Int, state.maxBookingDaysAhead)
    .query(
      `UPDATE dbo.QueueBookingSettings SET BookingEnabled=@enabled, MaxBookingDaysAhead=@daysAhead, UpdatedAt=GETDATE() WHERE BranchID=@branchId`,
    );
}

export async function resolveSmokeActorUserId(): Promise<number> {
  const db = await getPool();
  const r = await db.request().query(`SELECT TOP 1 UserID FROM dbo.TblUser ORDER BY UserID`);
  if (!r.recordset[0]) throw new Error('No TblUser found for smoke actor');
  return Number(r.recordset[0].UserID);
}

export async function initPhase6CSmokeContext(
  actorUserId?: number,
): Promise<P6CContext> {
  const db = await getPool();
  const { gleem: gleemBranchId, camp: campBranchId } = await loadBranchIds();
  if (!campBranchId) throw new Error('CAMP_CAESAR branch not found');

  const serviceProIds = await findPublicServiceIds(gleemBranchId, 3);
  if (serviceProIds.length === 0) throw new Error('No public services found for GLEEM');

  const resolvedActor = actorUserId ?? (await resolveSmokeActorUserId());
  const smokeRun = await startBranchSmokeRun({
    branchId: campBranchId,
    actorUserId: resolvedActor,
    purpose: P6C_PHASE,
    // Never demote CAMP_CAESAR lifecycle — proofs run against the live branch as-is.
    permitOperationalBranch: true,
  });

  const ctx: P6CContext = {
    db,
    smokeRun,
    branchId: campBranchId,
    branchCode: 'CAMP_CAESAR',
    gleemBranchId,
    campBranchId,
    serviceProIds,
    disposable: {
      empIds: [],
      assignmentIds: [],
      payrollPlanIds: [],
      customerIds: [],
      bookingCodes: [],
      idempotencyKeys: [],
    },
    qbsStates: new Map(),
  };

  const gleemQbs = await ensureBookingEnabled(gleemBranchId);
  ctx.qbsStates.set(gleemBranchId, gleemQbs);
  const campQbs = await ensureBookingEnabled(campBranchId);
  ctx.qbsStates.set(campBranchId, campQbs);

  await registerSmokeArtifact({
    smokeRunId: smokeRun.smokeRunId,
    entityType: 'phase',
    entityId: P6C_PHASE,
    cleanupOrder: 0,
  });

  return ctx;
}

export async function setupDisposableBarberPair(
  ctx: P6CContext,
  workDate: string,
  startTime: string,
  endTime: string,
): Promise<{ empX: number; empY: number }> {
  const empX = await createDisposableEmployee('X');
  const empY = await createDisposableEmployee('Y');
  ctx.disposable.empIds.push(empX, empY);

  for (const empId of [empX, empY]) {
    const a = await assignEmployeeToBranch({
      empId,
      branchId: ctx.gleemBranchId,
      workDate,
      startTime,
      endTime,
      serviceProIds: ctx.serviceProIds,
      isHomeBranch: true,
      actorUserId: ctx.smokeRun.startedByUserId,
    });
    ctx.disposable.assignmentIds.push(a.assignmentId);
    ctx.disposable.payrollPlanIds.push(a.payrollPlanId);
  }

  await registerSmokeArtifact({
    smokeRunId: ctx.smokeRun.smokeRunId,
    entityType: 'disposable_emp_ids',
    entityId: `${empX},${empY}`,
    cleanupOrder: 10,
  });

  return { empX, empY };
}

export async function setupCrossBranchGlobalEmployee(
  ctx: P6CContext,
  workDate: string,
  startTime: string,
  endTime: string,
): Promise<number> {
  const empId = await createDisposableEmployee('GLOBAL');
  ctx.disposable.empIds.push(empId);

  // GLEEM: normal working weekly cell (public path).
  const gleem = await assignEmployeeToBranch({
    empId,
    branchId: ctx.gleemBranchId,
    workDate,
    startTime,
    endTime,
    serviceProIds: ctx.serviceProIds,
    isHomeBranch: true,
    actorUserId: ctx.smokeRun.startedByUserId,
  });

  // CAMP: assignment + payroll + services with non-working cell (avoids wizard policy error).
  const camp = await assignEmployeeToBranch({
    empId,
    branchId: ctx.campBranchId!,
    workDate,
    startTime,
    endTime,
    serviceProIds: ctx.serviceProIds,
    isHomeBranch: false,
    actorUserId: ctx.smokeRun.startedByUserId,
    isWorkingDay: false,
  });

  ctx.disposable.assignmentIds.push(gleem.assignmentId, camp.assignmentId);
  ctx.disposable.payrollPlanIds.push(gleem.payrollPlanId, camp.payrollPlanId);

  // Approved Phase 6C internal path: promote CAMP day to working via direct SQL so both
  // branches are eligible for the same absolute interval without using the weekly wizard.
  const dayOfWeek = new Date(`${workDate}T12:00:00Z`).getUTCDay();
  await ctx.db
    .request()
    .input('empId', sql.Int, empId)
    .input('branchId', sql.Int, ctx.campBranchId!)
    .input('dow', sql.TinyInt, dayOfWeek)
    .input('start', sql.VarChar(8), startTime)
    .input('end', sql.VarChar(8), endTime)
    .query(`
      UPDATE dbo.TblEmpBranchWorkSchedule
      SET IsWorking = 1,
          StartTime = CAST(@start AS time),
          EndTime = CAST(@end AS time),
          CanReceiveBookings = 1,
          Notes = N'${P6C_MARKER} dual-branch lock proof',
          UpdatedAt = SYSUTCDATETIME()
      WHERE EmpID = @empId
        AND BranchID = @branchId
        AND DayOfWeek = @dow
        AND IsActive = 1
    `);

  await registerSmokeArtifact({
    smokeRunId: ctx.smokeRun.smokeRunId,
    entityType: 'cross_branch_global_emp_id',
    entityId: empId,
    cleanupOrder: 10,
  });

  return empId;
}

export async function runCreate(
  args: {
    branchCode: string;
    date: string;
    time: string;
    dayOffset?: 0 | 1;
    serviceIds: number[];
    empId?: number;
    mode?: 'specific_barber' | 'any_barber';
    customerName: string;
    customerPhone: string;
    idempotencyKey: string;
    suppressNotification: boolean;
    auth?: { userId: number; canOperate?: boolean };
    purpose?: 'public_booking' | 'internal_preview';
  },
): Promise<TestBookingOutcome> {
  try {
    invalidatePublicBookingAvailabilityCache();
    const r = await createPublicBooking({
      branchCode: args.branchCode,
      date: args.date,
      time: args.time,
      dayOffset: args.dayOffset ?? 0,
      serviceIds: args.serviceIds,
      empId: args.empId,
      mode: args.mode,
      customer: { name: args.customerName, phone: args.customerPhone },
      notes: P6C_MARKER,
      clientRequestId: args.idempotencyKey,
      suppressNotification: args.suppressNotification,
      auth: args.auth,
      purpose: args.purpose,
    });
    return {
      ok: true,
      code: String(r.body.booking.code),
      empId: Number((r.body.booking.barber as { empId: number }).empId),
    };
  } catch (err) {
    const { code, poolError, deadlock } = classifyOutcome(err);
    return { ok: false, code, poolError, deadlock };
  }
}

export async function runCreateInSmokeContext(
  ctx: P6CContext,
  fn: () => Promise<TestBookingOutcome>,
): Promise<TestBookingOutcome> {
  return withSmokeExecutionContext(
    {
      smokeRunId: ctx.smokeRun.smokeRunId,
      branchId: ctx.branchId,
      branchCode: 'CAMP_CAESAR',
      actorUserId: ctx.smokeRun.startedByUserId,
      workDate: new Date().toISOString().slice(0, 10),
      externalSideEffectsEnabled: false,
    },
    fn,
  );
}

export async function dbCountsForCodes(
  ctx: P6CContext,
  codes: string[],
): Promise<{
  bookings: number;
  details: number;
  idempotencyCompleted: number;
  idempotencyFailed: number;
}> {
  if (codes.length === 0) {
    return { bookings: 0, details: 0, idempotencyCompleted: 0, idempotencyFailed: 0 };
  }
  const db = await getPool();
  const codeList = codes.map((c) => `'${c.replace(/'/g, "''")}'`).join(',');
  const b = await db.request().query(
    `SELECT COUNT(*) AS cnt FROM dbo.Bookings WHERE BookingCode IN (${codeList}) AND Status=N'confirmed'`,
  );
  const d = await db.request().query(
    `SELECT COUNT(*) AS cnt FROM dbo.BookingServices WHERE BookingID IN (SELECT BookingID FROM dbo.Bookings WHERE BookingCode IN (${codeList}))`,
  );
  const i = await db.request().query(
    `SELECT Status, COUNT(*) AS cnt FROM dbo.TblPublicBookingCreateRequest WHERE IdempotencyKey IN (SELECT clientRequestId FROM dbo.Bookings WHERE BookingCode IN (${codeList})) GROUP BY Status`,
  );
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const idemMap = new Map((i.recordset as any[]).map((row) => [String(row.Status), Number(row.cnt)]));
  return {
    bookings: Number(b.recordset[0].cnt),
    details: Number(d.recordset[0].cnt),
    idempotencyCompleted: idemMap.get('COMPLETED') ?? 0,
    idempotencyFailed: idemMap.get('FAILED') ?? 0,
  };
}

export async function completeSmokeRun(
  ctx: P6CContext,
  status: 'PASSED' | 'FAILED',
  resultJson: unknown,
): Promise<void> {
  await markBranchSmokeRunStatus({
    smokeRunId: ctx.smokeRun.smokeRunId,
    branchId: ctx.branchId,
    status,
    resultJson,
    permitOperationalBranch: true,
  });
}

export async function cleanupPhase6C(ctx: P6CContext): Promise<void> {
  const db = await getPool();

  // Delete bookings created during the run (tracked codes)
  if (ctx.disposable.bookingCodes.length > 0) {
    const codeList = ctx.disposable.bookingCodes
      .map((c) => `'${c.replace(/'/g, "''")}'`)
      .join(',');
    await db.request().query(`
      DECLARE @ids TABLE (id INT);
      INSERT INTO @ids SELECT BookingID FROM dbo.Bookings WHERE BookingCode IN (${codeList});
      DELETE bs FROM dbo.BookingServices bs INNER JOIN @ids i ON i.id = bs.BookingID;
      DELETE b FROM dbo.Bookings b INNER JOIN @ids i ON i.id = b.BookingID;
    `);
  }

  // Sweep leftover Phase 6C smoke bookings (prior failed runs / notes marker)
  await db.request().query(`
    DECLARE @ids TABLE (id INT);
    INSERT INTO @ids
    SELECT BookingID FROM dbo.Bookings
    WHERE Notes LIKE N'%${P6C_MARKER}%'
       OR BookingCode LIKE N'P6C-%'
       OR AssignedEmpID IN (SELECT EmpID FROM dbo.TblEmp WHERE EmpName LIKE N'%${P6C_MARKER}%');
    DELETE bs FROM dbo.BookingServices bs INNER JOIN @ids i ON i.id = bs.BookingID;
    DELETE b FROM dbo.Bookings b INNER JOIN @ids i ON i.id = b.BookingID;
  `);

  // Delete idempotency keys (tracked + prefix sweep)
  if (ctx.disposable.idempotencyKeys.length > 0) {
    const keyList = ctx.disposable.idempotencyKeys
      .map((k) => `'${k.replace(/'/g, "''")}'`)
      .join(',');
    await db.request().query(
      `DELETE FROM dbo.TblPublicBookingCreateRequest WHERE IdempotencyKey IN (${keyList})`,
    );
  }
  await db
    .request()
    .query(`DELETE FROM dbo.TblPublicBookingCreateRequest WHERE IdempotencyKey LIKE N'P6C-%'`);

  // Delete payroll plans
  if (ctx.disposable.payrollPlanIds.length > 0) {
    const ids = ctx.disposable.payrollPlanIds.join(',');
    await db.request().query(`DELETE FROM dbo.TblEmpBranchPayrollPlan WHERE PlanID IN (${ids})`);
  }
  await db.request().query(`
    DELETE FROM dbo.TblEmpBranchPayrollPlan
    WHERE EmpID IN (SELECT EmpID FROM dbo.TblEmp WHERE EmpName LIKE N'%${P6C_MARKER}%')
  `);

  // Delete assignments
  if (ctx.disposable.assignmentIds.length > 0) {
    const ids = ctx.disposable.assignmentIds.join(',');
    await db.request().query(`DELETE FROM dbo.TblEmpBranchAssignment WHERE ID IN (${ids})`);
  }
  await db.request().query(`
    DELETE FROM dbo.TblEmpBranchAssignment
    WHERE EmpID IN (SELECT EmpID FROM dbo.TblEmp WHERE EmpName LIKE N'%${P6C_MARKER}%')
  `);

  // Delete branch-owned weekly schedule rows + transfers for smoke emps
  await db.request().query(`
    DELETE FROM dbo.TblEmpTemporaryBranchTransfer
    WHERE EmpID IN (SELECT EmpID FROM dbo.TblEmp WHERE EmpName LIKE N'%${P6C_MARKER}%');
    DELETE FROM dbo.TblEmpBranchWorkSchedule
    WHERE EmpID IN (SELECT EmpID FROM dbo.TblEmp WHERE EmpName LIKE N'%${P6C_MARKER}%');
    DELETE FROM dbo.TblEmpTargetPlan
    WHERE EmpID IN (SELECT EmpID FROM dbo.TblEmp WHERE EmpName LIKE N'%${P6C_MARKER}%');
  `);

  // Delete customers created by smoke runs (phone marker)
  if (ctx.disposable.customerIds.length > 0) {
    const ids = ctx.disposable.customerIds.join(',');
    await db.request().query(`DELETE FROM dbo.TblClients WHERE ClientID IN (${ids})`);
  }

  // Soft-deactivate disposable employees (FK-safe; hard delete blocked by salary history etc.)
  if (ctx.disposable.empIds.length > 0) {
    const ids = ctx.disposable.empIds.join(',');
    await db.request().query(
      `UPDATE dbo.TblEmp SET isActive=0 WHERE EmpID IN (${ids}) AND EmpName LIKE N'%${P6C_MARKER}%'`,
    );
  }
  await db
    .request()
    .query(`UPDATE dbo.TblEmp SET isActive=0 WHERE EmpName LIKE N'%${P6C_MARKER}%'`);

  // Restore QueueBookingSettings states
  for (const [branchId, state] of ctx.qbsStates.entries()) {
    await restoreBookingEnabled(branchId, state);
  }

  // Mark smoke run cleaned
  await cleanupBranchSmokeRun({
    branchId: ctx.branchId,
    smokeRunId: ctx.smokeRun.smokeRunId,
    actorUserId: 0,
    markArtifactsCleaned: true,
    permitOperationalBranch: true,
  });
}

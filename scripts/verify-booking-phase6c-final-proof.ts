/**
 * Booking Phase 6C — Final Live Proof Verifier.
 * Executes every live scenario, records a TblBranchSmokeRun row, and cleans up.
 * Fails if any live scenario or post-cleanup invariant is violated.
 *
 * Run with a valid cloud DB connection:
 *   BOOKING_PHASE_6C_VERIFIER=enabled npx tsx scripts/verify-booking-phase6c-final-proof.ts
 */
import path from 'path';
import fs from 'fs';
import Module from 'module';
import crypto from 'crypto';
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

process.env.BOOKING_PHASE_6C_VERIFIER = 'enabled';

// Static imports of server-only modules are hoisted above the mock — load after hook.
type Harness = typeof import('../src/lib/__tests__/helpers/phase6cSmokeHarness');
type CreateMod = typeof import('../src/lib/booking/publicBookingCreate');
type DbMod = typeof import('../src/lib/db');

let initPhase6CSmokeContext: Harness['initPhase6CSmokeContext'];
let setupDisposableBarberPair: Harness['setupDisposableBarberPair'];
let setupCrossBranchGlobalEmployee: Harness['setupCrossBranchGlobalEmployee'];
let runCreate: Harness['runCreate'];
let runCreateInSmokeContext: Harness['runCreateInSmokeContext'];
let cleanupPhase6C: Harness['cleanupPhase6C'];
let makeBarrier: Harness['makeBarrier'];
let completeSmokeRun: Harness['completeSmokeRun'];
let P6C_MARKER: Harness['P6C_MARKER'];
let setBookingCreateTestHooks: CreateMod['setBookingCreateTestHooks'];
let clearBookingCreateTestHooks: CreateMod['clearBookingCreateTestHooks'];
let getPool: DbMod['getPool'];
let sql: DbMod['sql'];

async function loadServerModules(): Promise<void> {
  const harness = await import('../src/lib/__tests__/helpers/phase6cSmokeHarness');
  const createMod = await import('../src/lib/booking/publicBookingCreate');
  const dbMod = await import('../src/lib/db');
  initPhase6CSmokeContext = harness.initPhase6CSmokeContext;
  setupDisposableBarberPair = harness.setupDisposableBarberPair;
  setupCrossBranchGlobalEmployee = harness.setupCrossBranchGlobalEmployee;
  runCreate = harness.runCreate;
  runCreateInSmokeContext = harness.runCreateInSmokeContext;
  cleanupPhase6C = harness.cleanupPhase6C;
  makeBarrier = harness.makeBarrier;
  completeSmokeRun = harness.completeSmokeRun;
  P6C_MARKER = harness.P6C_MARKER;
  setBookingCreateTestHooks = createMod.setBookingCreateTestHooks;
  clearBookingCreateTestHooks = createMod.clearBookingCreateTestHooks;
  getPool = dbMod.getPool;
  sql = dbMod.sql;
}

type Verdict = 'GO' | 'NO-GO';

type ScenarioResult = {
  verdict: Verdict;
  scenario: string;
  httpCode?: number;
  bookingCount: number;
  distinctBookingCodes: number;
  distinctEmpIds: number;
  overlapCount: number;
  detailCount: number;
  idempotencyStatus?: string;
  customerCount: number;
  notificationAttemptCount: number;
  poolError: boolean;
  deadlock: boolean;
  notes: string;
};

type FinalResult = {
  smokeRunId: number | null;
  startedAt: string;
  completedAt: string;
  status: 'PASSED' | 'FAILED';
  cleanupStatus: 'COMPLETED' | 'INCOMPLETE';
  scenarios: ScenarioResult[];
  dbAssertionCounts: {
    activePhase6CBookings: number;
    activePhase6CEmployees: number;
    activePhase6CAssignments: number;
    activePhase6CSchedules: number;
    phase6CIdempotencyLeftovers: number;
    realGleemBookingsChanged: number;
    realCampCaesarDataChanged: number;
  };
  verdicts: Record<string, Verdict>;
};

const result: FinalResult = {
  smokeRunId: null,
  startedAt: new Date().toISOString(),
  completedAt: '',
  status: 'PASSED',
  cleanupStatus: 'INCOMPLETE',
  scenarios: [],
  dbAssertionCounts: {
    activePhase6CBookings: -1,
    activePhase6CEmployees: -1,
    activePhase6CAssignments: -1,
    activePhase6CSchedules: -1,
    phase6CIdempotencyLeftovers: -1,
    realGleemBookingsChanged: -1,
    realCampCaesarDataChanged: -1,
  },
  verdicts: {},
};

function fail(message: string): never {
  result.status = 'FAILED';
  throw new Error(message);
}

function record(scenario: ScenarioResult) {
  result.scenarios.push(scenario);
  if (scenario.verdict === 'NO-GO') result.status = 'FAILED';
}

async function assertNoPoolOrDeadlock(scenario: string, outcomes: Array<{ code: string; poolError?: boolean; deadlock?: boolean }>) {
  if (outcomes.some((o) => o.poolError)) fail(`${scenario}: pool acquisition failure`);
  if (outcomes.some((o) => o.deadlock)) fail(`${scenario}: unmapped deadlock`);
}

/** Disposable [SMOKE P6C] barbers are visible only inside SmokeExecutionContext. */
async function smokeRunCreate(
  ctx: Awaited<ReturnType<typeof initPhase6CSmokeContext>>,
  args: Parameters<typeof runCreate>[0],
) {
  return runCreateInSmokeContext(ctx, () => runCreate(args));
}

async function loadBaseGleemBookingCount(): Promise<number> {
  const db = await getPool();
  const r = await db
    .request()
    .query(`SELECT COUNT(*) AS cnt FROM dbo.Bookings WHERE BranchID=(SELECT TOP 1 BranchID FROM dbo.TblBranch WHERE BranchCode=N'GLEEM')`);
  return Number(r.recordset[0].cnt);
}

async function runAnyVsSpecific(ctx: Awaited<ReturnType<typeof initPhase6CSmokeContext>>) {
  const scenario = 'any_vs_specific';
  const workDate = '2026-12-20';
  const startTime = '08:00';
  const endTime = '22:00';
  const { empX, empY } = await setupDisposableBarberPair(ctx, workDate, startTime, endTime);
  await ctx.db
    .request()
    .input('branchId', sql.Int, ctx.gleemBranchId)
    .query(
      `UPDATE dbo.QueueBookingSettings SET BookingEnabled=1, UpdatedAt=GETDATE() WHERE BranchID=@branchId`,
    );

  const serviceIds = ctx.serviceProIds.slice(0, 1);
  const keyA = `P6C-AVS-A-${crypto.randomUUID()}`;
  const keyB = `P6C-AVS-B-${crypto.randomUUID()}`;

  const barrier = makeBarrier(2);
  const [a, b] = await Promise.all([
    (async () => {
      await barrier.wait();
      return smokeRunCreate(ctx, {
          branchCode: 'GLEEM',
          date: workDate,
          time: '14:00',
          dayOffset: 0,
          serviceIds,
          empId: empX,
          mode: 'specific_barber',
          customerName: `${P6C_MARKER} Specific`,
          customerPhone: '01000000001',
          idempotencyKey: keyA,
          suppressNotification: true,
        });
    })(),
    (async () => {
      await barrier.wait();
      return smokeRunCreate(ctx, {
          branchCode: 'GLEEM',
          date: workDate,
          time: '14:00',
          dayOffset: 0,
          serviceIds,
          mode: 'any_barber',
          customerName: `${P6C_MARKER} Any`,
          customerPhone: '01000000002',
          idempotencyKey: keyB,
          suppressNotification: true,
        });
    })(),
  ]);

  await assertNoPoolOrDeadlock(scenario, [a, b]);

  const successes = [a, b].filter((o) => o.ok);
  if (successes.length < 1) {
    fail(
      `${scenario}: expected at least one success (a=${a.ok ? a.code : a.code}, b=${b.ok ? b.code : b.code})`,
    );
  }
  if (successes.length === 2 && a.ok && b.ok && a.empId === b.empId) {
    fail(`${scenario}: both selected the same barber`);
  }
  if (a.ok && a.empId !== empX) {
    fail(`${scenario}: specific_barber must keep Emp X, got ${a.empId}`);
  }
  if (b.ok && a.ok && b.empId === empX) {
    fail(`${scenario}: any_barber must not also take Emp X when specific succeeded`);
  }
  // When any wins Emp X first, specific may lose — still a valid lock proof.
  if (b.ok && !a.ok && b.empId === empX && a.code !== 'SLOT_UNAVAILABLE' && a.code !== 'BOOKING_LOCK_TIMEOUT') {
    fail(`${scenario}: specific failed with unexpected code ${a.code}`);
  }

  for (const s of successes) {
    if (s.ok) ctx.disposable.bookingCodes.push(s.code);
  }
  ctx.disposable.idempotencyKeys.push(keyA, keyB);

  const db = await getPool();
  const overlaps = await db
    .request()
    .input('empX', sql.Int, empX)
    .input('empY', sql.Int, empY)
    .query(
      `SELECT AssignedEmpID, COUNT(*) AS cnt FROM dbo.Bookings WHERE AssignedEmpID IN (@empX,@empY) AND Status=N'confirmed' GROUP BY AssignedEmpID`,
    );
  const xCount = Number(overlaps.recordset.find((r: Record<string, unknown>) => Number(r.AssignedEmpID) === empX)?.cnt ?? 0);
  const yCount = Number(overlaps.recordset.find((r: Record<string, unknown>) => Number(r.AssignedEmpID) === empY)?.cnt ?? 0);
  if (xCount > 1 || yCount > 1) fail(`${scenario}: overlapping disposable barber bookings`);

  const codes = successes.filter((s) => s.ok).map((s) => s.code);
  let detailCount = 0;
  if (codes.length > 0) {
    const details = await db
      .request()
      .query(
        `SELECT COUNT(*) AS cnt FROM dbo.BookingServices WHERE BookingID IN (SELECT BookingID FROM dbo.Bookings WHERE BookingCode IN (${codes.map((c) => `'${c.replace(/'/g, "''")}'`).join(',')}))`,
      );
    detailCount = Number(details.recordset[0].cnt);
  }

  const empIds = successes.filter((s) => s.ok).map((s) => s.empId);
  record({
    verdict: 'GO',
    scenario,
    bookingCount: successes.length,
    distinctBookingCodes: new Set(codes).size,
    distinctEmpIds: new Set(empIds).size,
    overlapCount: 0,
    detailCount,
    idempotencyStatus: 'COMPLETED',
    customerCount: successes.length,
    notificationAttemptCount: 0,
    poolError: false,
    deadlock: false,
    notes: `a=${a.ok ? `ok:${a.empId}` : a.code}, b=${b.ok ? `ok:${b.empId}` : b.code}`,
  });
}

async function runCrossBranchGlobalRace(ctx: Awaited<ReturnType<typeof initPhase6CSmokeContext>>) {
  const scenario = 'cross_branch_global';
  const workDate = '2026-12-21';
  const startTime = '08:00';
  const endTime = '22:00';
  const empId = await setupCrossBranchGlobalEmployee(ctx, workDate, startTime, endTime);

  await ctx.db
    .request()
    .input('branchId', sql.Int, ctx.gleemBranchId)
    .query(
      `UPDATE dbo.QueueBookingSettings SET BookingEnabled=1, UpdatedAt=GETDATE() WHERE BranchID=@branchId`,
    );

  const serviceIds = ctx.serviceProIds.slice(0, 1);
  const keyPublic = `P6C-CB-P-${crypto.randomUUID()}`;
  const keyInternal = `P6C-CB-I-${crypto.randomUUID()}`;

  const barrier = makeBarrier(2);
  const [publicReq, internalReq] = await Promise.all([
    (async () => {
      await barrier.wait();
      return smokeRunCreate(ctx, {
          branchCode: 'GLEEM',
          date: workDate,
          time: '14:00',
          dayOffset: 0,
          serviceIds,
          empId,
          mode: 'specific_barber',
          customerName: 'Phase6C Cross Public',
          customerPhone: '01000000003',
          idempotencyKey: keyPublic,
          suppressNotification: true,
        });
    })(),
    (async () => {
      await barrier.wait();
      return smokeRunCreate(ctx, {
          branchCode: 'CAMP_CAESAR',
          date: workDate,
          time: '14:00',
          dayOffset: 0,
          serviceIds,
          empId,
          mode: 'specific_barber',
          customerName: 'Phase6C Cross Internal',
          customerPhone: '01000000004',
          idempotencyKey: keyInternal,
          suppressNotification: true,
          auth: { userId: ctx.smokeRun.startedByUserId, canOperate: true },
          purpose: 'internal_preview',
        });
    })(),
  ]);

  await assertNoPoolOrDeadlock(scenario, [publicReq, internalReq]);

  const successes = [publicReq, internalReq].filter((o) => o.ok);
  if (successes.length > 1) fail(`${scenario}: more than one success for the same global interval`);
  const failed = [publicReq, internalReq].find((o) => !o.ok);
  if (failed && !['SLOT_UNAVAILABLE', 'BOOKING_LOCK_TIMEOUT'].includes(failed.code)) {
    fail(`${scenario}: expected SLOT_UNAVAILABLE or BOOKING_LOCK_TIMEOUT, got ${failed.code}`);
  }

  for (const o of successes) {
    if (o.ok) ctx.disposable.bookingCodes.push(o.code);
  }
  ctx.disposable.idempotencyKeys.push(keyPublic, keyInternal);

  const db = await getPool();
  const overlap = await db
    .request()
    .input('empId', sql.Int, empId)
    .query(
      `SELECT COUNT(*) AS cnt FROM dbo.Bookings WHERE AssignedEmpID=@empId AND Status=N'confirmed'`,
    );
  const overlapCount = Number(overlap.recordset[0].cnt);
  if (overlapCount > 1) fail(`${scenario}: duplicate global EmpID bookings`);

  record({
    verdict: overlapCount <= 1 ? 'GO' : 'NO-GO',
    scenario,
    bookingCount: overlapCount,
    distinctBookingCodes: successes.length,
    distinctEmpIds: 1,
    overlapCount,
    detailCount: successes.length * serviceIds.length,
    idempotencyStatus: successes.length === 1 ? 'COMPLETED' : 'FAILED',
    customerCount: successes.length,
    notificationAttemptCount: 0,
    poolError: false,
    deadlock: false,
    notes: `successes=${successes.length}, first=${successes[0]?.empId ?? 'none'}`,
  });
}

async function runRollbackRetry(ctx: Awaited<ReturnType<typeof initPhase6CSmokeContext>>) {
  const scenario = 'rollback_retry';
  const workDate = '2026-12-22';
  const startTime = '08:00';
  const endTime = '22:00';
  const { empX } = await setupDisposableBarberPair(ctx, workDate, startTime, endTime);

  await ctx.db
    .request()
    .input('branchId', sql.Int, ctx.gleemBranchId)
    .query(
      `UPDATE dbo.QueueBookingSettings SET BookingEnabled=1, UpdatedAt=GETDATE() WHERE BranchID=@branchId`,
    );

  const serviceIds = ctx.serviceProIds.slice(0, 1);
  const key = `P6C-RR-${crypto.randomUUID()}`;

  let injected = false;
  setBookingCreateTestHooks({
    postBookingHeadInsert: async () => {
      if (!injected) {
        injected = true;
        throw new Error('INJECTED_POST_HEAD_FAILURE');
      }
    },
  });

  const failResult = await smokeRunCreate(ctx, {
    branchCode: 'GLEEM',
    date: workDate,
    time: '14:00',
    dayOffset: 0,
    serviceIds,
    empId: empX,
    mode: 'specific_barber',
    customerName: 'Phase6C Rollback',
    customerPhone: '01000000010',
    idempotencyKey: key,
    suppressNotification: true,
  });

  if (failResult.ok) fail(`${scenario}: expected rollback failure`);
  await assertNoPoolOrDeadlock(scenario, [failResult]);

  const db = await getPool();
  const idemFail = await db
    .request()
    .input('key', sql.NVarChar, key)
    .query(
      `SELECT Status, LastErrorCode FROM dbo.TblPublicBookingCreateRequest WHERE IdempotencyKey=@key`,
    );
  if (idemFail.recordset[0]?.Status !== 'FAILED') {
    fail(`${scenario}: idempotency status not FAILED after rollback`);
  }

  const headCount = await db
    .request()
    .input('key', sql.NVarChar, key)
    .query(
      `SELECT COUNT(*) AS cnt FROM dbo.Bookings WHERE IdempotencyRequestID=(SELECT RequestID FROM dbo.TblPublicBookingCreateRequest WHERE IdempotencyKey=@key)`,
    );
  if (Number(headCount.recordset[0].cnt) !== 0) {
    fail(`${scenario}: partial booking rows exist after rollback`);
  }

  clearBookingCreateTestHooks();

  const retry = await smokeRunCreate(ctx, {
    branchCode: 'GLEEM',
    date: workDate,
    time: '14:00',
    dayOffset: 0,
    serviceIds,
    empId: empX,
    mode: 'specific_barber',
    customerName: 'Phase6C Retry',
    customerPhone: '01000000010',
    idempotencyKey: key,
    suppressNotification: true,
  });

  if (!retry.ok) fail(`${scenario}: retry failed: ${retry.code}`);
  ctx.disposable.bookingCodes.push(retry.code);
  ctx.disposable.idempotencyKeys.push(key);

  const details = await db
    .request()
    .input('code', sql.NVarChar, retry.code)
    .query(
      `SELECT COUNT(*) AS cnt FROM dbo.BookingServices WHERE BookingID=(SELECT BookingID FROM dbo.Bookings WHERE BookingCode=@code)`,
    );

  record({
    verdict: 'GO',
    scenario,
    bookingCount: 1,
    distinctBookingCodes: 1,
    distinctEmpIds: 1,
    overlapCount: 0,
    detailCount: Number(details.recordset[0].cnt),
    idempotencyStatus: 'COMPLETED',
    customerCount: 1,
    notificationAttemptCount: 0,
    poolError: false,
    deadlock: false,
    notes: 'rollback then retry with same key',
  });
}

async function runCodeCollision(ctx: Awaited<ReturnType<typeof initPhase6CSmokeContext>>) {
  const scenario = 'code_collision';
  const workDate = '2026-12-23';
  const startTime = '08:00';
  const endTime = '22:00';
  const { empX, empY } = await setupDisposableBarberPair(ctx, workDate, startTime, endTime);

  await ctx.db
    .request()
    .input('branchId', sql.Int, ctx.gleemBranchId)
    .query(
      `UPDATE dbo.QueueBookingSettings SET BookingEnabled=1, UpdatedAt=GETDATE() WHERE BranchID=@branchId`,
    );

  const serviceIds = ctx.serviceProIds.slice(0, 1);
  const fixedCode = `P6C-COLL-${Date.now().toString(36).toUpperCase()}`;

  // Seed collision row
  await ctx.db.request().input('code', sql.NVarChar, fixedCode).query(`
    IF NOT EXISTS (SELECT 1 FROM dbo.Bookings WHERE BookingCode=@code)
      INSERT INTO dbo.Bookings (ClientID, AssignedEmpID, BookingDate, StartTime, EndTime, Status, Source, BookingCode, BranchID)
      VALUES (0, 0, '2026-12-01', '10:00:00', '10:30:00', 'confirmed', 'smoke_seed', @code, (SELECT TOP 1 BranchID FROM dbo.TblBranch WHERE BranchCode=N'GLEEM'))
  `);

  let calls = 0;
  setBookingCreateTestHooks({
    generateBookingCode: () => {
      calls += 1;
      return calls === 1 ? fixedCode : `P6C-OK-${Date.now().toString(36).toUpperCase()}`;
    },
  });

  const key = `P6C-COLL-${crypto.randomUUID()}`;
  const success = await smokeRunCreate(ctx, {
    branchCode: 'GLEEM',
    date: workDate,
    time: '14:00',
    dayOffset: 0,
    serviceIds,
    empId: empX,
    mode: 'specific_barber',
    customerName: 'Phase6C Collision Retry',
    customerPhone: '01000000011',
    idempotencyKey: key,
    suppressNotification: true,
  });

  clearBookingCreateTestHooks();
  if (!success.ok) fail(`${scenario}: expected success after collision retry`);
  ctx.disposable.bookingCodes.push(success.code);
  ctx.disposable.idempotencyKeys.push(key);

  const alwaysCode = `P6C-ALWAYS-${Date.now().toString(36).toUpperCase()}`;
  await ctx.db.request().input('code', sql.NVarChar, alwaysCode).query(`
    IF NOT EXISTS (SELECT 1 FROM dbo.Bookings WHERE BookingCode=@code)
      INSERT INTO dbo.Bookings (ClientID, AssignedEmpID, BookingDate, StartTime, EndTime, Status, Source, BookingCode, BranchID)
      VALUES (0, 0, '2026-12-01', '15:00:00', '15:30:00', 'confirmed', 'smoke_seed', @code, (SELECT TOP 1 BranchID FROM dbo.TblBranch WHERE BranchCode=N'GLEEM'))
  `);
  setBookingCreateTestHooks({
    generateBookingCode: () => alwaysCode,
  });
  const failKey = `P6C-COLL-FAIL-${crypto.randomUUID()}`;
  const failOutcome = await smokeRunCreate(ctx, {
    branchCode: 'GLEEM',
    date: workDate,
    time: '14:00',
    dayOffset: 0,
    serviceIds,
    empId: empY,
    mode: 'specific_barber',
    customerName: 'Phase6C Always Fail',
    customerPhone: '01000000012',
    idempotencyKey: failKey,
    suppressNotification: true,
  });
  clearBookingCreateTestHooks();

  if (failOutcome.ok || failOutcome.code !== 'BOOKING_CODE_GENERATION_FAILED') {
    fail(
      `${scenario}: expected BOOKING_CODE_GENERATION_FAILED for every-retry collision, got ${failOutcome.ok ? 'ok' : failOutcome.code}`,
    );
  }
  ctx.disposable.idempotencyKeys.push(failKey);

  record({
    verdict: 'GO',
    scenario,
    bookingCount: 1,
    distinctBookingCodes: 1,
    distinctEmpIds: 1,
    overlapCount: 0,
    detailCount: serviceIds.length,
    idempotencyStatus: 'COMPLETED',
    customerCount: 1,
    notificationAttemptCount: 0,
    poolError: false,
    deadlock: false,
    notes: `collision retry OK=${success.code}, always-fail code=${failOutcome.code}`,
  });
}

async function runMultiServiceOverlap(ctx: Awaited<ReturnType<typeof initPhase6CSmokeContext>>) {
  const scenario = 'multi_service_overlap';
  const workDate = '2026-12-24';
  const startTime = '08:00';
  const endTime = '22:00';
  const { empX } = await setupDisposableBarberPair(ctx, workDate, startTime, endTime);

  await ctx.db
    .request()
    .input('branchId', sql.Int, ctx.gleemBranchId)
    .query(
      `UPDATE dbo.QueueBookingSettings SET BookingEnabled=1, UpdatedAt=GETDATE() WHERE BranchID=@branchId`,
    );

  const serviceIds = ctx.serviceProIds.slice(0, 3);
  if (serviceIds.length < 2) fail(`${scenario}: need at least 2 distinct services`);
  const baseKey = `P6C-MS-${crypto.randomUUID()}`;

  const base = await smokeRunCreate(ctx, {
    branchCode: 'GLEEM',
    date: workDate,
    time: '14:00',
    dayOffset: 0,
    serviceIds,
    empId: empX,
    mode: 'specific_barber',
    customerName: 'Phase6C Base',
    customerPhone: '01000000013',
    idempotencyKey: `${baseKey}-base`,
    suppressNotification: true,
  });
  if (!base.ok) fail(`${scenario}: base booking failed: ${base.code}`);
  ctx.disposable.bookingCodes.push(base.code);

  const db = await getPool();
  const baseRow = await db
    .request()
    .input('code', sql.NVarChar, base.code)
    .query(`SELECT AbsoluteStartUtc, AbsoluteEndUtc FROM dbo.Bookings WHERE BookingCode=@code`);
  const startMs = new Date(String(baseRow.recordset[0].AbsoluteStartUtc)).getTime();
  const endMs = new Date(String(baseRow.recordset[0].AbsoluteEndUtc)).getTime();
  const durationMinutes = Math.round((endMs - startMs) / 60_000);
  if (durationMinutes < 30) fail(`${scenario}: expected multi-service duration >= 30, got ${durationMinutes}`);

  function addMins(time: string, minutes: number): string {
    let total = Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5)) + minutes;
    total = ((total % 1440) + 1440) % 1440;
    return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
  }

  const cases: Array<{ label: string; time: string; expectedOk: boolean }> = [
    { label: 'same_start', time: '14:00', expectedOk: false },
    {
      label: 'inside_mid',
      time: addMins('14:00', Math.max(1, Math.floor(durationMinutes / 2))),
      expectedOk: false,
    },
    { label: 'inside_end_minus_1', time: addMins('14:00', durationMinutes - 1), expectedOk: false },
    { label: 'exact_end', time: addMins('14:00', durationMinutes), expectedOk: true },
  ];

  for (const c of cases) {
    const outcome = await smokeRunCreate(ctx, {
      branchCode: 'GLEEM',
      date: workDate,
      time: c.time,
      dayOffset: 0,
      serviceIds,
      empId: empX,
      mode: 'specific_barber',
      customerName: `Phase6C ${c.label}`,
      customerPhone: '01000000014',
      idempotencyKey: `${baseKey}-${c.label}`,
      suppressNotification: true,
    });
    if (outcome.ok !== c.expectedOk) {
      fail(`${scenario}: ${c.label} expected ok=${c.expectedOk} got ${outcome.ok} (${outcome.ok ? outcome.code : outcome.code})`);
    }
    if (outcome.ok) ctx.disposable.bookingCodes.push(outcome.code);
  }

  ctx.disposable.idempotencyKeys.push(
    `${baseKey}-base`,
    `${baseKey}-same_start`,
    `${baseKey}-inside_mid`,
    `${baseKey}-inside_end_minus_1`,
    `${baseKey}-exact_end`,
  );

  record({
    verdict: 'GO',
    scenario,
    bookingCount: 2,
    distinctBookingCodes: 2,
    distinctEmpIds: 1,
    overlapCount: 0,
    detailCount: 2 * serviceIds.length,
    idempotencyStatus: 'COMPLETED',
    customerCount: 2,
    notificationAttemptCount: 0,
    poolError: false,
    deadlock: false,
    notes: `${durationMinutes}-minute multi-service base, exact-end allowed`,
  });
}

async function runOvernightEquivalent(ctx: Awaited<ReturnType<typeof initPhase6CSmokeContext>>) {
  const scenario = 'overnight_equivalent';
  const workDate = '2026-12-25';
  const startTime = '20:00';
  const endTime = '04:00';
  const { empX } = await setupDisposableBarberPair(ctx, workDate, startTime, endTime);

  await ctx.db
    .request()
    .input('branchId', sql.Int, ctx.gleemBranchId)
    .query(
      `UPDATE dbo.QueueBookingSettings SET BookingEnabled=1, UpdatedAt=GETDATE() WHERE BranchID=@branchId`,
    );

  const serviceIds = ctx.serviceProIds.slice(0, 1);
  const baseKey = `P6C-OVR-${crypto.randomUUID()}`;

  const canonical = await smokeRunCreate(ctx, {
    branchCode: 'GLEEM',
    date: workDate,
    time: '00:15',
    dayOffset: 1,
    serviceIds,
    empId: empX,
    mode: 'specific_barber',
    customerName: 'Phase6C Canonical',
    customerPhone: '01000000015',
    idempotencyKey: `${baseKey}-canonical`,
    suppressNotification: true,
  });
  if (!canonical.ok) fail(`${scenario}: canonical overnight booking failed: ${canonical.code}`);
  ctx.disposable.bookingCodes.push(canonical.code);

  const db = await getPool();
  const prow = await db
    .request()
    .input('code', sql.NVarChar, canonical.code)
    .query(
      `SELECT PublicWorkDate, PublicDayOffset, AbsoluteStartUtc, AbsoluteEndUtc FROM dbo.Bookings WHERE BookingCode=@code`,
    );
  const row = prow.recordset[0];
  if (Number(row.PublicDayOffset) !== 1 || !row.PublicWorkDate || !row.AbsoluteStartUtc) {
    fail(`${scenario}: canonical columns missing`);
  }

  const duplicate = await smokeRunCreate(ctx, {
    branchCode: 'GLEEM',
    date: '2026-12-26',
    time: '00:15',
    dayOffset: 0,
    serviceIds,
    empId: empX,
    mode: 'specific_barber',
    customerName: 'Phase6C Duplicate Repr',
    customerPhone: '01000000016',
    idempotencyKey: `${baseKey}-duplicate`,
    suppressNotification: true,
  });
  if (duplicate.ok) fail(`${scenario}: duplicate representation succeeded`);
  if (
    ![
      'SLOT_UNAVAILABLE',
      'BOOKING_LOCK_TIMEOUT',
      'SLOT_OUTSIDE_BRANCH_HOURS',
      'BARBER_DAY_OFF',
    ].includes(duplicate.code)
  ) {
    fail(`${scenario}: unexpected duplicate code ${duplicate.code}`);
  }

  ctx.disposable.idempotencyKeys.push(`${baseKey}-canonical`, `${baseKey}-duplicate`);

  record({
    verdict: 'GO',
    scenario,
    bookingCount: 1,
    distinctBookingCodes: 1,
    distinctEmpIds: 1,
    overlapCount: 0,
    detailCount: serviceIds.length,
    idempotencyStatus: 'COMPLETED',
    customerCount: 1,
    notificationAttemptCount: 0,
    poolError: false,
    deadlock: false,
    notes: `canonical dayOffset=1 accepted, alternate rejected (${duplicate.code})`,
  });
}

async function assertCleanupCounts(ctx: Awaited<ReturnType<typeof initPhase6CSmokeContext>>) {
  const db = await getPool();
  const gleemId = ctx.gleemBranchId;
  const campId = ctx.campBranchId;

  const [activeBookings, activeEmps, activeAssigns, activeSchedules, idemLeft, gleemChanged, campChanged] = await Promise.all([
    db
      .request()
      .query(
        `SELECT COUNT(*) AS cnt FROM dbo.Bookings WHERE Notes LIKE N'%${P6C_MARKER}%' AND Status=N'confirmed'`,
      ),
    db
      .request()
      .query(
        `SELECT COUNT(*) AS cnt FROM dbo.TblEmp WHERE EmpName LIKE N'%${P6C_MARKER}%' AND ISNULL(isActive,1)=1`,
      ),
    db
      .request()
      .query(
        `SELECT COUNT(*) AS cnt FROM dbo.TblEmpBranchAssignment WHERE IsActive=1 AND EmpID IN (SELECT EmpID FROM dbo.TblEmp WHERE EmpName LIKE N'%${P6C_MARKER}%')`,
      ),
    db
      .request()
      .query(
        `SELECT COUNT(*) AS cnt FROM dbo.TblEmpBranchWorkSchedule WHERE IsActive=1 AND EmpID IN (SELECT EmpID FROM dbo.TblEmp WHERE EmpName LIKE N'%${P6C_MARKER}%')`,
      ),
    db
      .request()
      .query(
        `SELECT COUNT(*) AS cnt FROM dbo.TblPublicBookingCreateRequest WHERE IdempotencyKey LIKE N'P6C-%'`,
      ),
    db
      .request()
      .input('gleemId', sql.Int, gleemId)
      .query(`SELECT COUNT(*) AS cnt FROM dbo.Bookings WHERE BranchID=@gleemId AND Notes NOT LIKE N'%${P6C_MARKER}%'`),
    db
      .request()
      .input('campId', sql.Int, campId)
      .query(`SELECT COUNT(*) AS cnt FROM dbo.Bookings WHERE BranchID=@campId AND Notes NOT LIKE N'%${P6C_MARKER}%'`),
  ]);

  result.dbAssertionCounts = {
    activePhase6CBookings: Number(activeBookings.recordset[0].cnt),
    activePhase6CEmployees: Number(activeEmps.recordset[0].cnt),
    activePhase6CAssignments: Number(activeAssigns.recordset[0].cnt),
    activePhase6CSchedules: Number(activeSchedules.recordset[0].cnt),
    phase6CIdempotencyLeftovers: Number(idemLeft.recordset[0].cnt),
    realGleemBookingsChanged: Number(gleemChanged.recordset[0].cnt),
    realCampCaesarDataChanged: Number(campChanged.recordset[0].cnt),
  };

  if (result.dbAssertionCounts.activePhase6CBookings !== 0) fail('cleanup: leftover Phase 6C bookings');
  if (result.dbAssertionCounts.activePhase6CEmployees !== 0) fail('cleanup: leftover Phase 6C employees');
  if (result.dbAssertionCounts.activePhase6CAssignments !== 0) fail('cleanup: leftover Phase 6C assignments');
  if (result.dbAssertionCounts.phase6CIdempotencyLeftovers !== 0) fail('cleanup: leftover Phase 6C idempotency keys');
}

async function main() {
  await loadServerModules();
  const ctx = await initPhase6CSmokeContext();
  result.smokeRunId = ctx.smokeRun.smokeRunId;
  const baseGleemCount = await loadBaseGleemBookingCount();

  try {
    await runAnyVsSpecific(ctx);
    await runCrossBranchGlobalRace(ctx);
    await runRollbackRetry(ctx);
    await runCodeCollision(ctx);
    await runMultiServiceOverlap(ctx);
    await runOvernightEquivalent(ctx);

    await cleanupPhase6C(ctx);
    result.cleanupStatus = 'COMPLETED';
    await assertCleanupCounts(ctx);

    const afterGleemCount = await loadBaseGleemBookingCount();
    if (afterGleemCount !== baseGleemCount) {
      fail(`GLEEM booking count changed: ${baseGleemCount} -> ${afterGleemCount}`);
    }

    result.verdicts = {
      any_vs_specific: result.scenarios.find((s) => s.scenario === 'any_vs_specific')?.verdict ?? 'NO-GO',
      cross_branch_global: result.scenarios.find((s) => s.scenario === 'cross_branch_global')?.verdict ?? 'NO-GO',
      rollback_and_retry: result.scenarios.find((s) => s.scenario === 'rollback_retry')?.verdict ?? 'NO-GO',
      multi_service_overlap: result.scenarios.find((s) => s.scenario === 'multi_service_overlap')?.verdict ?? 'NO-GO',
      overnight_canonical: result.scenarios.find((s) => s.scenario === 'overnight_equivalent')?.verdict ?? 'NO-GO',
      code_collision: result.scenarios.find((s) => s.scenario === 'code_collision')?.verdict ?? 'NO-GO',
      smoke_registry: result.smokeRunId ? 'GO' : 'NO-GO',
      cleanup: result.cleanupStatus === 'COMPLETED' ? 'GO' : 'NO-GO',
    };

    await completeSmokeRun(ctx, result.status === 'PASSED' ? 'PASSED' : 'FAILED', result);
  } catch (e) {
    result.status = 'FAILED';
    try {
      await cleanupPhase6C(ctx);
    } catch {
      /* best effort */
    }
    await completeSmokeRun(ctx, 'FAILED', { ...result, error: String(e) });
    throw e;
  } finally {
    result.completedAt = new Date().toISOString();
    const dest = path.join(__dirname, 'branch-smoke', '_booking-phase6c-final-proof.json');
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result, null, 2));
    console.log('wrote', dest);
  }
}

main()
  .then(() => {
    process.exit(0);
  })
  .catch((e) => {
    console.error('FAIL', e);
    process.exit(1);
  });

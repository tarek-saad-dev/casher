import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { planBusinessDayReconciliation } from '@/modules/operations/domain/businessDayReconciliation';
import { AUTO_BUSINESS_DAY_ROLLOVER } from '@/modules/operations/domain/invariants';

vi.mock('server-only', () => ({}));

type DayRow = { ID: number; BranchID: number; NewDay: string; Status: boolean };
type ShiftRow = {
  ID: number;
  BranchID: number;
  BusinessDayID: number;
  NewDay: string;
  UserID: number;
  ShiftID: number;
  StartDate: string | null;
  StartTime: string | null;
  EndDate: string | null;
  EndTime: string | null;
  Status: boolean;
};

const GLEEM = 1;
const CAMP = 2;
/** 08:00 Africa/Cairo on 2026-08-25 (UTC+3). */
const AT_EIGHT = new Date('2026-08-25T05:00:00.000Z');
/** 02:00 Africa/Cairo on 2026-08-25. */
const AT_TWO = new Date('2026-08-24T23:00:00.000Z');
/** 05:00 Africa/Cairo on 2026-08-25 — after cutoff, before rollover. */
const AT_FIVE = new Date('2026-08-25T02:00:00.000Z');

const CLOCK = { timeZone: 'Africa/Cairo', businessDayCutoffTime: '04:00:00' };

function clone<T>(v: T): T {
  return structuredClone(v);
}

class InMemoryOpsDb {
  users = new Set<number>([7]);
  branches = new Set<number>([GLEEM, CAMP]);
  days: DayRow[] = [];
  shifts: ShiftRow[] = [];
  nextDayId = 1;
  nextShiftId = 1;
  sqlLog: string[] = [];
  failNextDayInsert = false;
  private chain = Promise.resolve();
  private snapshot: {
    days: DayRow[];
    shifts: ShiftRow[];
    nextDayId: number;
    nextShiftId: number;
  } | null = null;

  seedDay(row: Partial<DayRow> & Pick<DayRow, 'BranchID'>): DayRow {
    const day: DayRow = {
      ID: row.ID ?? this.nextDayId++,
      BranchID: row.BranchID,
      NewDay: row.NewDay ?? '2026-08-24',
      Status: row.Status ?? true,
    };
    this.days.push(day);
    this.nextDayId = Math.max(this.nextDayId, day.ID + 1);
    return day;
  }

  seedShift(row: Partial<ShiftRow> & Pick<ShiftRow, 'BranchID' | 'BusinessDayID' | 'UserID'>): ShiftRow {
    const day = this.days.find((d) => d.ID === row.BusinessDayID);
    const shift: ShiftRow = {
      ID: row.ID ?? this.nextShiftId++,
      BranchID: row.BranchID,
      BusinessDayID: row.BusinessDayID,
      NewDay: row.NewDay ?? day?.NewDay ?? '2026-08-24',
      UserID: row.UserID,
      ShiftID: row.ShiftID ?? 1,
      StartDate: row.StartDate ?? '2026-08-24',
      StartTime: row.StartTime ?? '10:00 AM',
      EndDate: row.EndDate ?? null,
      EndTime: row.EndTime ?? null,
      Status: row.Status ?? true,
    };
    this.shifts.push(shift);
    this.nextShiftId = Math.max(this.nextShiftId, shift.ID + 1);
    return shift;
  }

  openDays(branchId: number) {
    return this.days.filter((d) => d.BranchID === branchId && d.Status);
  }

  async begin() {
    const prev = this.chain;
    let release!: () => void;
    this.chain = new Promise<void>((resolve) => {
      release = resolve;
    });
    await prev;
    this.snapshot = {
      days: clone(this.days),
      shifts: clone(this.shifts),
      nextDayId: this.nextDayId,
      nextShiftId: this.nextShiftId,
    };
    (this as unknown as { _release: () => void })._release = release;
  }

  async commit() {
    this.snapshot = null;
    (this as unknown as { _release?: () => void })._release?.();
  }

  async rollback() {
    if (this.snapshot) {
      this.days = this.snapshot.days;
      this.shifts = this.snapshot.shifts;
      this.nextDayId = this.snapshot.nextDayId;
      this.nextShiftId = this.snapshot.nextShiftId;
      this.snapshot = null;
    }
    (this as unknown as { _release?: () => void })._release?.();
  }

  exec(sqlText: string, params: Record<string, unknown>) {
    this.sqlLog.push(sqlText.replace(/\s+/g, ' ').trim());
    const s = sqlText;

    if (s.includes('FROM dbo.TblBranch')) {
      const branchRow = (id: number) => ({
        BranchID: id,
        BranchCode: id === GLEEM ? 'GLEEM' : 'CAMP_CAESAR',
        BranchName: id === GLEEM ? 'جليم' : 'كامب شيزار',
        ShortName: null,
        Address: null,
        Phone: null,
        TimeZone: 'Africa/Cairo',
        BusinessDayCutoffTime: '04:00:00',
        DefaultOpenTime: null,
        DefaultCloseTime: null,
        IsActive: true,
        CreatedAt: new Date('2026-01-01T00:00:00.000Z'),
        UpdatedAt: null,
        LifecycleStatus: 'PUBLIC_LIVE',
        PublicBookingEnabled: true,
        ExternalNotificationsEnabled: true,
      });
      if (params.branchId != null) {
        const branchId = Number(params.branchId);
        return { recordset: this.branches.has(branchId) ? [branchRow(branchId)] : [] };
      }
      return {
        recordset: [...this.branches].map((id) => branchRow(id)),
      };
    }

    if (s.includes('FROM dbo.TblUser')) {
      const userId = Number(params.userId);
      return { recordset: this.users.has(userId) ? [{ UserID: userId }] : [] };
    }

    if (s.includes('INSERT INTO dbo.TblNewDay')) {
      if (this.failNextDayInsert) {
        this.failNextDayInsert = false;
        throw new Error('simulated day insert failure');
      }
      if (this.days.some((d) => d.BranchID === Number(params.branchId) && d.Status)) {
        throw new Error(
          "Cannot insert duplicate key row in object 'dbo.TblNewDay' with unique index 'UX_TblNewDay_OneOpenPerBranch'",
        );
      }
      const inserted: DayRow = {
        ID: this.nextDayId++,
        BranchID: Number(params.branchId),
        NewDay:
          params.newDay instanceof Date
            ? params.newDay.toISOString().slice(0, 10)
            : String(params.newDay).slice(0, 10),
        Status: true,
      };
      this.days.push(inserted);
      return { recordset: [inserted] };
    }

    if (s.includes('UPDATE dbo.TblNewDay')) {
      const id = Number(params.id ?? params.dayID);
      const branchId = Number(params.branchId);
      const row = this.days.find((d) => d.ID === id && d.BranchID === branchId);
      if (!row) return { recordset: [], rowsAffected: [0] };
      if (s.includes('SET Status = 1')) {
        if (row.Status) return { recordset: [], rowsAffected: [0] };
        row.Status = true;
        return { recordset: [row], rowsAffected: [1] };
      }
      if (!row.Status) return { recordset: [], rowsAffected: [0] };
      row.Status = false;
      return { recordset: [row], rowsAffected: [1] };
    }

    if (s.includes('UPDATE dbo.TblShiftMove') && s.includes('BusinessDayID')) {
      const branchId = Number(params.branchId);
      const businessDayId = Number(params.businessDayId);
      let closed = 0;
      for (const sh of this.shifts) {
        if (sh.Status && sh.BranchID === branchId && sh.BusinessDayID === businessDayId) {
          sh.Status = false;
          sh.EndDate = '2026-08-25';
          sh.EndTime = '08:00:00 AM';
          closed += 1;
        }
      }
      return { recordset: [{ ClosedCount: closed }], rowsAffected: [closed] };
    }

    if (s.includes('UPDATE dbo.TblShiftMove')) {
      const id = Number(params.id);
      const branchId = Number(params.branchId);
      const row = this.shifts.find((sh) => sh.ID === id && sh.BranchID === branchId && sh.Status);
      if (!row) return { recordset: [], rowsAffected: [0] };
      row.Status = false;
      row.EndDate = '2026-08-25';
      row.EndTime = '08:00:00 AM';
      return { recordset: [], rowsAffected: [1] };
    }

    if (s.includes('INSERT INTO dbo.TblShiftMove')) {
      const inserted: ShiftRow = {
        ID: this.nextShiftId++,
        BranchID: Number(params.branchId),
        BusinessDayID: Number(params.businessDayId),
        NewDay: String(params.newDay).slice(0, 10),
        UserID: Number(params.userID),
        ShiftID: Number(params.shiftID),
        StartDate: String(params.startDate).slice(0, 10),
        StartTime: String(params.startTime ?? '10:00 AM'),
        EndDate: null,
        EndTime: null,
        Status: true,
      };
      this.shifts.push(inserted);
      return { recordset: [inserted] };
    }

    if (s.includes('FROM dbo.TblNewDay WITH (UPDLOCK') && s.includes('WHERE ID =')) {
      const day = this.days.find((d) => d.ID === Number(params.id));
      return { recordset: day ? [day] : [] };
    }

    if (s.includes('FROM dbo.TblNewDay WITH (UPDLOCK') && s.includes('NewDay =')) {
      const wanted =
        params.newDay instanceof Date
          ? params.newDay.toISOString().slice(0, 10)
          : String(params.newDay).slice(0, 10);
      const day = [...this.days]
        .filter((d) => d.BranchID === Number(params.branchId) && d.NewDay === wanted)
        .sort((a, b) => b.ID - a.ID)[0];
      return { recordset: day ? [day] : [] };
    }

    if (s.includes('FROM dbo.TblNewDay') && s.includes('Status = 1')) {
      const open = [...this.days]
        .filter((d) => d.BranchID === Number(params.branchId) && d.Status)
        .sort((a, b) => b.ID - a.ID)[0];
      return { recordset: open ? [open] : [] };
    }

    if (s.includes('FROM dbo.TblShiftMove sm WITH (UPDLOCK') && s.includes('sm.BusinessDayID = @businessDayId')) {
      const rows = this.shifts.filter(
        (sh) =>
          sh.Status &&
          sh.BranchID === Number(params.branchId) &&
          sh.BusinessDayID === Number(params.businessDayId),
      );
      return { recordset: rows };
    }

    if (s.includes('FROM dbo.TblShiftMove sm WITH (UPDLOCK') && s.includes('sm.Status = 1')) {
      const open = [...this.shifts]
        .filter((sh) => sh.Status && sh.UserID === Number(params.userId))
        .sort((a, b) => b.ID - a.ID)[0];
      return { recordset: open ? [open] : [] };
    }

    if (s.includes('FROM dbo.TblShiftMove sm WITH (UPDLOCK') && s.includes('WHERE sm.ID')) {
      const row = this.shifts.find((sh) => sh.ID === Number(params.id));
      return { recordset: row ? [row] : [] };
    }

    return { recordset: [] };
  }
}

function requestFactory(db: InMemoryOpsDb) {
  const api: {
    params: Record<string, unknown>;
    input: (name: string, _type: unknown, value: unknown) => typeof api;
    query: (sqlText: string) => Promise<{ recordset: unknown[]; rowsAffected?: number[] }>;
  } = {
    params: {},
    input(name, _type, value) {
      api.params[name] = value;
      return api;
    },
    async query(sqlText: string) {
      return db.exec(sqlText, api.params);
    },
  };
  return api;
}

function installDb(db: InMemoryOpsDb) {
  vi.doMock('@/lib/db', () => ({
    getPool: vi.fn(async () => ({
      request: () => requestFactory(db),
    })),
    sql: {
      Int: 'Int',
      Date: 'Date',
      NChar: () => 'NChar',
      NVarChar: () => 'NVarChar',
      Transaction: class {
        begin = () => db.begin();
        commit = () => db.commit();
        rollback = () => db.rollback();
      },
      Request: class {
        constructor() {
          return requestFactory(db);
        }
      },
    },
  }));
}

async function loadReconcile() {
  const { executeReconcileBusinessDay } = await import(
    '@/modules/operations/infra/businessDayMutationTx'
  );
  return executeReconcileBusinessDay;
}

describe('planBusinessDayReconciliation', () => {
  it('NO-OP when current OPEN date matches expected', () => {
    expect(
      planBusinessDayReconciliation({
        openDayDate: '2026-08-25',
        expectedDate: '2026-08-25',
        pastRolloverWindow: true,
      }),
    ).toBe('NO_OP');
  });

  it('does not roll forward before the window', () => {
    expect(
      planBusinessDayReconciliation({
        openDayDate: '2026-08-24',
        expectedDate: '2026-08-25',
        pastRolloverWindow: false,
      }),
    ).toBe('NO_OP');
  });

  it('rolls over a stale day after the window', () => {
    expect(
      planBusinessDayReconciliation({
        openDayDate: '2026-08-21',
        expectedDate: '2026-08-25',
        pastRolloverWindow: true,
      }),
    ).toBe('ROLLED_OVER');
  });

  it('opens the expected day when none is OPEN', () => {
    expect(
      planBusinessDayReconciliation({
        openDayDate: null,
        expectedDate: '2026-08-25',
        pastRolloverWindow: true,
      }),
    ).toBe('OPENED_MISSING_DAY');
  });
});

describe('Phase 2 business day rollover', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.doMock('server-only', () => ({}));
  });

  it('08:00 stale day → rollover to expected date', async () => {
    const db = new InMemoryOpsDb();
    db.seedDay({ BranchID: GLEEM, NewDay: '2026-08-24' });
    installDb(db);
    const reconcile = await loadReconcile();
    const result = await reconcile({ ...CLOCK, branchId: GLEEM, now: AT_EIGHT, trigger: 'SCHEDULED' });
    expect(result.action).toBe('ROLLED_OVER');
    expect(result.previousBusinessDate).toBe('2026-08-24');
    expect(result.currentBusinessDate).toBe('2026-08-25');
    expect(db.openDays(GLEEM)).toHaveLength(1);
    expect(db.openDays(GLEEM)[0].NewDay).toBe('2026-08-25');
  });

  it('correct current day → NO-OP', async () => {
    const db = new InMemoryOpsDb();
    db.seedDay({ BranchID: GLEEM, NewDay: '2026-08-25' });
    installDb(db);
    const reconcile = await loadReconcile();
    const result = await reconcile({ ...CLOCK, branchId: GLEEM, now: AT_EIGHT, trigger: 'SCHEDULED' });
    expect(result.action).toBe('NO_OP');
    expect(db.openDays(GLEEM)[0].NewDay).toBe('2026-08-25');
  });

  it('no OPEN day after rollover → open expected day', async () => {
    const db = new InMemoryOpsDb();
    db.seedDay({ BranchID: GLEEM, NewDay: '2026-08-24', Status: false });
    installDb(db);
    const reconcile = await loadReconcile();
    const result = await reconcile({ ...CLOCK, branchId: GLEEM, now: AT_EIGHT, trigger: 'BEST_EFFORT_CATCH_UP' });
    expect(result.action).toBe('OPENED_MISSING_DAY');
    expect(result.currentBusinessDate).toBe('2026-08-25');
    expect(db.openDays(GLEEM)).toHaveLength(1);
  });

  it('stale day + forgotten shifts → those shifts close then rollover', async () => {
    const db = new InMemoryOpsDb();
    const day = db.seedDay({ BranchID: GLEEM, NewDay: '2026-08-24' });
    db.seedShift({ BranchID: GLEEM, BusinessDayID: day.ID, UserID: 7 });
    installDb(db);
    const reconcile = await loadReconcile();
    const result = await reconcile({ ...CLOCK, branchId: GLEEM, now: AT_EIGHT, trigger: 'SCHEDULED' });
    expect(result.action).toBe('ROLLED_OVER');
    expect(result.closedShiftCount).toBe(1);
    expect(db.shifts.filter((s) => s.Status)).toHaveLength(0);
    expect(db.sqlLog.some((q) => q.includes(AUTO_BUSINESS_DAY_ROLLOVER))).toBe(false);
  });

  it('shift from another BusinessDay is untouched', async () => {
    const db = new InMemoryOpsDb();
    const stale = db.seedDay({ BranchID: GLEEM, NewDay: '2026-08-24' });
    db.seedShift({ BranchID: GLEEM, BusinessDayID: stale.ID, UserID: 7 });
    const leftover = db.seedShift({
      BranchID: GLEEM,
      BusinessDayID: 99,
      NewDay: '2026-08-21',
      UserID: 8,
    });
    leftover.Status = true;
    installDb(db);
    const reconcile = await loadReconcile();
    await reconcile({ ...CLOCK, branchId: GLEEM, now: AT_EIGHT, trigger: 'SCHEDULED' });
    expect(db.shifts.find((s) => s.UserID === 7)?.Status).toBe(false);
    expect(db.shifts.find((s) => s.UserID === 8)?.Status).toBe(true);
  });

  it('rollback if new day opening fails', async () => {
    const db = new InMemoryOpsDb();
    db.seedDay({ BranchID: GLEEM, NewDay: '2026-08-24' });
    db.failNextDayInsert = true;
    installDb(db);
    const reconcile = await loadReconcile();
    await expect(
      reconcile({ ...CLOCK, branchId: GLEEM, now: AT_EIGHT, trigger: 'SCHEDULED' }),
    ).rejects.toThrow(/simulated day insert failure/);
    expect(db.openDays(GLEEM)).toHaveLength(1);
    expect(db.openDays(GLEEM)[0].NewDay).toBe('2026-08-24');
  });

  it('two simultaneous reconcile calls → one OPEN expected day', async () => {
    const db = new InMemoryOpsDb();
    db.seedDay({ BranchID: GLEEM, NewDay: '2026-08-24' });
    installDb(db);
    const reconcile = await loadReconcile();
    const args = { ...CLOCK, branchId: GLEEM, now: AT_EIGHT, trigger: 'SCHEDULED' as const };
    const results = await Promise.allSettled([reconcile(args), reconcile(args)]);
    const fulfilled = results.filter((r) => r.status === 'fulfilled') as PromiseFulfilledResult<{
      action: string;
    }>[];
    expect(fulfilled.length).toBe(2);
    expect(fulfilled.some((r) => r.value.action === 'ROLLED_OVER')).toBe(true);
    expect(db.openDays(GLEEM)).toHaveLength(1);
    expect(db.openDays(GLEEM)[0].NewDay).toBe('2026-08-25');
  });

  it('invoice vs rollover serialization', async () => {
    const db = new InMemoryOpsDb();
    const day = db.seedDay({ BranchID: GLEEM, NewDay: '2026-08-24' });
    const shift = db.seedShift({ BranchID: GLEEM, BusinessDayID: day.ID, UserID: 7 });
    installDb(db);
    const { lockOperationalWrite } = await import('@/modules/operations/infra/businessDayLock');
    const { sql } = await import('@/lib/db');
    const reconcile = await loadReconcile();

    const tx = new sql.Transaction({} as never);
    await tx.begin();
    await lockOperationalWrite(tx, {
      branchId: GLEEM,
      businessDayId: day.ID,
      shiftSessionId: shift.ID,
      requireShift: true,
    });
    await tx.commit();
    const result = await reconcile({ ...CLOCK, branchId: GLEEM, now: AT_EIGHT, trigger: 'SCHEDULED' });
    expect(result.action).toBe('ROLLED_OVER');

    const tx2 = new sql.Transaction({} as never);
    await tx2.begin();
    await expect(
      lockOperationalWrite(tx2, { branchId: GLEEM, businessDayId: day.ID, shiftSessionId: shift.ID }),
    ).rejects.toMatchObject({ code: 'BUSINESS_DAY_CLOSED' });
    await tx2.rollback();
  });

  it('open shift vs rollover serialization', async () => {
    const db = new InMemoryOpsDb();
    db.seedDay({ BranchID: GLEEM, NewDay: '2026-08-24' });
    installDb(db);
    const reconcile = await loadReconcile();
    const { openShift } = await import('@/lib/branch/shiftSession');
    const ctx = {
      userId: 7,
      branchId: GLEEM,
      branchCode: 'GLEEM',
      branchName: 'جليم',
      shortName: 'جليم',
      timeZone: 'Africa/Cairo',
      businessDayCutoffTime: '04:00:00',
      canOperate: true,
      canViewReports: true,
      canSwitch: true,
    };
    const results = await Promise.allSettled([
      reconcile({ ...CLOCK, branchId: GLEEM, now: AT_EIGHT, trigger: 'SCHEDULED' }),
      openShift(ctx, 7, 1),
    ]);
    expect(results.some((r) => r.status === 'fulfilled')).toBe(true);
    const open = db.openDays(GLEEM);
    expect(open).toHaveLength(1);
    if (open[0].NewDay === '2026-08-25') {
      const liveShifts = db.shifts.filter((s) => s.Status);
      expect(liveShifts.every((s) => s.BusinessDayID === open[0].ID)).toBe(true);
    }
  });

  it('multiple missed calendar days converge directly to expected date', async () => {
    const db = new InMemoryOpsDb();
    db.seedDay({ BranchID: GLEEM, NewDay: '2026-08-21' });
    installDb(db);
    const reconcile = await loadReconcile();
    const result = await reconcile({ ...CLOCK, branchId: GLEEM, now: AT_EIGHT, trigger: 'BEST_EFFORT_CATCH_UP' });
    expect(result.action).toBe('ROLLED_OVER');
    expect(result.previousBusinessDate).toBe('2026-08-21');
    expect(result.currentBusinessDate).toBe('2026-08-25');
    expect(db.days.filter((d) => d.NewDay === '2026-08-22' || d.NewDay === '2026-08-23')).toHaveLength(0);
  });

  it('02:00 overnight → no premature rollover', async () => {
    const db = new InMemoryOpsDb();
    db.seedDay({ BranchID: GLEEM, NewDay: '2026-08-24' });
    installDb(db);
    const reconcile = await loadReconcile();
    const result = await reconcile({ ...CLOCK, branchId: GLEEM, now: AT_TWO, trigger: 'SCHEDULED' });
    expect(result.action).toBe('NO_OP');
    expect(db.openDays(GLEEM)[0].NewDay).toBe('2026-08-24');
  });

  it('05:00 after cutoff still does not roll forward before 08:00', async () => {
    const db = new InMemoryOpsDb();
    db.seedDay({ BranchID: GLEEM, NewDay: '2026-08-24' });
    installDb(db);
    const reconcile = await loadReconcile();
    const result = await reconcile({ ...CLOCK, branchId: GLEEM, now: AT_FIVE, trigger: 'SCHEDULED' });
    expect(result.action).toBe('NO_OP');
    expect(db.openDays(GLEEM)[0].NewDay).toBe('2026-08-24');
  });

  it('one branch failure does not fail another branch', async () => {
    const db = new InMemoryOpsDb();
    db.seedDay({ BranchID: GLEEM, NewDay: '2026-08-24' });
    db.seedDay({ BranchID: CAMP, NewDay: '2026-08-24' });
    db.failNextDayInsert = true;
    installDb(db);
    vi.doMock('@/lib/branch/repository', () => ({
      getBranchById: vi.fn(async (id: number) => ({
        branchId: id,
        branchCode: id === GLEEM ? 'GLEEM' : 'CAMP_CAESAR',
        isActive: true,
        timeZone: 'Africa/Cairo',
        businessDayCutoffTime: '04:00:00',
      })),
      listActiveBranches: vi.fn(async () => [
        {
          branchId: GLEEM,
          branchCode: 'GLEEM',
          isActive: true,
          timeZone: 'Africa/Cairo',
          businessDayCutoffTime: '04:00:00',
        },
        {
          branchId: CAMP,
          branchCode: 'CAMP_CAESAR',
          isActive: true,
          timeZone: 'Africa/Cairo',
          businessDayCutoffTime: '04:00:00',
        },
      ]),
    }));
    vi.doMock('@/lib/branch/businessDay', async (importOriginal) => {
      const actual = await importOriginal<typeof import('@/lib/branch/businessDay')>();
      return actual;
    });

    const { reconcileAllBusinessDays } = await import(
      '@/modules/operations/application/reconcileBusinessDay'
    );
    const all = await reconcileAllBusinessDays({ now: AT_EIGHT, trigger: 'SCHEDULED' });
    expect(all.results).toHaveLength(2);
    expect(all.results.some((r) => r.action === 'ROLLED_OVER' || r.action === 'NO_OP')).toBe(true);
    expect(all.results.some((r) => r.action === 'FAILED')).toBe(true);
    expect(all.ok).toBe(false);
  });

  it('rollover-check no longer uses GETDATE business-date logic', () => {
    const src = readFileSync(join(process.cwd(), 'src/app/api/day/rollover-check/route.ts'), 'utf8');
    expect(src).not.toMatch(/GETDATE\s*\(/);
    expect(src).toContain('resolveBusinessDate');
    expect(src).toContain('ensureBusinessDayCurrent');
    expect(src).toContain("mode: 'BEST_EFFORT'");
  });

  it('scheduler at 05:00 UTC in winter Cairo is before 08:00 local → NO-OP', async () => {
    const db = new InMemoryOpsDb();
    db.seedDay({ BranchID: GLEEM, NewDay: '2026-01-14' });
    installDb(db);
    const reconcile = await loadReconcile();
    const winterSevenUtc = new Date('2026-01-15T05:00:00.000Z');
    const result = await reconcile({
      ...CLOCK,
      branchId: GLEEM,
      now: winterSevenUtc,
      trigger: 'SCHEDULED',
    });
    expect(result.action).toBe('NO_OP');
    expect(db.openDays(GLEEM)[0].NewDay).toBe('2026-01-14');
  });

  it('scheduler at 06:00 UTC in winter Cairo is 08:00 local → rollover', async () => {
    const db = new InMemoryOpsDb();
    db.seedDay({ BranchID: GLEEM, NewDay: '2026-01-14' });
    installDb(db);
    const reconcile = await loadReconcile();
    const winterEightUtc = new Date('2026-01-15T06:00:00.000Z');
    const result = await reconcile({
      ...CLOCK,
      branchId: GLEEM,
      now: winterEightUtc,
      trigger: 'SCHEDULED',
    });
    expect(result.action).toBe('ROLLED_OVER');
    expect(db.openDays(GLEEM)[0].NewDay).toBe('2026-01-15');
  });

  it('multiple scheduler invocations are idempotent', async () => {
    const db = new InMemoryOpsDb();
    db.seedDay({ BranchID: GLEEM, NewDay: '2026-08-24' });
    installDb(db);
    const reconcile = await loadReconcile();
    const args = { ...CLOCK, branchId: GLEEM, now: AT_EIGHT, trigger: 'SCHEDULED' as const };
    expect((await reconcile(args)).action).toBe('ROLLED_OVER');
    expect((await reconcile(args)).action).toBe('NO_OP');
    expect((await reconcile(args)).action).toBe('NO_OP');
    expect(db.openDays(GLEEM)).toHaveLength(1);
    expect(db.openDays(GLEEM)[0].NewDay).toBe('2026-08-25');
  });

  it('cron schedule is a check trigger, not a hardcoded 05:00 UTC business time', () => {
    const vercel = JSON.parse(readFileSync(join(process.cwd(), 'vercel.json'), 'utf8')) as {
      crons: Array<{ path: string; schedule: string }>;
    };
    const cron = vercel.crons.find((c) =>
      c.path.includes('/api/internal/operations/business-day/reconcile'),
    );
    expect(cron).toBeTruthy();
    expect(cron?.schedule).not.toBe('0 5 * * *');
    expect(cron?.schedule).toBe('0 * * * *');
  });
});

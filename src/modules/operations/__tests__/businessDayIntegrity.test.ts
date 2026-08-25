import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ActiveBranchContext } from '@/lib/branch/types';
import {
  ONE_OPEN_BUSINESS_DAY_PER_BRANCH,
  BUSINESS_DAY_FORCE_CLOSE,
} from '@/modules/operations/domain/invariants';

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

function ctx(branchId: number, canOperate = true): ActiveBranchContext {
  return {
    userId: 7,
    branchId,
    branchCode: branchId === GLEEM ? 'GLEEM' : 'CAMP_CAESAR',
    branchName: branchId === GLEEM ? 'جليم' : 'كامب شيزار',
    shortName: branchId === GLEEM ? 'جليم' : 'كامب',
    timeZone: 'Africa/Cairo',
    businessDayCutoffTime: '04:00:00',
    canOperate,
    canViewReports: true,
    canSwitch: true,
  };
}

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
      const branchId = Number(params.branchId);
      return { recordset: this.branches.has(branchId) ? [{ BranchID: branchId }] : [] };
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
        throw new Error("Cannot insert duplicate key row in object 'dbo.TblNewDay' with unique index 'UX_TblNewDay_OneOpenPerBranch'");
      }
      const inserted: DayRow = {
        ID: this.nextDayId++,
        BranchID: Number(params.branchId),
        NewDay: params.newDay instanceof Date
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
          sh.EndDate = '2026-08-24';
          sh.EndTime = '11:00:00 AM';
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
      row.EndDate = '2026-08-24';
      row.EndTime = '11:00:00 AM';
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
      const wanted = params.newDay instanceof Date
        ? params.newDay.toISOString().slice(0, 10)
        : String(params.newDay).slice(0, 10);
      const day = [...this.days]
        .filter((d) => d.BranchID === Number(params.branchId) && d.NewDay === wanted)
        .sort((a, b) => b.ID - a.ID)[0];
      return { recordset: day ? [day] : [] };
    }

    if (s.includes('FROM dbo.TblNewDay WITH (UPDLOCK') && s.includes('Status = 1')) {
      const open = [...this.days]
        .filter((d) => d.BranchID === Number(params.branchId) && d.Status)
        .sort((a, b) => b.ID - a.ID)[0];
      return { recordset: open ? [open] : [] };
    }

    if (s.includes('FROM dbo.TblNewDay') && s.includes('WHERE ID =')) {
      const day = this.days.find((d) => d.ID === Number(params.id ?? params.dayId));
      return { recordset: day ? [day] : [] };
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

    if (s.includes('SELECT TOP 1 UserID, BranchID, Status')) {
      const row = this.shifts.find((sh) => sh.ID === Number(params.id));
      return { recordset: row ? [row] : [] };
    }

    if (s.includes('FROM dbo.TblShiftMove sm')) {
      const row = this.shifts.find((sh) => sh.ID === Number(params.id));
      return { recordset: row ? [row] : [] };
    }

    return { recordset: [] };
  }
}

function installDb(db: InMemoryOpsDb, clockDate = '2026-08-24') {
  const requestFactory = () => {
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
  };

  vi.doMock('@/lib/db', () => ({
    getPool: vi.fn(async () => ({})),
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
          return requestFactory();
        }
      },
    },
  }));

  vi.doMock('@/lib/branch/repository', () => ({
    getUserActiveStatus: vi.fn(async () => ({ exists: true, isDeleted: false })),
    getBranchById: vi.fn(async (id: number) =>
      id === GLEEM || id === CAMP
        ? { branchId: id, branchCode: id === GLEEM ? 'GLEEM' : 'CAMP_CAESAR', isActive: true }
        : null,
    ),
  }));

  vi.doMock('@/lib/branch/access', () => ({
    validateUserBranchAccess: vi.fn(async () => ({
      canOperate: true,
      branchId: CAMP,
    })),
  }));

  vi.doMock('@/modules/operations/clock/BusinessClock', async () => {
    const actual = await vi.importActual<typeof import('@/modules/operations/clock/BusinessClock')>(
      '@/modules/operations/clock/BusinessClock',
    );
    return {
      ...actual,
      resolveBusinessDate: vi.fn(() => clockDate),
      now: actual.now,
    };
  });

  vi.doMock('@/modules/operations/application/reconcileBusinessDay', () => ({
    ensureBusinessDayCurrent: vi.fn(async () => ({
      branchId: GLEEM,
      action: 'NO_OP',
      stale: false,
    })),
  }));
}

describe('Phase 1C business day integrity', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.doMock('server-only', () => ({}));
  });

  it('documents one OPEN BusinessDay per branch as an intentional invariant', () => {
    expect(ONE_OPEN_BUSINESS_DAY_PER_BRANCH).toBe(true);
    expect(BUSINESS_DAY_FORCE_CLOSE).toBe('BUSINESS_DAY_FORCE_CLOSE');
  });

  it('two parallel open-day requests → one OPEN day', async () => {
    const db = new InMemoryOpsDb();
    installDb(db);
    const { openBusinessDay } = await import('@/lib/branch/businessDay');
    const results = await Promise.allSettled([
      openBusinessDay(ctx(GLEEM)),
      openBusinessDay(ctx(GLEEM)),
    ]);
    const ok = results.filter((r) => r.status === 'fulfilled');
    expect(ok).toHaveLength(1);
    expect(db.openDays(GLEEM)).toHaveLength(1);
  });

  it('parallel close-day requests are deterministic', async () => {
    const db = new InMemoryOpsDb();
    db.seedDay({ BranchID: GLEEM });
    installDb(db);
    const { closeBusinessDay } = await import('@/lib/branch/businessDay');
    const results = await Promise.allSettled([
      closeBusinessDay(ctx(GLEEM)),
      closeBusinessDay(ctx(GLEEM)),
    ]);
    const ok = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(ok).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(db.openDays(GLEEM)).toHaveLength(0);
  });

  it('close day with open shifts is rejected', async () => {
    const db = new InMemoryOpsDb();
    const day = db.seedDay({ BranchID: GLEEM });
    db.seedShift({ BranchID: GLEEM, BusinessDayID: day.ID, UserID: 7 });
    installDb(db);
    const { closeBusinessDay } = await import('@/lib/branch/businessDay');
    await expect(closeBusinessDay(ctx(GLEEM))).rejects.toMatchObject({
      code: 'OPEN_SHIFTS',
    });
    expect(db.openDays(GLEEM)).toHaveLength(1);
    expect(db.shifts.filter((s) => s.Status)).toHaveLength(1);
  });

  it('force close closes only shifts belonging to that BusinessDay', async () => {
    const db = new InMemoryOpsDb();
    const gleemDay = db.seedDay({ BranchID: GLEEM, ID: 10 });
    const leftover = db.seedShift({
      BranchID: GLEEM,
      BusinessDayID: 99,
      NewDay: '2026-08-23',
      UserID: 8,
    });
    leftover.Status = true;
    leftover.BranchID = GLEEM;
    db.seedShift({ BranchID: GLEEM, BusinessDayID: gleemDay.ID, UserID: 7 });
    installDb(db);

    const { closeBusinessDay } = await import('@/lib/branch/businessDay');
    const closed = await closeBusinessDay(ctx(GLEEM), { forceCloseShifts: true });
    expect(closed.closedShifts).toBe(1);
    expect(db.shifts.find((s) => s.UserID === 7)?.Status).toBe(false);
    expect(db.shifts.find((s) => s.UserID === 8)?.Status).toBe(true);
    expect(db.sqlLog.some((q) => q.includes(BUSINESS_DAY_FORCE_CLOSE))).toBe(false);
  });

  it('open shift while day closes → only one operation wins safely', async () => {
    const db = new InMemoryOpsDb();
    db.seedDay({ BranchID: GLEEM });
    installDb(db);
    const { closeBusinessDay } = await import('@/lib/branch/businessDay');
    const { openShift } = await import('@/lib/branch/shiftSession');
    const results = await Promise.allSettled([
      closeBusinessDay(ctx(GLEEM)),
      openShift(ctx(GLEEM), 7, 1),
    ]);
    const dayOpen = db.openDays(GLEEM).length;
    const shiftsOpen = db.shifts.filter((s) => s.Status).length;
    expect(results.some((r) => r.status === 'fulfilled')).toBe(true);
    if (dayOpen === 0) {
      expect(shiftsOpen).toBe(0);
    } else {
      expect(dayOpen).toBe(1);
      expect(shiftsOpen).toBe(1);
    }
  });

  it('handoff while target day closes → no shift on closed day', async () => {
    const db = new InMemoryOpsDb();
    const gleem = db.seedDay({ BranchID: GLEEM, ID: 10 });
    db.seedDay({ BranchID: CAMP, ID: 20 });
    db.seedShift({ BranchID: GLEEM, BusinessDayID: gleem.ID, UserID: 7 });
    installDb(db);

    const { closeBusinessDay } = await import('@/lib/branch/businessDay');
    const { handoffShift } = await import('@/lib/branch/shiftSession');
    await closeBusinessDay(ctx(CAMP));
    await expect(
      handoffShift({ userId: 7, targetBranchId: CAMP, shiftId: 1 }),
    ).rejects.toMatchObject({ name: 'BranchDomainError' });
    expect(db.shifts.filter((s) => s.BranchID === CAMP && s.Status)).toHaveLength(0);
    expect(db.shifts.filter((s) => s.BranchID === GLEEM && s.Status)).toHaveLength(1);
  });

  it('sale commits first → close waits then succeeds', async () => {
    const db = new InMemoryOpsDb();
    const day = db.seedDay({ BranchID: GLEEM });
    const shift = db.seedShift({ BranchID: GLEEM, BusinessDayID: day.ID, UserID: 7 });
    installDb(db);
    const { lockOperationalWrite } = await import('@/modules/operations/infra/businessDayLock');
    const { closeBusinessDay } = await import('@/lib/branch/businessDay');
    const { sql } = await import('@/lib/db');

    const tx = new sql.Transaction({} as never);
    await tx.begin();
    await lockOperationalWrite(tx, {
      branchId: GLEEM,
      businessDayId: day.ID,
      shiftSessionId: shift.ID,
      requireShift: true,
    });
    await tx.commit();
    await closeBusinessDay(ctx(GLEEM), { forceCloseShifts: true });
    expect(db.openDays(GLEEM)).toHaveLength(0);
  });

  it('close commits first → sale rejected with BUSINESS_DAY_CLOSED', async () => {
    const db = new InMemoryOpsDb();
    const day = db.seedDay({ BranchID: GLEEM });
    const shift = db.seedShift({ BranchID: GLEEM, BusinessDayID: day.ID, UserID: 7 });
    installDb(db);
    const { closeBusinessDay } = await import('@/lib/branch/businessDay');
    await closeBusinessDay(ctx(GLEEM), { forceCloseShifts: true });

    const { lockOperationalWrite } = await import('@/modules/operations/infra/businessDayLock');
    const { sql } = await import('@/lib/db');
    const tx = new sql.Transaction({} as never);
    await tx.begin();
    await expect(
      lockOperationalWrite(tx, {
        branchId: GLEEM,
        businessDayId: day.ID,
        shiftSessionId: shift.ID,
        requireShift: true,
      }),
    ).rejects.toMatchObject({ code: 'BUSINESS_DAY_CLOSED' });
    await tx.rollback();
  });

  it('expense/income lock helper rejects a closed BusinessDay', async () => {
    const db = new InMemoryOpsDb();
    const day = db.seedDay({ BranchID: GLEEM, Status: false });
    installDb(db);
    const { lockOperationalWrite } = await import('@/modules/operations/infra/businessDayLock');
    const { sql } = await import('@/lib/db');
    const tx = new sql.Transaction({} as never);
    await tx.begin();
    await expect(
      lockOperationalWrite(tx, { branchId: GLEEM, businessDayId: day.ID }),
    ).rejects.toMatchObject({ code: 'BUSINESS_DAY_CLOSED' });
    await tx.rollback();
  });

  it('close-and-open succeeds atomically', async () => {
    const db = new InMemoryOpsDb();
    db.seedDay({ BranchID: GLEEM, NewDay: '2026-08-23' });
    installDb(db, '2026-08-24');
    const { closeAndOpenBusinessDay } = await import('@/lib/branch/businessDay');
    const result = await closeAndOpenBusinessDay(ctx(GLEEM));
    expect(result.closedDay.status).toBe(false);
    expect(result.openedDay.status).toBe(true);
    expect(result.openedDay.newDay).toBe('2026-08-24');
    expect(db.openDays(GLEEM)).toHaveLength(1);
    expect(db.openDays(GLEEM)[0].NewDay).toBe('2026-08-24');
  });

  it('close succeeds + next open fails → entire command rolls back', async () => {
    const db = new InMemoryOpsDb();
    db.seedDay({ BranchID: GLEEM, NewDay: '2026-08-23' });
    db.failNextDayInsert = true;
    installDb(db, '2026-08-24');
    const { closeAndOpenBusinessDay } = await import('@/lib/branch/businessDay');
    await expect(closeAndOpenBusinessDay(ctx(GLEEM))).rejects.toThrow(/simulated day insert failure/);
    expect(db.openDays(GLEEM)).toHaveLength(1);
    expect(db.openDays(GLEEM)[0].NewDay).toBe('2026-08-23');
  });

  it('BusinessDay BranchID mismatch is rejected', async () => {
    const db = new InMemoryOpsDb();
    const day = db.seedDay({ BranchID: CAMP, ID: 20 });
    installDb(db);
    const { lockOpenBusinessDay } = await import('@/modules/operations/infra/businessDayLock');
    const { sql } = await import('@/lib/db');
    const tx = new sql.Transaction({} as never);
    await tx.begin();
    await expect(
      lockOpenBusinessDay(tx, { branchId: GLEEM, businessDayId: day.ID }),
    ).rejects.toMatchObject({ code: 'OPERATIONAL_OWNERSHIP_MISMATCH' });
    await tx.rollback();
  });

  it('BusinessClock is used for the next business date', async () => {
    const db = new InMemoryOpsDb();
    db.seedDay({ BranchID: GLEEM, NewDay: '2026-08-23' });
    installDb(db, '2026-08-26');
    const { closeAndOpenBusinessDay, getBranchBusinessDate } = await import(
      '@/lib/branch/businessDay'
    );
    const { resolveBusinessDate } = await import('@/modules/operations/clock/BusinessClock');
    const result = await closeAndOpenBusinessDay(ctx(GLEEM));
    expect(result.openedDay.newDay).toBe('2026-08-26');
    expect(result.openedDay.newDay).toBe(resolveBusinessDate(ctx(GLEEM)));
    expect(getBranchBusinessDate(ctx(GLEEM))).toBe('2026-08-26');
  });

  it('open already-open day is rejected deterministically', async () => {
    const db = new InMemoryOpsDb();
    db.seedDay({ BranchID: GLEEM, NewDay: '2026-08-24' });
    installDb(db);
    const { openBusinessDay } = await import('@/lib/branch/businessDay');
    await expect(openBusinessDay(ctx(GLEEM))).rejects.toMatchObject({
      code: 'ALREADY_OPEN_BUSINESS_DAY',
    });
  });

  it('close already-closed day is rejected deterministically', async () => {
    const db = new InMemoryOpsDb();
    db.seedDay({ BranchID: GLEEM, Status: false });
    installDb(db);
    const { closeBusinessDay } = await import('@/lib/branch/businessDay');
    await expect(closeBusinessDay(ctx(GLEEM))).rejects.toMatchObject({
      code: 'BUSINESS_DAY_ALREADY_CLOSED',
    });
  });

  it('close-and-open repeated request leaves exactly one OPEN day', async () => {
    const db = new InMemoryOpsDb();
    db.seedDay({ BranchID: GLEEM, NewDay: '2026-08-23' });
    installDb(db, '2026-08-24');
    const { closeAndOpenBusinessDay } = await import('@/lib/branch/businessDay');
    await closeAndOpenBusinessDay(ctx(GLEEM));
    const second = await closeAndOpenBusinessDay(ctx(GLEEM));
    expect(second.openedDay.status).toBe(true);
    expect(db.openDays(GLEEM)).toHaveLength(1);
    expect(db.openDays(GLEEM)[0].NewDay).toBe('2026-08-24');
  });
});

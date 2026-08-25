import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ActiveBranchContext } from '@/lib/branch/types';
import { ONE_OPEN_SHIFT_PER_USER } from '@/modules/operations/domain/invariants';

vi.mock('server-only', () => ({}));

type DayRow = {
  ID: number;
  BranchID: number;
  NewDay: string;
  Status: boolean;
};

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
  UserName?: string | null;
  ShiftName?: string | null;
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

class InMemoryShiftDb {
  users = new Set<number>([7]);
  days: DayRow[] = [];
  shifts: ShiftRow[] = [];
  nextShiftId = 1;
  sqlLog: string[] = [];
  failNextInsert = false;
  private chain = Promise.resolve();
  private snapshot: { days: DayRow[]; shifts: ShiftRow[]; nextShiftId: number } | null = null;

  seedOpenDay(branchId: number, id: number, newDay = '2026-08-24', status = true) {
    this.days = this.days.filter((d) => d.ID !== id);
    this.days.push({ ID: id, BranchID: branchId, NewDay: newDay, Status: status });
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
      UserName: row.UserName ?? 'saad',
      ShiftName: row.ShiftName ?? 'صباحي',
    };
    this.shifts.push(shift);
    this.nextShiftId = Math.max(this.nextShiftId, shift.ID + 1);
    return shift;
  }

  openShiftsFor(userId: number) {
    return this.shifts.filter((s) => s.UserID === userId && s.Status);
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
      this.nextShiftId = this.snapshot.nextShiftId;
      this.snapshot = null;
    }
    (this as unknown as { _release?: () => void })._release?.();
  }

  exec(sqlText: string, params: Record<string, unknown>) {
    this.sqlLog.push(sqlText.replace(/\s+/g, ' ').trim());
    const s = sqlText;

    if (s.includes('FROM dbo.TblUser')) {
      const userId = Number(params.userId);
      return { recordset: this.users.has(userId) ? [{ UserID: userId }] : [] };
    }

    if (s.includes('FROM dbo.TblBranch')) {
      const branchId = Number(params.branchId);
      return { recordset: [{ BranchID: branchId }] };
    }

    if (s.includes('UPDATE dbo.TblShiftMove')) {
      const id = Number(params.id);
      const branchId = Number(params.branchId);
      const row = this.shifts.find((sh) => sh.ID === id && sh.BranchID === branchId && sh.Status);
      if (!row) return { recordset: [], rowsAffected: [0] };
      row.Status = false;
      row.EndDate = String(params.endDate ?? '2026-08-24').slice(0, 10);
      row.EndTime = String(params.endTime ?? '11:00:00 AM');
      return { recordset: [], rowsAffected: [1] };
    }

    if (s.includes('INSERT INTO dbo.TblShiftMove')) {
      if (this.failNextInsert) {
        this.failNextInsert = false;
        throw new Error('simulated insert failure');
      }
      const asDay = (v: unknown) => {
        if (v instanceof Date) return v.toISOString().slice(0, 10);
        return String(v ?? '').slice(0, 10);
      };
      const openForUser = this.shifts.filter(
        (sh) => sh.UserID === Number(params.userID) && sh.Status,
      );
      if (openForUser.length > 0) {
        throw new Error(
          "Cannot insert duplicate key row in object 'dbo.TblShiftMove' with unique index 'UX_TblShiftMove_OneOpenPerUser'",
        );
      }
      const inserted: ShiftRow = {
        ID: this.nextShiftId++,
        BranchID: Number(params.branchId),
        BusinessDayID: Number(params.businessDayId),
        NewDay: asDay(params.newDay),
        UserID: Number(params.userID),
        ShiftID: Number(params.shiftID),
        StartDate: asDay(params.startDate),
        StartTime: String(params.startTime ?? '10:00 AM'),
        EndDate: null,
        EndTime: null,
        Status: true,
      };
      this.shifts.push(inserted);
      return { recordset: [inserted] };
    }

    if (s.includes('FROM dbo.TblNewDay WITH (UPDLOCK')) {
      const branchId = Number(params.branchId);
      const open = [...this.days]
        .filter((d) => d.BranchID === branchId && d.Status)
        .sort((a, b) => b.ID - a.ID)[0];
      return { recordset: open ? [open] : [] };
    }

    if (s.includes('FROM dbo.TblNewDay')) {
      const dayId = Number(params.dayId);
      const day = this.days.find((d) => d.ID === dayId);
      return { recordset: day ? [day] : [] };
    }

    if (s.includes('FROM dbo.TblShiftMove sm WITH (UPDLOCK') && s.includes('sm.Status = 1')) {
      const userId = Number(params.userId);
      const open = [...this.shifts]
        .filter((sh) => sh.Status && sh.UserID === userId)
        .sort((a, b) => b.ID - a.ID)[0];
      return { recordset: open ? [open] : [] };
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

function installDb(db: InMemoryShiftDb, access?: { canOperate?: boolean }) {
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
      canOperate: access?.canOperate !== false,
      branchId: CAMP,
    })),
  }));
  vi.doMock('@/modules/operations/application/reconcileBusinessDay', () => ({
    ensureBusinessDayCurrent: vi.fn(async () => ({ branchId: 1, action: 'NO_OP', stale: false })),
  }));
}

describe('Phase 1B shift integrity & atomic handoff', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.doMock('server-only', () => ({}));
  });

  it('documents one OPEN shift per user as an intentional invariant', () => {
    expect(ONE_OPEN_SHIFT_PER_USER).toBe(true);
  });

  it('opens the first shift successfully', async () => {
    const db = new InMemoryShiftDb();
    db.seedOpenDay(GLEEM, 10);
    installDb(db);

    const { openShift } = await import('@/lib/branch/shiftSession');
    const opened = await openShift(ctx(GLEEM), 7, 1);
    expect(opened.status).toBe(true);
    expect(opened.branchId).toBe(GLEEM);
    expect(opened.businessDayId).toBe(10);
    expect(db.openShiftsFor(7)).toHaveLength(1);
  });

  it('rejects opening a second shift on the same branch', async () => {
    const db = new InMemoryShiftDb();
    db.seedOpenDay(GLEEM, 10);
    db.seedShift({ BranchID: GLEEM, BusinessDayID: 10, UserID: 7 });
    installDb(db);

    const { openShift } = await import('@/lib/branch/shiftSession');
    await expect(openShift(ctx(GLEEM), 7, 1)).rejects.toMatchObject({
      name: 'BranchDomainError',
      code: 'ALREADY_OPEN_SHIFT',
    });
    expect(db.openShiftsFor(7)).toHaveLength(1);
    expect(db.sqlLog.some((q) => q.includes('INSERT INTO dbo.TblShiftMove'))).toBe(false);
  });

  it('handoff GLEEM → CAMP succeeds and leaves only the CAMP shift OPEN', async () => {
    const db = new InMemoryShiftDb();
    db.seedOpenDay(GLEEM, 10);
    db.seedOpenDay(CAMP, 20);
    const old = db.seedShift({ BranchID: GLEEM, BusinessDayID: 10, UserID: 7 });
    installDb(db);

    const { handoffShift } = await import('@/lib/branch/shiftSession');
    const opened = await handoffShift({ userId: 7, targetBranchId: CAMP, shiftId: 2 });
    expect(opened.branchId).toBe(CAMP);
    expect(opened.businessDayId).toBe(20);
    expect(opened.shiftId).toBe(2);
    expect(db.openShiftsFor(7)).toHaveLength(1);
    expect(db.openShiftsFor(7)[0].BranchID).toBe(CAMP);
    expect(db.shifts.find((s) => s.ID === old.ID)?.Status).toBe(false);
  });

  it('handoff closes old + opens new atomically (target day locked before close)', async () => {
    const db = new InMemoryShiftDb();
    db.seedOpenDay(GLEEM, 10);
    db.seedOpenDay(CAMP, 20);
    db.seedShift({ BranchID: GLEEM, BusinessDayID: 10, UserID: 7 });
    installDb(db);

    const { openShift } = await import('@/lib/branch/shiftSession');
    await openShift(ctx(CAMP), 7, 1);

    const lockDay = db.sqlLog.findIndex((q) => q.includes('FROM dbo.TblNewDay WITH (UPDLOCK'));
    const closeOld = db.sqlLog.findIndex((q) => q.includes('UPDATE dbo.TblShiftMove'));
    const insertNew = db.sqlLog.findIndex((q) => q.includes('INSERT INTO dbo.TblShiftMove'));
    expect(lockDay).toBeGreaterThanOrEqual(0);
    expect(closeOld).toBeGreaterThan(lockDay);
    expect(insertNew).toBeGreaterThan(closeOld);
    expect(db.openShiftsFor(7)).toHaveLength(1);
  });

  it('target branch has no open day → old shift remains OPEN', async () => {
    const db = new InMemoryShiftDb();
    db.seedOpenDay(GLEEM, 10);
    db.seedShift({ BranchID: GLEEM, BusinessDayID: 10, UserID: 7 });
    installDb(db);

    const { handoffShift } = await import('@/lib/branch/shiftSession');
    await expect(
      handoffShift({ userId: 7, targetBranchId: CAMP, shiftId: 1 }),
    ).rejects.toMatchObject({ code: 'NO_OPEN_DAY' });
    expect(db.openShiftsFor(7)).toHaveLength(1);
    expect(db.openShiftsFor(7)[0].BranchID).toBe(GLEEM);
    expect(db.sqlLog.some((q) => q.includes('UPDATE dbo.TblShiftMove'))).toBe(false);
    expect(db.sqlLog.some((q) => q.includes('INSERT INTO dbo.TblShiftMove'))).toBe(false);
  });

  it('target branch unauthorized → old shift remains OPEN', async () => {
    const db = new InMemoryShiftDb();
    db.seedOpenDay(GLEEM, 10);
    db.seedOpenDay(CAMP, 20);
    db.seedShift({ BranchID: GLEEM, BusinessDayID: 10, UserID: 7 });
    installDb(db, { canOperate: false });

    const { handoffShift } = await import('@/lib/branch/shiftSession');
    await expect(
      handoffShift({ userId: 7, targetBranchId: CAMP, shiftId: 1 }),
    ).rejects.toMatchObject({ code: 'OPERATION_NOT_ALLOWED' });
    expect(db.openShiftsFor(7)).toHaveLength(1);
    expect(db.openShiftsFor(7)[0].BranchID).toBe(GLEEM);
    expect(db.sqlLog).toHaveLength(0);
  });

  it('target BusinessDay closes during handoff → no new shift created', async () => {
    const db = new InMemoryShiftDb();
    db.seedOpenDay(GLEEM, 10);
    db.seedOpenDay(CAMP, 20, '2026-08-24', false);
    db.seedShift({ BranchID: GLEEM, BusinessDayID: 10, UserID: 7 });
    installDb(db);

    const { handoffShift } = await import('@/lib/branch/shiftSession');
    await expect(
      handoffShift({ userId: 7, targetBranchId: CAMP, shiftId: 1 }),
    ).rejects.toMatchObject({
      name: 'BranchDomainError',
      code: 'NO_OPEN_DAY',
    });
    expect(db.openShiftsFor(7)).toHaveLength(1);
    expect(db.openShiftsFor(7)[0].BranchID).toBe(GLEEM);
    expect(db.shifts.filter((s) => s.BranchID === CAMP)).toHaveLength(0);
  });

  it('parallel open requests → only one OPEN shift', async () => {
    const db = new InMemoryShiftDb();
    db.seedOpenDay(GLEEM, 10);
    installDb(db);

    const { openShift } = await import('@/lib/branch/shiftSession');
    const results = await Promise.allSettled([
      openShift(ctx(GLEEM), 7, 1),
      openShift(ctx(GLEEM), 7, 1),
    ]);
    const ok = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(ok).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(db.openShiftsFor(7)).toHaveLength(1);
  });

  it('parallel handoffs → only one final OPEN shift', async () => {
    const db = new InMemoryShiftDb();
    db.seedOpenDay(GLEEM, 10);
    db.seedOpenDay(CAMP, 20);
    db.seedShift({ BranchID: GLEEM, BusinessDayID: 10, UserID: 7 });
    installDb(db);

    const { handoffShift } = await import('@/lib/branch/shiftSession');
    const results = await Promise.allSettled([
      handoffShift({ userId: 7, targetBranchId: CAMP, shiftId: 1 }),
      handoffShift({ userId: 7, targetBranchId: CAMP, shiftId: 2 }),
    ]);
    const ok = results.filter((r) => r.status === 'fulfilled');
    expect(ok).toHaveLength(1);
    expect(db.openShiftsFor(7)).toHaveLength(1);
    expect(db.openShiftsFor(7)[0].BranchID).toBe(CAMP);
  });

  it('close same shift twice is deterministic', async () => {
    const db = new InMemoryShiftDb();
    db.seedOpenDay(GLEEM, 10);
    const shift = db.seedShift({ BranchID: GLEEM, BusinessDayID: 10, UserID: 7 });
    installDb(db);

    const { closeShift } = await import('@/lib/branch/shiftSession');
    const closed = await closeShift(ctx(GLEEM), shift.ID);
    expect(closed.status).toBe(false);
    await expect(closeShift(ctx(GLEEM), shift.ID)).rejects.toMatchObject({
      code: 'SHIFT_ALREADY_CLOSED',
      message: 'هذه الوردية مغلقة بالفعل',
    });
    expect(db.openShiftsFor(7)).toHaveLength(0);
  });

  it('unknown shift is not found', async () => {
    const db = new InMemoryShiftDb();
    db.seedOpenDay(GLEEM, 10);
    installDb(db);

    const { closeShift } = await import('@/lib/branch/shiftSession');
    await expect(closeShift(ctx(GLEEM), 999)).rejects.toMatchObject({
      code: 'SHIFT_NOT_FOUND',
    });
  });

  it('corrupt BranchID / BusinessDayID relationship is rejected', async () => {
    const db = new InMemoryShiftDb();
    db.seedOpenDay(GLEEM, 10);
    db.seedOpenDay(CAMP, 20);
    db.seedShift({
      BranchID: GLEEM,
      BusinessDayID: 20,
      NewDay: '2026-08-24',
      UserID: 7,
    });
    installDb(db);

    const { openShift, handoffShift } = await import('@/lib/branch/shiftSession');
    await expect(openShift(ctx(CAMP), 7, 1)).rejects.toMatchObject({
      name: 'BranchDomainError',
    });
    await expect(handoffShift({ userId: 7, targetBranchId: CAMP, shiftId: 1 })).rejects.toMatchObject({
      name: 'BranchDomainError',
    });
    expect(db.openShiftsFor(7)).toHaveLength(1);
    expect(db.openShiftsFor(7)[0].BranchID).toBe(GLEEM);
  });

  it('failed insert after close rolls back so the old shift stays OPEN', async () => {
    const db = new InMemoryShiftDb();
    db.seedOpenDay(GLEEM, 10);
    db.seedOpenDay(CAMP, 20);
    db.seedShift({ BranchID: GLEEM, BusinessDayID: 10, UserID: 7 });
    db.failNextInsert = true;
    installDb(db);

    const { handoffShift } = await import('@/lib/branch/shiftSession');
    await expect(
      handoffShift({ userId: 7, targetBranchId: CAMP, shiftId: 1 }),
    ).rejects.toThrow(/simulated insert failure/);
    expect(db.openShiftsFor(7)).toHaveLength(1);
    expect(db.openShiftsFor(7)[0].BranchID).toBe(GLEEM);
  });

  it('cannot open a shift against a closed BusinessDay', async () => {
    const db = new InMemoryShiftDb();
    db.seedOpenDay(GLEEM, 10, '2026-08-24', false);
    installDb(db);

    const { openShift } = await import('@/lib/branch/shiftSession');
    await expect(openShift(ctx(GLEEM), 7, 1)).rejects.toMatchObject({
      code: 'NO_OPEN_DAY',
    });
    expect(db.openShiftsFor(7)).toHaveLength(0);
  });
});

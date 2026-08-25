import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { OperationalBootstrapSnapshot } from '@/modules/operations/infra/operationalBootstrapRepository';

vi.mock('server-only', () => ({}));

const NOW = new Date('2026-08-25T12:00:00+03:00');

const SESSION_USER = {
  UserID: 7,
  UserName: 'saad',
  UserLevel: 'admin' as const,
  ActiveBranchID: 1,
  ActiveBranchCode: 'GLEEM',
  BranchSessionVersion: 1 as const,
};

function accessRow(branchId: number, code: string, name: string) {
  return {
    branchId,
    branchCode: code,
    branchName: name,
    shortName: name,
    isDefault: branchId === 1,
    canOperate: true,
    canViewReports: true,
    canSwitch: true,
    isActive: true,
    validFrom: new Date('2020-01-01'),
    validTo: null,
    branchIsActive: true,
    timeZone: 'Africa/Cairo',
    businessDayCutoffTime: '04:00:00',
  };
}

function baseSnapshot(overrides: Partial<OperationalBootstrapSnapshot> = {}): OperationalBootstrapSnapshot {
  return {
    user: {
      userId: 7,
      userName: 'saad',
      userLevel: 'admin',
      defaultShiftId: 1,
      isDeleted: false,
    },
    activeBranch: {
      branchId: 1,
      branchCode: 'GLEEM',
      branchName: 'جليم',
      shortName: 'جليم',
      timeZone: 'Africa/Cairo',
      businessDayCutoffTime: '04:00:00',
      branchIsActive: true,
      canOperate: true,
      canViewReports: true,
      canSwitch: true,
      accessIsActive: true,
      validFrom: new Date('2020-01-01'),
      validTo: null,
    },
    accessRows: [
      accessRow(1, 'GLEEM', 'جليم'),
      accessRow(2, 'CAMP_CAESAR', 'كامب شيزار'),
    ],
    openDay: {
      id: 10,
      branchId: 1,
      newDay: '2026-08-25',
      status: true,
    },
    userOpenShift: {
      id: 100,
      branchId: 1,
      businessDayId: 10,
      newDay: '2026-08-25',
      userId: 7,
      shiftId: 1,
      startDate: '2026-08-25',
      startTime: '10:00 AM',
      endDate: null,
      endTime: null,
      status: true,
      userName: 'saad',
      shiftName: 'صباحي',
    },
    openShiftCount: 1,
    roles: ['admin'],
    rolePages: [],
    allAccessPages: [{ pageKey: 'pos', pagePath: '/income/pos' }],
    allPages: [{ pageKey: 'pos', pagePath: '/income/pos' }],
    ...overrides,
  };
}

async function loadWithMocks(opts?: {
  session?: typeof SESSION_USER | null;
  verify?: { ok: true } | { ok: false; reason: string };
  snapshot?: OperationalBootstrapSnapshot | (() => OperationalBootstrapSnapshot);
  snapshotImpl?: () => Promise<OperationalBootstrapSnapshot>;
  ensure?: Record<string, unknown>;
}) {
  const loadOperationalBootstrapSnapshot = vi.fn(
    opts?.snapshotImpl ??
      (async () =>
        typeof opts?.snapshot === 'function' ? opts.snapshot() : (opts?.snapshot ?? baseSnapshot())),
  );
  const ensureBusinessDayCurrent = vi.fn(async () => opts?.ensure ?? { action: 'NO_OP', stale: false });
  const destroySession = vi.fn(async () => undefined);

  vi.doMock('@/lib/session', () => ({
    destroySession,
    getSession: vi.fn(async () => opts?.session ?? SESSION_USER),
    verifySessionCookie: vi.fn(async () => opts?.verify ?? { ok: true }),
    readSessionCookie: vi.fn(async () => 'cookie'),
  }));
  vi.doMock('@/lib/branch/repository', () => ({
    branchNow: () => NOW,
    isValidUserBranchAccess: () => true,
  }));
  vi.doMock('@/modules/operations/infra/operationalBootstrapRepository', () => ({
    loadOperationalBootstrapSnapshot,
  }));
  vi.doMock('@/modules/operations/application/reconcileBusinessDay', () => ({
    ensureBusinessDayCurrent,
  }));

  const { loadOperationalBootstrap } = await import(
    '@/modules/operations/application/loadOperationalBootstrap'
  );
  return { loadOperationalBootstrap, loadOperationalBootstrapSnapshot, ensureBusinessDayCurrent, destroySession };
}

describe('loadOperationalBootstrap', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.doMock('server-only', () => ({}));
  });

  it('returns compact state for an authenticated user', async () => {
    const { loadOperationalBootstrap, loadOperationalBootstrapSnapshot } = await loadWithMocks();
    const result = await loadOperationalBootstrap({ user: SESSION_USER });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.user.userId).toBe(7);
    expect(result.data.view.branch.branchCode).toBe('GLEEM');
    expect(result.data.activeBranch.branchCode).toBe('GLEEM');
    expect(result.data.operational.branch?.branchCode).toBe('GLEEM');
    expect(result.data.operational.businessDay?.id).toBe(10);
    expect(result.data.operational.shift?.id).toBe(100);
    expect(result.data.activeBranchState.openShiftCount).toBe(1);
    expect(result.data.revision).toBe('1:1:10:1:100:1:0');
    expect(result.data.dbRoundTrips).toBe(1);
    expect(loadOperationalBootstrapSnapshot).toHaveBeenCalledTimes(1);
    expect(loadOperationalBootstrapSnapshot).toHaveBeenCalledWith({ userId: 7, branchId: 1 });
  });

  it('returns all accessible branches for a multi-branch user', async () => {
    const { loadOperationalBootstrap } = await loadWithMocks();
    const result = await loadOperationalBootstrap({ user: SESSION_USER });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.branches).toHaveLength(2);
    expect(result.data.branches.map((b) => b.branchCode).sort()).toEqual(['CAMP_CAESAR', 'GLEEM']);
    expect(result.data.branches.find((b) => b.branchCode === 'GLEEM')?.isCurrent).toBe(true);
  });

  it('returns OPEN day and OPEN shift on the active branch', async () => {
    const { loadOperationalBootstrap } = await loadWithMocks();
    const result = await loadOperationalBootstrap({ user: SESSION_USER });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.view.branch.branchCode).toBe('GLEEM');
    expect(result.data.operational.branch?.branchCode).toBe('GLEEM');
    expect(result.data.operational.businessDay?.status).toBe(true);
    expect(result.data.operational.shift?.branchId).toBe(1);
    expect(result.data.operational.shiftOnOtherBranch).toBeNull();
  });

  it('exposes a user OPEN shift on another branch as operational, not as a view-branch error', async () => {
    const { loadOperationalBootstrap } = await loadWithMocks({
      snapshot: baseSnapshot({
        userOpenShift: {
          id: 200,
          branchId: 2,
          businessDayId: 20,
          newDay: '2026-08-25',
          userId: 7,
          shiftId: 1,
          startDate: '2026-08-25',
          startTime: '10:00 AM',
          endDate: null,
          endTime: null,
          status: true,
          userName: 'saad',
          shiftName: 'صباحي',
        },
      }),
    });
    const result = await loadOperationalBootstrap({ user: SESSION_USER });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.view.branch.branchCode).toBe('GLEEM');
    expect(result.data.activeBranch.branchCode).toBe('GLEEM');
    expect(result.data.operational.branch?.branchCode).toBe('CAMP_CAESAR');
    expect(result.data.operational.shift?.id).toBe(200);
    expect(result.data.operational.shift?.branchId).toBe(2);
    expect(result.data.operational.businessDay?.id).toBe(20);
    expect(result.data.view.businessDay?.id).toBe(10);
    expect(result.data.operational.shiftOnOtherBranch?.id).toBe(200);
    expect(result.data.revision).toBe('1:2:10:1:200:1:0');
  });

  it('returns null businessDay when the active branch has no OPEN day', async () => {
    const { loadOperationalBootstrap, ensureBusinessDayCurrent } = await loadWithMocks({
      snapshot: baseSnapshot({ openDay: null, userOpenShift: null, openShiftCount: 0 }),
    });
    const result = await loadOperationalBootstrap({ user: SESSION_USER });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.operational.businessDay).toBeNull();
    expect(result.data.view.businessDay).toBeNull();
    expect(result.data.operational.branch).toBeNull();
    expect(result.data.activeBranchState.openShiftCount).toBe(0);
    expect(ensureBusinessDayCurrent).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ mode: 'BEST_EFFORT' }),
    );
  });

  it('returns null shift when the user has no OPEN shift', async () => {
    const { loadOperationalBootstrap } = await loadWithMocks({
      snapshot: baseSnapshot({ userOpenShift: null, openShiftCount: 0 }),
    });
    const result = await loadOperationalBootstrap({ user: SESSION_USER });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.operational.shift).toBeNull();
    expect(result.data.operational.branch).toBeNull();
    expect(result.data.operational.businessDay).toBeNull();
    expect(result.data.view.businessDay?.id).toBe(10);
    expect(result.data.operational.shiftOnOtherBranch).toBeNull();
  });

  it('returns stale state when BEST_EFFORT rollover fails', async () => {
    const { loadOperationalBootstrap, loadOperationalBootstrapSnapshot, ensureBusinessDayCurrent } =
      await loadWithMocks({
        snapshot: baseSnapshot({
          openDay: { id: 9, branchId: 1, newDay: '2026-08-24', status: true },
        }),
        ensure: {
          action: 'FAILED',
          stale: true,
          error: 'STALE_DAY_RECONCILIATION_FAILED',
        },
      });
    const result = await loadOperationalBootstrap({ user: SESSION_USER });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.stale).toBe(true);
    expect(result.data.needsRollover).toBe(true);
    expect(result.data.reconciliationError).toBe('STALE_DAY_RECONCILIATION_FAILED');
    expect(result.data.view.businessDay?.id).toBe(9);
    expect(result.data.operational.businessDay?.id).toBe(10);
    expect(ensureBusinessDayCurrent).toHaveBeenCalledWith(1, expect.objectContaining({ mode: 'BEST_EFFORT' }));
    expect(loadOperationalBootstrapSnapshot).toHaveBeenCalledTimes(1);
  });

  it('returns UNAUTHENTICATED without a session', async () => {
    const { loadOperationalBootstrap } = await loadWithMocks({
      session: null,
      verify: { ok: false, reason: 'missing' },
    });
    const result = await loadOperationalBootstrap();
    expect(result).toMatchObject({ ok: false, status: 401, code: 'UNAUTHENTICATED' });
  });

  it('returns NO_BRANCH_ACCESS when the cookie branch is not operable', async () => {
    const { loadOperationalBootstrap } = await loadWithMocks({
      snapshot: baseSnapshot({
        activeBranch: {
          branchId: 1,
          branchCode: 'GLEEM',
          branchName: 'جليم',
          shortName: 'جليم',
          timeZone: 'Africa/Cairo',
          businessDayCutoffTime: '04:00:00',
          branchIsActive: true,
          canOperate: false,
          canViewReports: true,
          canSwitch: false,
          accessIsActive: false,
          validFrom: new Date('2020-01-01'),
          validTo: null,
        },
      }),
    });
    const result = await loadOperationalBootstrap({ user: SESSION_USER });
    expect(result).toMatchObject({ ok: false, status: 403, code: 'NO_BRANCH_ACCESS' });
  });

  it('returns TEMPORARY_OPERATIONAL_READ_FAILURE when the snapshot query throws', async () => {
    const { loadOperationalBootstrap } = await loadWithMocks({
      snapshotImpl: async () => {
        throw new Error('ECONNREFUSED');
      },
    });
    const result = await loadOperationalBootstrap({ user: SESSION_USER });
    expect(result).toMatchObject({
      ok: false,
      status: 503,
      code: 'TEMPORARY_OPERATIONAL_READ_FAILURE',
    });
  });

  it('uses one read-repository snapshot on the happy path', async () => {
    const { loadOperationalBootstrap, loadOperationalBootstrapSnapshot } = await loadWithMocks();
    await loadOperationalBootstrap({ user: SESSION_USER });
    expect(loadOperationalBootstrapSnapshot).toHaveBeenCalledTimes(1);
  });
});

describe('operationalBootstrapRepository', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.doUnmock('@/modules/operations/infra/operationalBootstrapRepository');
    vi.doUnmock('@/lib/db');
    vi.doMock('server-only', () => ({}));
  });

  it('loads core bootstrap state in one SQL batch', async () => {
    const query = vi.fn(async () => ({
      recordsets: [
        [{ UserID: 7, UserName: 'saad', UserLevel: 'admin', ShiftID: 1, isDeleted: false }],
        [{
          BranchID: 1, BranchCode: 'GLEEM', BranchName: 'جليم', ShortName: 'جليم',
          TimeZone: 'Africa/Cairo', BusinessDayCutoffTime: '04:00:00', BranchIsActive: true,
          CanOperate: true, CanViewReports: true, CanSwitch: true, AccessIsActive: true,
          ValidFrom: new Date('2020-01-01'), ValidTo: null,
        }],
        [{
          ID: 1, UserID: 7, BranchID: 1, BranchCode: 'GLEEM', BranchName: 'جليم', ShortName: 'جليم',
          IsDefault: true, CanOperate: true, CanViewReports: true, CanSwitch: true,
          IsActive: true, ValidFrom: new Date('2020-01-01'), ValidTo: null, BranchIsActive: true,
        }],
        [{ ID: 10, BranchID: 1, NewDay: '2026-08-25', Status: true }],
        [{
          ID: 100, BranchID: 1, BusinessDayID: 10, NewDay: '2026-08-25', UserID: 7, ShiftID: 1,
          StartDate: '2026-08-25', StartTime: '10:00 AM', EndDate: null, EndTime: null, Status: true,
          UserName: 'saad', ShiftName: 'صباحي',
        }],
        [{ OpenShiftCount: 1 }],
        [{ RoleKey: 'admin' }],
        [],
        [{ PageKey: 'pos', PagePath: '/income/pos' }],
        [{ PageKey: 'pos', PagePath: '/income/pos' }],
      ],
      recordset: [],
    }));
    const request = vi.fn(() => ({
      input: vi.fn().mockReturnThis(),
      query,
    }));
    vi.doMock('@/lib/db', () => ({
      getPool: vi.fn(async () => ({ request })),
      sql: { Int: 'Int' },
    }));

    const { loadOperationalBootstrapSnapshot } = await import(
      '@/modules/operations/infra/operationalBootstrapRepository'
    );
    const snapshot = await loadOperationalBootstrapSnapshot({ userId: 7, branchId: 1 });
    expect(query).toHaveBeenCalledTimes(1);
    const sqlText = String(query.mock.calls[0]?.[0] ?? '');
    expect(sqlText).toContain('FROM dbo.TblUser');
    expect(sqlText).toContain('FROM dbo.TblNewDay');
    expect(sqlText).toContain('FROM dbo.TblShiftMove');
    expect(snapshot.user?.userId).toBe(7);
    expect(snapshot.openDay?.id).toBe(10);
    expect(snapshot.userOpenShift?.id).toBe(100);
  });
});

describe('GET /api/operations/bootstrap', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.doMock('server-only', () => ({}));
  });

  it('returns 401 UNAUTHENTICATED', async () => {
    vi.doMock('@/modules/operations/application/loadOperationalBootstrap', () => ({
      loadOperationalBootstrap: vi.fn(async () => ({
        ok: false,
        status: 401,
        code: 'UNAUTHENTICATED',
        message: 'غير مصرح',
      })),
    }));
    const { GET } = await import('@/app/api/operations/bootstrap/route');
    const res = await GET();
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.code).toBe('UNAUTHENTICATED');
  });

  it('returns 200 with Cache-Control no-store on success', async () => {
    vi.doMock('@/modules/operations/application/loadOperationalBootstrap', () => ({
      loadOperationalBootstrap: vi.fn(async () => ({
        ok: true,
        data: { user: { userId: 7 }, revision: '1:10:1:100:1:0', stale: false },
      })),
    }));
    const { GET } = await import('@/app/api/operations/bootstrap/route');
    const res = await GET();
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
  });
});

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { NextResponse } from 'next/server';
import { BranchDomainError } from '@/lib/branch/types';

vi.mock('server-only', () => ({}));

describe('Phase 1C business day service rules', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.doMock('server-only', () => ({}));
    vi.doMock('@/modules/operations/application/reconcileBusinessDay', () => ({
      ensureBusinessDayCurrent: vi.fn(async () => ({ branchId: 1, action: 'NO_OP', stale: false })),
    }));
  });

  it('rejects opening a second active day in the same branch', async () => {
    vi.doMock('@/lib/db', () => {
      const requestFactory = () => {
        const api: any = {
          input: () => api,
          query: async (sqlText: string) => {
            if (sqlText.includes('FROM dbo.TblBranch')) {
              return { recordset: [{ BranchID: 1 }] };
            }
            if (sqlText.includes('UPDLOCK') && sqlText.includes('Status = 1')) {
              return {
                recordset: [
                  { ID: 10, BranchID: 1, NewDay: '2026-07-21', Status: true },
                ],
              };
            }
            return { recordset: [] };
          },
        };
        return api;
      };
      return {
        getPool: vi.fn(async () => ({})),
        sql: {
          Int: 'Int',
          Date: 'Date',
          Transaction: class {
            begin = async () => undefined;
            commit = async () => undefined;
            rollback = async () => undefined;
            constructor() {
              return this;
            }
          },
          Request: class {
            constructor() {
              return requestFactory();
            }
          },
        },
      };
    });

    const { openBusinessDay } = await import('@/lib/branch/businessDay');
    await expect(
      openBusinessDay({
        userId: 1,
        branchId: 1,
        branchCode: 'GLEEM',
        branchName: 'جليم',
        shortName: 'جليم',
        timeZone: 'Africa/Cairo',
        businessDayCutoffTime: '04:00:00',
        canOperate: true,
        canViewReports: true,
        canSwitch: true,
      }),
    ).rejects.toMatchObject({ name: 'BranchDomainError', status: 400 });
  });

  it('blocks day writes when CanOperate is false', async () => {
    const { openBusinessDay } = await import('@/lib/branch/businessDay');
    await expect(
      openBusinessDay({
        userId: 1,
        branchId: 1,
        branchCode: 'GLEEM',
        branchName: 'جليم',
        shortName: 'جليم',
        timeZone: 'Africa/Cairo',
        businessDayCutoffTime: '04:00:00',
        canOperate: false,
        canViewReports: false,
        canSwitch: false,
      }),
    ).rejects.toMatchObject({ name: 'BranchDomainError', code: 'OPERATION_NOT_ALLOWED' });
  });
});

describe('Phase 1C shift service rules', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.doMock('server-only', () => ({}));
  });

  it('rejects opening a second shift on the same branch', async () => {
    const openShiftRow = {
      ID: 99,
      BranchID: 2,
      BusinessDayID: 5,
      NewDay: '2026-07-22',
      UserID: 7,
      ShiftID: 1,
      StartDate: '2026-07-22',
      StartTime: '10:00 AM',
      EndDate: null,
      EndTime: null,
      Status: true,
    };
    const requestFactory = () => {
      const api: any = {
        input: () => api,
        query: async (sqlText: string) => {
          if (sqlText.includes('FROM dbo.TblUser')) {
            return { recordset: [{ UserID: 7 }] };
          }
          if (sqlText.includes('FROM dbo.TblBranch')) {
            return { recordset: [{ BranchID: 2 }] };
          }
          if (sqlText.includes('sm.Status = 1') && sqlText.includes('TblShiftMove')) {
            return { recordset: [openShiftRow] };
          }
          if (sqlText.includes('FROM dbo.TblNewDay')) {
            return {
              recordset: [{ ID: 5, BranchID: 2, NewDay: '2026-07-22', Status: true }],
            };
          }
          return { recordset: [] };
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
          begin = async () => undefined;
          commit = async () => undefined;
          rollback = async () => undefined;
        },
        Request: class {
          constructor() {
            return requestFactory();
          }
        },
      },
    }));

    const { openShift } = await import('@/lib/branch/shiftSession');
    await expect(
      openShift(
        {
          userId: 7,
          branchId: 2,
          branchCode: 'OTHER',
          branchName: 'Other',
          shortName: null,
          timeZone: 'Africa/Cairo',
          businessDayCutoffTime: '04:00:00',
          canOperate: true,
          canViewReports: true,
          canSwitch: true,
        },
        7,
        1,
      ),
    ).rejects.toMatchObject({
      name: 'BranchDomainError',
      message: expect.stringContaining('بالفعل'),
    });
  });

  it('closes an other-branch open shift then opens on the active branch', async () => {
    const sqlKinds: string[] = [];
    const gleemOpen = {
      ID: 99,
      BranchID: 1,
      BusinessDayID: 1,
      NewDay: '2026-07-22',
      UserID: 7,
      ShiftID: 1,
      StartDate: '2026-07-22',
      StartTime: '09:00 AM',
      EndDate: null,
      EndTime: null,
      Status: true,
    };
    const gleemClosed = { ...gleemOpen, EndDate: '2026-07-22', EndTime: '10:00:00 AM', Status: false };
    const campOpened = {
      ID: 100,
      BranchID: 2,
      BusinessDayID: 5,
      NewDay: '2026-07-22',
      UserID: 7,
      ShiftID: 1,
      StartDate: '2026-07-22',
      StartTime: '10:00 AM',
      EndDate: null,
      EndTime: null,
      Status: true,
    };
    const requestFactory = () => {
      const api: any = {
        input: () => api,
        query: async (sqlText: string) => {
          if (sqlText.includes('FROM dbo.TblUser')) {
            sqlKinds.push('lockUser');
            return { recordset: [{ UserID: 7 }] };
          }
          if (sqlText.includes('FROM dbo.TblBranch')) {
            sqlKinds.push('lockTargetBranch');
            return { recordset: [{ BranchID: 2 }] };
          }
          if (sqlText.includes('sm.Status = 1') && sqlText.includes('TblShiftMove')) {
            sqlKinds.push('lockOpenShift');
            return { recordset: [gleemOpen] };
          }
          if (sqlText.includes('FROM dbo.TblNewDay WITH (UPDLOCK')) {
            sqlKinds.push('lockTargetDay');
            return {
              recordset: [{ ID: 5, BranchID: 2, NewDay: '2026-07-22', Status: true }],
            };
          }
          if (sqlText.includes('FROM dbo.TblNewDay')) {
            sqlKinds.push('getCurrentDay');
            return {
              recordset: [{ ID: 1, BranchID: 1, NewDay: '2026-07-22', Status: true }],
            };
          }
          if (sqlText.includes('UPDATE dbo.TblShiftMove')) {
            sqlKinds.push('closeOld');
            return { recordset: [], rowsAffected: [1] };
          }
          if (sqlText.includes('INSERT INTO dbo.TblShiftMove')) {
            sqlKinds.push('insertNew');
            return { recordset: [campOpened] };
          }
          sqlKinds.push('selectClosed');
          return { recordset: [gleemClosed] };
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
          begin = async () => undefined;
          commit = async () => undefined;
          rollback = async () => undefined;
        },
        Request: class {
          constructor() {
            return requestFactory();
          }
        },
      },
    }));

    const { openShift } = await import('@/lib/branch/shiftSession');
    const opened = await openShift(
      {
        userId: 7,
        branchId: 2,
        branchCode: 'OTHER',
        branchName: 'Other',
        shortName: null,
        timeZone: 'Africa/Cairo',
        businessDayCutoffTime: '04:00:00',
        canOperate: true,
        canViewReports: true,
        canSwitch: true,
      },
      7,
      1,
    );
    expect(opened.id).toBe(100);
    expect(opened.branchId).toBe(2);
    expect(sqlKinds).toContain('closeOld');
    expect(sqlKinds).toContain('insertNew');
    expect(sqlKinds.indexOf('lockTargetDay')).toBeLessThan(sqlKinds.indexOf('closeOld'));
  });

  it('rejects closing a shift that belongs to another branch', async () => {
    const otherBranchShift = {
      ID: 50,
      BranchID: 9,
      BusinessDayID: 3,
      NewDay: '2026-07-21',
      UserID: 1,
      ShiftID: 1,
      StartDate: '2026-07-21',
      StartTime: '10:00 AM',
      EndDate: null,
      EndTime: null,
      Status: true,
    };
    const requestFactory = () => {
      const api: any = {
        input: () => api,
        query: async (sqlText: string) => {
          if (sqlText.includes('FROM dbo.TblUser')) {
            return { recordset: [{ UserID: 1 }] };
          }
          return { recordset: [otherBranchShift] };
        },
      };
      return api;
    };
    vi.doMock('@/lib/db', () => ({
      getPool: vi.fn(async () => ({})),
      sql: {
        Int: 'Int',
        Date: 'Date',
        NVarChar: () => 'NVarChar',
        Transaction: class {
          begin = async () => undefined;
          commit = async () => undefined;
          rollback = async () => undefined;
        },
        Request: class {
          constructor() {
            return requestFactory();
          }
        },
      },
    }));

    const { closeShift } = await import('@/lib/branch/shiftSession');
    await expect(
      closeShift(
        {
          userId: 1,
          branchId: 1,
          branchCode: 'GLEEM',
          branchName: 'جليم',
          shortName: 'جليم',
          timeZone: 'Africa/Cairo',
          businessDayCutoffTime: '04:00:00',
          canOperate: true,
          canViewReports: true,
          canSwitch: true,
        },
        50,
      ),
    ).rejects.toMatchObject({ code: 'BRANCH_ACCESS_MISMATCH' });
  });
});

describe('resolveBranchDayAndShiftForWrite (shared financial gate)', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.doMock('server-only', () => ({}));
    vi.doMock('@/modules/operations/application/reconcileBusinessDay', () => ({
      ensureBusinessDayCurrent: vi.fn(async () => ({ branchId: 2, action: 'NO_OP' })),
    }));
  });

  it('stamps financial writes to the OPEN shift branch even when ViewBranch differs', async () => {
    const viewBranch = {
      userId: 7,
      branchId: 2,
      branchCode: 'CAMP_CAESAR',
      branchName: 'كامب شيزار',
      shortName: 'كامب',
      timeZone: 'Africa/Cairo',
      businessDayCutoffTime: '04:00:00',
      canOperate: true,
      canViewReports: true,
      canSwitch: true,
    };
    const gleemShift = {
      id: 99,
      branchId: 1,
      businessDayId: 10,
      newDay: '2026-08-09',
      userId: 7,
      shiftId: 1,
      status: true,
    };
    const gleemDay = {
      id: 10,
      branchId: 1,
      newDay: '2026-08-09',
      status: true,
    };

    vi.doMock('@/lib/branch/context', () => ({
      isActiveBranchContext: () => true,
      requireActiveBranchContext: vi.fn(),
      requireBranchOperationAccess: vi.fn(async () => viewBranch),
    }));
    vi.doMock('@/lib/branch/businessDay', () => ({
      getOpenBusinessDay: vi.fn(async () => ({
        id: 5,
        branchId: 2,
        newDay: '2026-08-09',
        status: true,
      })),
      getBusinessDayByDate: vi.fn(),
      getBusinessDayById: vi.fn(async () => gleemDay),
      getBranchBusinessDate: vi.fn(() => '2026-08-09'),
    }));
    vi.doMock('@/lib/branch/shiftSession', () => ({
      getUserOpenShift: vi.fn(async () => gleemShift),
      getUserOpenShiftForBranch: vi.fn(async () => null),
    }));
    vi.doMock('@/lib/branch/repository', () => ({
      getUserActiveStatus: vi.fn(async () => ({ exists: true, isDeleted: false })),
      getBranchById: vi.fn(async (id: number) =>
        id === 1
          ? {
              branchId: 1,
              branchCode: 'GLEEM',
              branchName: 'جليم',
              shortName: 'جليم',
              timeZone: 'Africa/Cairo',
              businessDayCutoffTime: '04:00:00',
              isActive: true,
            }
          : {
              branchId: 2,
              branchCode: 'CAMP_CAESAR',
              isActive: true,
            },
      ),
      branchNow: () => new Date(),
    }));
    vi.doMock('@/lib/branch/access', () => ({
      validateUserBranchAccess: vi.fn(async (_userId: number, branchId: number) => ({
        canOperate: true,
        canViewReports: true,
        canSwitch: true,
        branchId,
      })),
    }));

    const { resolveBranchDayAndShiftForWrite } = await import(
      '@/lib/branch/operationalGates'
    );
    const gated = await resolveBranchDayAndShiftForWrite(7);
    expect(gated.ok).toBe(true);
    if (gated.ok) {
      expect(gated.shift?.id).toBe(99);
      expect(gated.shift?.branchId).toBe(1);
      expect(gated.branch.branchId).toBe(1);
      expect(gated.day.id).toBe(10);
    }
  });

  it('falls back to the view-branch day when the user has no OPEN shift', async () => {
    const branch = {
      userId: 7,
      branchId: 2,
      branchCode: 'CAMP_CAESAR',
      branchName: 'كامب شيزار',
      shortName: 'كامب',
      timeZone: 'Africa/Cairo',
      businessDayCutoffTime: '04:00:00',
      canOperate: true,
      canViewReports: true,
      canSwitch: true,
    };

    vi.doMock('@/lib/branch/context', () => ({
      isActiveBranchContext: () => true,
      requireActiveBranchContext: vi.fn(),
      requireBranchOperationAccess: vi.fn(async () => branch),
    }));
    vi.doMock('@/lib/branch/businessDay', () => ({
      getOpenBusinessDay: vi.fn(async () => ({
        id: 5,
        branchId: 2,
        newDay: '2026-08-09',
        status: true,
      })),
      getBusinessDayByDate: vi.fn(),
      getBusinessDayById: vi.fn(),
      getBranchBusinessDate: vi.fn(() => '2026-08-09'),
    }));
    vi.doMock('@/lib/branch/shiftSession', () => ({
      getUserOpenShift: vi.fn(async () => null),
      getUserOpenShiftForBranch: vi.fn(async () => null),
    }));
    vi.doMock('@/lib/branch/repository', () => ({
      getUserActiveStatus: vi.fn(async () => ({ exists: true, isDeleted: false })),
      getBranchById: vi.fn(async () => ({
        branchId: 2,
        branchCode: 'CAMP_CAESAR',
        isActive: true,
      })),
      branchNow: () => new Date(),
    }));
    vi.doMock('@/lib/branch/access', () => ({
      validateUserBranchAccess: vi.fn(async () => ({
        canOperate: true,
        branchId: 2,
      })),
    }));

    const { resolveBranchDayAndShiftForWrite } = await import(
      '@/lib/branch/operationalGates'
    );
    const gated = await resolveBranchDayAndShiftForWrite(7);
    expect(gated.ok).toBe(true);
    if (gated.ok) {
      expect(gated.shift).toBeNull();
      expect(gated.branch.branchId).toBe(2);
    }
  });
});

describe('Phase 1C migration artifacts', () => {
  it('documents CT-aware PK swap and does not add financial BranchID', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const sqlText = fs.readFileSync(
      path.join(process.cwd(), 'db/migrations/add-branch-business-day-and-shift.sql'),
      'utf8',
    );
    expect(sqlText).toContain('DISABLE CHANGE_TRACKING');
    expect(sqlText).toContain('ENABLE CHANGE_TRACKING');
    expect(sqlText).toContain('PRIMARY KEY CLUSTERED (ID)');
    expect(sqlText).toContain('UQ_TblNewDay_Branch_NewDay');
    expect(sqlText).toContain('UX_TblShiftMove_OneOpenPerUser');
    expect(sqlText).toContain('BusinessDayID');
    expect(sqlText).not.toMatch(/ALTER TABLE dbo\.TblCashMove ADD BranchID/i);
    expect(sqlText).not.toMatch(/ALTER TABLE dbo\.TblinvServHead ADD BranchID/i);
  });
});

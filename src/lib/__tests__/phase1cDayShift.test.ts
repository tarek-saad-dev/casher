import { describe, expect, it, vi, beforeEach } from 'vitest';
import { NextResponse } from 'next/server';
import { BranchDomainError } from '@/lib/branch/types';

vi.mock('server-only', () => ({}));

describe('Phase 1C business day service rules', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.doMock('server-only', () => ({}));
  });

  it('rejects opening a second active day in the same branch', async () => {
    vi.doMock('@/lib/db', () => {
      const requestFactory = () => {
        const api: any = {
          input: () => api,
          query: async (sqlText: string) => {
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
    vi.doMock('@/lib/branch/businessDay', () => ({
      getOpenBusinessDay: vi.fn(async () => ({
        id: 5,
        branchId: 2,
        newDay: '2026-07-22',
        status: true,
      })),
      validateBusinessDayBelongsToBranch: vi.fn(),
    }));
    vi.doMock('@/lib/db', () => ({
      getPool: vi.fn(async () => ({
        request: () => {
          const api: any = {
            input: () => api,
            query: async () => ({
              recordset: [
                {
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
                },
              ],
            }),
          };
          return api;
        },
      })),
      sql: { Int: 'Int', Date: 'Date', NChar: () => 'NChar', NVarChar: () => 'NVarChar' },
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
    let call = 0;
    vi.doMock('@/lib/branch/businessDay', () => ({
      getOpenBusinessDay: vi.fn(async () => ({
        id: 5,
        branchId: 2,
        newDay: '2026-07-22',
        status: true,
      })),
      validateBusinessDayBelongsToBranch: vi.fn(),
    }));
    vi.doMock('@/lib/db', () => ({
      getPool: vi.fn(async () => ({
        request: () => {
          const api: any = {
            input: () => api,
            query: async (sqlText: string) => {
              call += 1;
              // 1) getUserOpenShift → open on branch 1
              if (call === 1) {
                return {
                  recordset: [
                    {
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
                    },
                  ],
                };
              }
              // 2) finalizeCloseShift UPDATE + SELECT
              if (call === 2 || String(sqlText).includes('UPDATE dbo.TblShiftMove')) {
                return {
                  recordset: [
                    {
                      ID: 99,
                      BranchID: 1,
                      BusinessDayID: 1,
                      NewDay: '2026-07-22',
                      UserID: 7,
                      ShiftID: 1,
                      StartDate: '2026-07-22',
                      StartTime: '09:00 AM',
                      EndDate: '2026-07-22',
                      EndTime: '10:00:00 AM',
                      Status: false,
                    },
                  ],
                };
              }
              // 3) INSERT on active branch
              return {
                recordset: [
                  {
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
                  },
                ],
              };
            },
          };
          return api;
        },
      })),
      sql: { Int: 'Int', Date: 'Date', NChar: () => 'NChar', NVarChar: () => 'NVarChar' },
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
    expect(call).toBeGreaterThanOrEqual(3);
  });

  it('rejects closing a shift that belongs to another branch', async () => {
    vi.doMock('@/lib/db', () => ({
      getPool: vi.fn(async () => ({
        request: () => {
          const api: any = {
            input: () => api,
            query: async () => ({
              recordset: [
                {
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
                },
              ],
            }),
          };
          return api;
        },
      })),
      sql: { Int: 'Int', Date: 'Date', NVarChar: () => 'NVarChar' },
    }));
    vi.doMock('@/lib/branch/businessDay', () => ({
      getOpenBusinessDay: vi.fn(),
      validateBusinessDayBelongsToBranch: vi.fn(),
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
  });

  it('does not block when user has an open shift only on another branch', async () => {
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
      getBranchBusinessDate: vi.fn(() => '2026-08-09'),
    }));
    vi.doMock('@/lib/branch/shiftSession', () => ({
      getUserOpenShift: vi.fn(async () => ({
        id: 99,
        branchId: 1,
        businessDayId: 1,
        newDay: '2026-08-09',
        userId: 7,
        shiftId: 1,
        status: true,
      })),
      // Active branch has its own open shift
      getUserOpenShiftForBranch: vi.fn(async (_userId: number, branchId: number) =>
        branchId === 2
          ? {
              id: 100,
              branchId: 2,
              businessDayId: 5,
              newDay: '2026-08-09',
              userId: 7,
              shiftId: 1,
              status: true,
            }
          : null,
      ),
    }));

    const { resolveBranchDayAndShiftForWrite } = await import(
      '@/lib/branch/operationalGates'
    );
    const gated = await resolveBranchDayAndShiftForWrite(7);
    expect(gated.ok).toBe(true);
    if (gated.ok) {
      expect(gated.shift?.id).toBe(100);
      expect(gated.shift?.branchId).toBe(2);
      expect(gated.branch.branchId).toBe(2);
    }
  });

  it('returns ok with null shift when active branch has no open shift', async () => {
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
      getBranchBusinessDate: vi.fn(() => '2026-08-09'),
    }));
    vi.doMock('@/lib/branch/shiftSession', () => ({
      getUserOpenShift: vi.fn(async () => ({
        id: 99,
        branchId: 1,
        businessDayId: 1,
        newDay: '2026-08-09',
        userId: 7,
        shiftId: 1,
        status: true,
      })),
      getUserOpenShiftForBranch: vi.fn(async () => null),
    }));

    const { resolveBranchDayAndShiftForWrite } = await import(
      '@/lib/branch/operationalGates'
    );
    const gated = await resolveBranchDayAndShiftForWrite(7);
    expect(gated.ok).toBe(true);
    if (gated.ok) {
      expect(gated.shift).toBeNull();
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

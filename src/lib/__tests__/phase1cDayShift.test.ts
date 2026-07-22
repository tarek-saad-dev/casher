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

  it('rejects opening a second shift when user already has one in another branch', async () => {
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
                  BranchID: 1,
                  BusinessDayID: 1,
                  NewDay: '2026-07-21',
                  UserID: 7,
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
      message: expect.stringContaining('فرع آخر'),
    });
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

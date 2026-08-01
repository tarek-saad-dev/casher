import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('server-only', () => ({}));

describe('assignPartnerHomeBranch', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('rejects users without the partner role', async () => {
    vi.doMock('@/lib/db', () => ({
      getPool: vi.fn(async () => ({
        request: () => {
          const api: {
            input: (...args: unknown[]) => unknown;
            query: (sqlText: string) => Promise<{ recordset: unknown[] }>;
          } = {
            input() {
              return api;
            },
            query: async (sqlText: string) => {
              if (sqlText.includes('TblUserRoles')) {
                return { recordset: [] };
              }
              return { recordset: [] };
            },
          };
          return api;
        },
      })),
      sql: {
        Int: 'Int',
        NVarChar: () => 'NVarChar',
        Bit: 'Bit',
        DateTime2: 'DateTime2',
        BigInt: 'BigInt',
      },
    }));
    vi.doMock('@/lib/branch/bootstrap', () => ({
      grantUserBranchAccess: vi.fn(),
    }));
    vi.doMock('@/lib/branch/repository', () => ({
      getBranchById: vi.fn(),
      listAllBranches: vi.fn(),
      listUserBranchAccessRows: vi.fn(),
    }));

    const { assignPartnerHomeBranch } = await import('@/lib/branch/partnerHomeBranch');
    const { BranchDomainError } = await import('@/lib/branch/types');

    await expect(
      assignPartnerHomeBranch({ userId: 17, branchId: 2, actorUserId: 1 }),
    ).rejects.toBeInstanceOf(BranchDomainError);
  });

  it('grants access and sets sole IsDefault on the chosen branch', async () => {
    const queries: string[] = [];
    const grantUserBranchAccess = vi.fn(async () => ({
      created: true,
      reactivated: false,
      accessId: 99,
    }));

    vi.doMock('@/lib/db', () => ({
      getPool: vi.fn(async () => ({
        request: () => {
          const api: {
            input: (...args: unknown[]) => unknown;
            query: (sqlText: string) => Promise<{ recordset: unknown[] }>;
          } = {
            input() {
              return api;
            },
            query: async (sqlText: string) => {
              queries.push(sqlText);
              if (sqlText.includes('TblUserRoles')) {
                return { recordset: [{ Ok: 1 }] };
              }
              return { recordset: [] };
            },
          };
          return api;
        },
      })),
      sql: {
        Int: 'Int',
        NVarChar: () => 'NVarChar',
        Bit: 'Bit',
        DateTime2: 'DateTime2',
        BigInt: 'BigInt',
      },
    }));
    vi.doMock('@/lib/branch/bootstrap', () => ({
      grantUserBranchAccess,
    }));
    vi.doMock('@/lib/branch/repository', () => ({
      getBranchById: vi.fn(async () => ({
        branchId: 2,
        branchCode: 'CAMP_CAESAR',
        branchName: 'Camp Caesar',
        shortName: 'CC',
        isActive: true,
      })),
      listAllBranches: vi.fn(),
      listUserBranchAccessRows: vi.fn(),
    }));

    const { assignPartnerHomeBranch } = await import('@/lib/branch/partnerHomeBranch');
    const result = await assignPartnerHomeBranch({
      userId: 17,
      branchId: 2,
      actorUserId: 1,
    });

    expect(grantUserBranchAccess).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 17,
        branchId: 2,
        canViewReports: true,
        canOperate: false,
      }),
    );
    expect(result).toMatchObject({
      userId: 17,
      branchId: 2,
      branchCode: 'CAMP_CAESAR',
      accessId: 99,
    });
    expect(queries.some((q) => q.includes('IsDefault = 0'))).toBe(true);
    expect(queries.some((q) => q.includes('IsDefault = 1') && q.includes('CanViewReports = 1'))).toBe(
      true,
    );
  });
});

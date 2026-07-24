/**
 * Phase 1G unit tests — second-branch readiness helpers (mocked DB, no live
 * connection) + source contract checks for the migration/scripts.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';

vi.mock('server-only', () => ({}));

function mockDb(recordset: Record<string, unknown>[]) {
  vi.doMock('@/lib/db', () => ({
    getPool: vi.fn(async () => ({
      request: () => {
        const api: any = {
          input: () => api,
          query: async () => ({ recordset }),
        };
        return api;
      },
    })),
    sql: {
      Int: 'Int',
      Date: 'Date',
      NVarChar: () => 'NVarChar',
      BigInt: 'BigInt',
      Bit: 'Bit',
      DateTime2: 'DateTime2',
      Decimal: () => 'Decimal',
    },
  }));
}

function mockDbSequential(responses: Array<Record<string, unknown>[]>) {
  let call = 0;
  vi.doMock('@/lib/db', () => ({
    getPool: vi.fn(async () => ({
      request: () => {
        const api: any = {
          input: () => api,
          query: async () => {
            const recordset = responses[call] ?? [];
            call += 1;
            return { recordset };
          },
        };
        return api;
      },
    })),
    sql: {
      Int: 'Int',
      Date: 'Date',
      NVarChar: () => 'NVarChar',
      BigInt: 'BigInt',
      Bit: 'Bit',
      DateTime2: 'DateTime2',
      Decimal: () => 'Decimal',
    },
  }));
}

describe('Phase 1G bootstrap — assertBranchIdentityAvailable (mocked DB)', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('throws BRANCH_NOT_FOUND (400) when branchCode is blank', async () => {
    mockDb([{ CodeDup: 0, NameDup: 0, ShortDup: 0 }]);
    const { assertBranchIdentityAvailable } = await import('@/lib/branch/bootstrap');
    await expect(
      assertBranchIdentityAvailable({ branchCode: '   ', branchName: 'Test Branch' }),
    ).rejects.toMatchObject({ code: 'BRANCH_NOT_FOUND', status: 400 });
  });

  it('throws BRANCH_NOT_FOUND (400) when branchName is blank', async () => {
    mockDb([{ CodeDup: 0, NameDup: 0, ShortDup: 0 }]);
    const { assertBranchIdentityAvailable } = await import('@/lib/branch/bootstrap');
    await expect(
      assertBranchIdentityAvailable({ branchCode: 'NEWB', branchName: '   ' }),
    ).rejects.toMatchObject({ code: 'BRANCH_NOT_FOUND', status: 400 });
  });

  it('throws with 409 when the branch code is already taken', async () => {
    mockDb([{ CodeDup: 1, NameDup: 0, ShortDup: 0 }]);
    const { assertBranchIdentityAvailable } = await import('@/lib/branch/bootstrap');
    await expect(
      assertBranchIdentityAvailable({ branchCode: 'GLEEM', branchName: 'New Branch' }),
    ).rejects.toMatchObject({ code: 'BRANCH_NOT_FOUND', status: 409 });
  });

  it('throws with 409 when the branch name is already taken', async () => {
    mockDb([{ CodeDup: 0, NameDup: 1, ShortDup: 0 }]);
    const { assertBranchIdentityAvailable } = await import('@/lib/branch/bootstrap');
    await expect(
      assertBranchIdentityAvailable({ branchCode: 'NEWB', branchName: 'جليم – سابا باشا' }),
    ).rejects.toMatchObject({ code: 'BRANCH_NOT_FOUND', status: 409 });
  });

  it('throws with 409 when the short name is already taken', async () => {
    mockDb([{ CodeDup: 0, NameDup: 0, ShortDup: 1 }]);
    const { assertBranchIdentityAvailable } = await import('@/lib/branch/bootstrap');
    await expect(
      assertBranchIdentityAvailable({
        branchCode: 'NEWB',
        branchName: 'New Branch',
        shortName: 'GL',
      }),
    ).rejects.toMatchObject({ code: 'BRANCH_NOT_FOUND', status: 409 });
  });

  it('resolves without throwing when code/name/shortName are all available', async () => {
    mockDb([{ CodeDup: 0, NameDup: 0, ShortDup: 0 }]);
    const { assertBranchIdentityAvailable } = await import('@/lib/branch/bootstrap');
    await expect(
      assertBranchIdentityAvailable({
        branchCode: 'newb',
        branchName: '  New Branch  ',
        shortName: 'nb',
      }),
    ).resolves.toBeUndefined();
  });
});

describe('Phase 1G bootstrap — grantUserBranchAccess (mocked DB)', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('inserts a new row with IsDefault=0 when none exists (never steals the default branch)', async () => {
    let insertedInput: Record<string, unknown> | null = null;
    vi.doMock('@/lib/db', () => ({
      getPool: vi.fn(async () => ({
        request: () => {
          const api: any = {
            inputs: {} as Record<string, unknown>,
            input(name: string, _type: unknown, value: unknown) {
              this.inputs[name] = value;
              return this;
            },
            query: async (sqlText: string) => {
              if (sqlText.includes('SELECT ID, IsActive')) {
                return { recordset: [] };
              }
              insertedInput = api.inputs;
              return { recordset: [{ ID: 501 }] };
            },
          };
          return api;
        },
      })),
      sql: {
        Int: 'Int',
        BigInt: 'BigInt',
        Bit: 'Bit',
        DateTime2: 'DateTime2',
        NVarChar: () => 'NVarChar',
      },
    }));

    const { grantUserBranchAccess } = await import('@/lib/branch/bootstrap');
    const result = await grantUserBranchAccess({ userId: 12, branchId: 9 });

    expect(result).toEqual({ created: true, reactivated: false, accessId: 501 });
    expect(insertedInput).toMatchObject({
      userId: 12,
      branchId: 9,
      canOperate: 1,
      canViewReports: 1,
      canSwitch: 0,
    });
  });

  it('is a no-op when a currently-valid row already exists (idempotent)', async () => {
    const farPast = new Date(Date.now() - 86_400_000).toISOString();
    let queryCalls = 0;
    vi.doMock('@/lib/db', () => ({
      getPool: vi.fn(async () => ({
        request: () => {
          const api: any = {
            input: () => api,
            query: async () => {
              queryCalls += 1;
              return {
                recordset: [{ ID: 7, IsActive: true, ValidFrom: farPast, ValidTo: null }],
              };
            },
          };
          return api;
        },
      })),
      sql: {
        Int: 'Int',
        BigInt: 'BigInt',
        Bit: 'Bit',
        DateTime2: 'DateTime2',
        NVarChar: () => 'NVarChar',
      },
    }));

    const { grantUserBranchAccess } = await import('@/lib/branch/bootstrap');
    const result = await grantUserBranchAccess({ userId: 12, branchId: 9 });

    expect(result).toEqual({ created: false, reactivated: false, accessId: 7 });
    // Only the existence-check SELECT should run — no UPDATE/INSERT for an already-valid row.
    expect(queryCalls).toBe(1);
  });

  it('reactivates an inactive row instead of inserting a duplicate', async () => {
    const farPast = new Date(Date.now() - 86_400_000).toISOString();
    let updateRan = false;
    vi.doMock('@/lib/db', () => ({
      getPool: vi.fn(async () => ({
        request: () => {
          const api: any = {
            input: () => api,
            query: async (sqlText: string) => {
              if (sqlText.includes('SELECT ID, IsActive')) {
                return {
                  recordset: [{ ID: 7, IsActive: false, ValidFrom: farPast, ValidTo: null }],
                };
              }
              updateRan = true;
              return { recordset: [] };
            },
          };
          return api;
        },
      })),
      sql: {
        Int: 'Int',
        BigInt: 'BigInt',
        Bit: 'Bit',
        DateTime2: 'DateTime2',
        NVarChar: () => 'NVarChar',
      },
    }));

    const { grantUserBranchAccess } = await import('@/lib/branch/bootstrap');
    const result = await grantUserBranchAccess({ userId: 12, branchId: 9 });

    expect(result).toEqual({ created: false, reactivated: true, accessId: 7 });
    expect(updateRan).toBe(true);
  });
});

describe('Phase 1G readiness — evaluateBranchOperationalReadiness (mocked repository)', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('returns a BRANCH_NOT_FOUND shape when the branch cannot be resolved', async () => {
    vi.doMock('@/lib/branch/repository', () => ({
      getBranchById: vi.fn(async () => null),
      getBranchByCode: vi.fn(async () => null),
      branchNow: () => new Date('2026-07-01T00:00:00Z'),
    }));
    vi.doMock('@/lib/db', () => ({
      getPool: vi.fn(async () => {
        throw new Error('getPool should not be called when the branch is not found');
      }),
      sql: { Int: 'Int', DateTime2: 'DateTime2' },
    }));

    const { evaluateBranchOperationalReadiness } = await import('@/lib/branch/readiness');
    const report = await evaluateBranchOperationalReadiness({ branchId: 999 });

    expect(report).toMatchObject({
      branchId: 999,
      branchCode: '',
      branchName: '',
      ready: false,
      blockers: ['BRANCH_NOT_FOUND'],
      warnings: [],
    });
    expect(report.checks).toHaveLength(1);
    expect(report.checks[0]).toMatchObject({ code: 'BRANCH_EXISTS', ok: false, severity: 'blocker' });
    expect(typeof report.checkedAt).toBe('string');
  });
});

describe('Phase 1G assignmentIntegrity — auditEmployeeAssignmentIntegrity (mocked DB)', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('flags duplicate-active and overlapping-range assignments for the same emp+branch', async () => {
    const overlappingRows = [
      { ID: 1, EmpID: 5, BranchID: 9, EffectiveFrom: '2026-01-01', EffectiveTo: null },
      { ID: 2, EmpID: 5, BranchID: 9, EffectiveFrom: '2026-01-15', EffectiveTo: null },
    ];
    // Query order inside auditEmployeeAssignmentIntegrity:
    // 1) orphanBranch  2) inactiveBranch  3) badDates  4) nowhere  5) activeRows  6) allActive
    mockDbSequential([[], [], [], [], overlappingRows, overlappingRows]);

    const { auditEmployeeAssignmentIntegrity } = await import('@/lib/branch/assignmentIntegrity');
    const report = await auditEmployeeAssignmentIntegrity(new Date('2026-07-01T00:00:00Z'));

    const codes = report.issues.map((i) => i.code).sort();
    expect(codes).toEqual(['DUPLICATE_ACTIVE_ASSIGNMENT', 'OVERLAPPING_ASSIGNMENT_RANGES']);
    expect(report.errorCount).toBe(2);
    expect(report.warningCount).toBe(0);
    expect(report.issueCount).toBe(2);
  });

  it('reports no issues for clean, non-overlapping assignment data', async () => {
    mockDbSequential([[], [], [], [], [], []]);

    const { auditEmployeeAssignmentIntegrity } = await import('@/lib/branch/assignmentIntegrity');
    const report = await auditEmployeeAssignmentIntegrity(new Date('2026-07-01T00:00:00Z'));

    expect(report.issues).toEqual([]);
    expect(report.errorCount).toBe(0);
    expect(report.warningCount).toBe(0);
  });
});

describe('Phase 1G — source contracts (no live DB)', () => {
  const root = process.cwd();

  it('migration adds BranchName and non-null ShortName uniqueness, and never creates a second branch', () => {
    const sqlPath = path.join(root, 'db/migrations/add-second-branch-readiness.sql');
    const sql = fs.readFileSync(sqlPath, 'utf8');
    expect(sql).toContain('UQ_TblBranch_BranchName');
    expect(sql).toContain('UX_TblBranch_ShortName_NotNull');
    expect(sql).not.toMatch(/INSERT\s+INTO\s+dbo\.TblBranch/i);
  });

  it('bootstrap.ts creates QueueBookingSettings scoped by BranchID', () => {
    const src = fs.readFileSync(
      path.join(root, 'src/lib/branch/bootstrap.ts'),
      'utf8',
    );
    expect(src).toMatch(/INSERT INTO dbo\.QueueBookingSettings[\s\S]*?BranchID/);
    expect(src).toContain('export async function grantUserBranchAccess');
    expect(src).toContain('export async function bootstrapBranch');
  });

  it('re-exports the Phase 1G bootstrap/assignment/readiness APIs from the branch index barrel', () => {
    const src = fs.readFileSync(path.join(root, 'src/lib/branch/index.ts'), 'utf8');
    expect(src).toContain('bootstrapBranch');
    expect(src).toContain('grantUserBranchAccess');
    expect(src).toContain('auditEmployeeAssignmentIntegrity');
    expect(src).toContain('ensureEmployeeBranchAssignment');
    expect(src).toContain('evaluateBranchOperationalReadiness');
  });

  it('the bootstrap CLI, migration runner, and verifier scripts exist', () => {
    expect(fs.existsSync(path.join(root, 'scripts/bootstrap-branch.ts'))).toBe(true);
    expect(
      fs.existsSync(path.join(root, 'scripts/run-second-branch-readiness-migration.ts')),
    ).toBe(true);
    expect(fs.existsSync(path.join(root, 'scripts/verify-second-branch-readiness.ts'))).toBe(
      true,
    );
  });

  it('the bootstrap CLI requires --confirm before writing and never logs credentials', () => {
    const src = fs.readFileSync(path.join(root, 'scripts/bootstrap-branch.ts'), 'utf8');
    expect(src).toContain('DRY RUN');
    expect(src).toMatch(/if \(!confirm\)/);
    expect(src).not.toMatch(/password/i);
  });

  it('previously unscoped QueueBookingSettings readers are now branch-scoped', () => {
    const normalize = (s: string) => s.replace(/\s+/g, ' ');

    const arrive = normalize(
      fs.readFileSync(
        path.join(root, 'src/app/api/operations/bookings/[id]/arrive/route.ts'),
        'utf8',
      ),
    );
    expect(arrive).toContain('FROM [dbo].[QueueBookingSettings] WHERE BranchID = @branchId');

    const queueRoute = normalize(
      fs.readFileSync(path.join(root, 'src/app/api/queue/route.ts'), 'utf8'),
    );
    expect(queueRoute).toContain('FROM [dbo].[QueueBookingSettings] WHERE BranchID = @branchId');

    const adminSettings = fs.readFileSync(
      path.join(root, 'src/app/api/admin/booking-settings/route.ts'),
      'utf8',
    );
    expect(adminSettings).toContain('requireActiveBranchContext');
    expect(adminSettings).toContain('requireBranchOperationAccess');
    expect(adminSettings).toContain('WHERE BranchID = @branchId');

    const barberDurations = fs.readFileSync(
      path.join(root, 'src/app/api/services/[id]/barber-durations/route.ts'),
      'utf8',
    );
    expect(barberDurations).toContain('getGlobalTimingDefaults');
    expect(barberDurations).toContain('getPublicSettings');
  });
});

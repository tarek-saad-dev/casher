/**
 * Temporary transfer ↔ public booking authority parity.
 *
 * Regression for: roster/read paths include transfer-in, but specific-barber
 * check-slot / plan / create used assignment-only isEmployeeBookableAtBranch.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import path from 'path';

vi.mock('server-only', () => ({}));

function read(rel: string) {
  return fs.readFileSync(path.join(process.cwd(), rel), 'utf8');
}

describe('temporary transfer booking authority — static contracts', () => {
  it('listBookable strips leftover dest assignment when weekly work is elsewhere', () => {
    const ownership = read('src/lib/branch/bookingQueueOwnership.ts');
    expect(ownership).toContain('loadWorkingWeeklyBranchIdsByEmp');
    expect(ownership).toContain('assignmentGhostsOperationalBranch');
    expect(ownership).toContain('TblEmpBranchWorkSchedule');
  });

  it('isEmployeeBookableAtBranch shares transfer-in authority with listBookable', () => {
    const ownership = read('src/lib/branch/bookingQueueOwnership.ts');
    expect(ownership).toContain('loadTemporaryTransferInRow');
    expect(ownership).toContain('loadTransferredAwayEmpIds');
    expect(ownership).toContain('loadTransferInRosterEffects');
    expect(ownership).toContain('isTransferDestinationActive');
    expect(ownership).toMatch(
      /isEmployeeBookableAtBranch[\s\S]*loadTemporaryTransferInRow/,
    );
  });

  it('assignmentIntegrity does not flip CanReceiveBookings on existing rows', () => {
    const src = read('src/lib/branch/assignmentIntegrity.ts');
    expect(src).not.toMatch(
      /CanReceiveBookings\s*=\s*1[\s\S]{0,80}ISNULL\(CanReceiveBookings/,
    );
    expect(src).toContain('if (existing.recordset[0])');
    expect(src).toMatch(
      /if \(existing\.recordset\[0\]\) \{\s*return \{ created: false/,
    );
  });

  it('availability engine specific path still uses isEmployeeBookableAtBranch', () => {
    const engine = read('src/lib/bookingAvailabilityEngine.ts');
    expect(engine).toContain('isEmployeeBookableAtBranch');
    expect(engine).toMatch(/Specific: do NOT load the full branch roster/);
  });

  it('plan/check-slot/create share evaluatePublicBookingSelection', () => {
    expect(read('src/app/api/public/booking/plan/route.ts')).toContain(
      'evaluatePublicBookingSelection',
    );
    expect(read('src/app/api/public/booking/check-slot/route.ts')).toContain(
      'evaluatePublicBookingSelection',
    );
    expect(read('src/lib/booking/publicBookingCreate.ts')).toContain(
      'evaluatePublicBookingSelection',
    );
  });

  it('resolver treats transfer destination as authoritative without dest assignment', () => {
    const resolver = read('src/lib/hr/employeeBranchScheduleResolver.ts');
    const destBlock = resolver.slice(
      resolver.indexOf('if (transfer.toBranchId === args.branchId)'),
      resolver.indexOf('const assigned = await hasActiveAssignment'),
    );
    expect(destBlock).toContain("source: 'temporary_transfer'");
    expect(destBlock).not.toContain('hasActiveAssignment');
  });

  it('transfer cache invalidation clears public booking roster/availability caches', () => {
    const inv = read('src/lib/hr/scheduleAvailabilityInvalidation.ts');
    expect(inv).toContain('invalidatePublicBookingBarbersCache');
    expect(inv).toContain('invalidatePublicBookingAvailabilityCache');
    expect(inv).toContain('invalidatePublicBookingCrossBranchAvailabilityCache');
  });

  it('public booking eligibility includes temporary transfer', () => {
    const vis = read('src/lib/branch/publicBranchVisibility.ts');
    expect(vis).toContain('includeTemporaryTransfer: true');
  });
  it('resolver formats mssql TIME Date values as HH:mm', () => {
    const resolver = read('src/lib/hr/employeeBranchScheduleResolver.ts');
    expect(resolver).toContain('v instanceof Date');
    expect(resolver).toContain('getUTCHours');
    expect(resolver).not.toMatch(
      /typeof v === 'string' \? v\.slice\(0, 5\) : String\(v\)\.slice\(0, 5\)/,
    );
  });
});

describe('listBookable / isEmployeeBookableAtBranch transfer parity', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  function mockDb(handlers: {
    assignmentEmpIds?: number[];
    /** Transfer-in rows with optional window times */
    transferInRows?: Array<{
      EmpID: number;
      StartTime: string | null;
      EndTime: string | null;
    }>;
    transferAwayRows?: Array<{
      EmpID: number;
      StartTime: string | null;
      EndTime: string | null;
    }>;
    assignmentHasEmp?: boolean;
    /** Working weekly rows (EmpID, BranchID) for leftover-assignment ghost filter. */
    weeklyWorking?: Array<{ EmpID: number; BranchID: number }>;
  }) {
    vi.doMock('@/lib/branch/smokeExecutionContext', () => ({
      getSmokeExecutionContext: () => null,
    }));
    // Use real window helpers so partial-day boundaries are proven.
    vi.doMock('@/lib/db', () => ({
      sql: { Int: 'Int', Date: 'Date', Bit: 'Bit', TinyInt: 'TinyInt' },
      getPool: async () => ({
        request: () => {
          const inputs: Record<string, unknown> = {};
          const req = {
            input(name: string, _t: unknown, value: unknown) {
              inputs[name] = value;
              return req;
            },
            async query(sqlText: string) {
              const sql = sqlText.replace(/\s+/g, ' ');

              if (sql.includes('FromBranchID = @branchId') && sql.includes('StartTime')) {
                return { recordset: handlers.transferAwayRows ?? [] };
              }
              if (
                sql.includes('ToBranchID = @branchId') &&
                sql.includes('StartTime') &&
                !sql.includes('AND ea.EmpID')
              ) {
                const rows = handlers.transferInRows ?? [];
                if (sql.includes('SELECT TOP 1 t.StartTime') || sql.includes('SELECT TOP 1 t.StartTime, t.EndTime')) {
                  const empId = Number(inputs.empId);
                  const hit = rows.find((r) => r.EmpID === empId);
                  return { recordset: hit ? [hit] : [] };
                }
                return { recordset: rows };
              }
              if (sql.includes('TblEmpBranchWorkSchedule')) {
                const weekly = handlers.weeklyWorking ?? [];
                const empId = Number(inputs.empId);
                const rows =
                  Number.isFinite(empId) && empId > 0
                    ? weekly.filter((r) => r.EmpID === empId)
                    : weekly;
                return { recordset: rows };
              }
              if (sql.includes('TblEmpBranchAssignment') && sql.includes('AND ea.EmpID = @empId')) {
                return {
                  recordset: handlers.assignmentHasEmp ? [{ EmpID: inputs.empId }] : [],
                };
              }
              if (sql.includes('TblEmpBranchAssignment') && sql.includes('CanReceiveBookings')) {
                return {
                  recordset: (handlers.assignmentEmpIds ?? []).map((EmpID) => ({
                    EmpID,
                  })),
                };
              }
              return { recordset: [] };
            },
          };
          return req;
        },
      }),
    }));
  }

  it('roster destination parity: transfer-in emp appears without dest assignment', async () => {
    mockDb({
      assignmentEmpIds: [10],
      transferInRows: [{ EmpID: 42, StartTime: null, EndTime: null }],
      transferAwayRows: [],
    });
    const mod = await import('@/lib/branch/bookingQueueOwnership');
    const ids = await mod.listBookableEmployeeIdsForBranch(2, '2026-09-02', {
      publicOnly: true,
    });
    expect(ids.sort((a, b) => a - b)).toEqual([10, 42]);
  });

  it('single-emp destination parity: transfer-in passes isEmployeeBookableAtBranch', async () => {
    mockDb({
      assignmentHasEmp: false,
      transferInRows: [{ EmpID: 42, StartTime: null, EndTime: null }],
      transferAwayRows: [],
    });
    const mod = await import('@/lib/branch/bookingQueueOwnership');
    const ok = await mod.isEmployeeBookableAtBranch(42, 2, '2026-09-02', {
      publicOnly: true,
    });
    expect(ok).toBe(true);
  });

  it('source rejection: transferred-away emp removed from roster and bookable check', async () => {
    mockDb({
      assignmentEmpIds: [42, 10],
      transferInRows: [],
      transferAwayRows: [{ EmpID: 42, StartTime: null, EndTime: null }],
      assignmentHasEmp: true,
    });
    const mod = await import('@/lib/branch/bookingQueueOwnership');
    const ids = await mod.listBookableEmployeeIdsForBranch(1, '2026-09-02', {
      publicOnly: true,
    });
    expect(ids).toEqual([10]);
    expect(ids).not.toContain(42);

    const ok = await mod.isEmployeeBookableAtBranch(42, 1, '2026-09-02', {
      publicOnly: true,
    });
    expect(ok).toBe(false);
  });

  it('next-day fallback: no transfer rows → assignment-only behavior', async () => {
    vi.resetModules();
    vi.doMock('@/lib/branch/smokeExecutionContext', () => ({
      getSmokeExecutionContext: () => null,
    }));
    vi.doMock('@/lib/db', () => ({
      sql: { Int: 'Int', Date: 'Date', Bit: 'Bit' },
      getPool: async () => ({
        request: () => {
          const inputs: Record<string, unknown> = {};
          const req = {
            input(name: string, _t: unknown, value: unknown) {
              inputs[name] = value;
              return req;
            },
            async query(sqlText: string) {
              const sql = sqlText.replace(/\s+/g, ' ');
              const branchId = Number(inputs.branchId);
              if (sql.includes('FromBranchID = @branchId')) {
                return { recordset: [] };
              }
              if (sql.includes('ToBranchID = @branchId') && sql.includes('StartTime')) {
                return { recordset: [] };
              }
              if (sql.includes('TblEmpBranchAssignment') && sql.includes('AND ea.EmpID = @empId')) {
                return {
                  recordset: branchId === 1 ? [{ EmpID: inputs.empId }] : [],
                };
              }
              if (sql.includes('TblEmpBranchAssignment') && sql.includes('CanReceiveBookings')) {
                return {
                  recordset: branchId === 1 ? [{ EmpID: 42 }] : [],
                };
              }
              return { recordset: [] };
            },
          };
          return req;
        },
      }),
    }));
    const mod = await import('@/lib/branch/bookingQueueOwnership');
    const ids = await mod.listBookableEmployeeIdsForBranch(1, '2026-09-03', {
      publicOnly: true,
    });
    expect(ids).toEqual([42]);
    const ok = await mod.isEmployeeBookableAtBranch(42, 1, '2026-09-03', {
      publicOnly: true,
    });
    expect(ok).toBe(true);
    const atDest = await mod.isEmployeeBookableAtBranch(42, 2, '2026-09-03', {
      publicOnly: true,
    });
    expect(atDest).toBe(false);
  });

  it('partial-day 14:00–22:00 boundaries: source/dest eligibility flips', async () => {
    const workDate = '2026-09-02';
    mockDb({
      // Source home assignment only (branch 1). No permanent dest assignment.
      assignmentEmpIds: [42],
      transferInRows: [{ EmpID: 42, StartTime: '14:00', EndTime: '22:00' }],
      transferAwayRows: [{ EmpID: 42, StartTime: '14:00', EndTime: '22:00' }],
      assignmentHasEmp: true,
    });
    // Override assignment check to be branch-aware: only home branch 1.
    vi.resetModules();
    vi.doMock('@/lib/branch/smokeExecutionContext', () => ({
      getSmokeExecutionContext: () => null,
    }));
    vi.doMock('@/lib/db', () => ({
      sql: { Int: 'Int', Date: 'Date', Bit: 'Bit' },
      getPool: async () => ({
        request: () => {
          const inputs: Record<string, unknown> = {};
          const req = {
            input(name: string, _t: unknown, value: unknown) {
              inputs[name] = value;
              return req;
            },
            async query(sqlText: string) {
              const sql = sqlText.replace(/\s+/g, ' ');
              const branchId = Number(inputs.branchId);
              const empId = Number(inputs.empId);
              if (sql.includes('FromBranchID = @branchId')) {
                return {
                  recordset:
                    branchId === 1
                      ? [{ EmpID: 42, StartTime: '14:00', EndTime: '22:00' }]
                      : [],
                };
              }
              if (sql.includes('ToBranchID = @branchId') && sql.includes('StartTime')) {
                const row = { EmpID: 42, StartTime: '14:00', EndTime: '22:00' };
                if (sql.includes('SELECT TOP 1')) {
                  return {
                    recordset: branchId === 2 && empId === 42 ? [row] : [],
                  };
                }
                return { recordset: branchId === 2 ? [row] : [] };
              }
              if (sql.includes('TblEmpBranchAssignment') && sql.includes('AND ea.EmpID = @empId')) {
                return {
                  recordset: branchId === 1 ? [{ EmpID: 42 }] : [],
                };
              }
              if (sql.includes('TblEmpBranchAssignment') && sql.includes('CanReceiveBookings')) {
                return {
                  recordset: branchId === 1 ? [{ EmpID: 42 }] : [],
                };
              }
              return { recordset: [] };
            },
          };
          return req;
        },
      }),
    }));

    const mod = await import('@/lib/branch/bookingQueueOwnership');
    // 13:59 Cairo ≈ 10:59 UTC (EEST UTC+3)
    const before = new Date('2026-09-02T10:59:00.000Z');
    // 14:00 Cairo
    const atStart = new Date('2026-09-02T11:00:00.000Z');
    // 21:59 Cairo
    const nearEnd = new Date('2026-09-02T18:59:00.000Z');
    // 22:00 Cairo → after
    const atEnd = new Date('2026-09-02T19:00:00.000Z');

    async function check(now: Date) {
      const src = await mod.isEmployeeBookableAtBranch(42, 1, workDate, {
        publicOnly: true,
        now,
      });
      const dest = await mod.isEmployeeBookableAtBranch(42, 2, workDate, {
        publicOnly: true,
        now,
      });
      const srcRoster = await mod.listBookableEmployeeIdsForBranch(1, workDate, {
        publicOnly: true,
        now,
      });
      const destRoster = await mod.listBookableEmployeeIdsForBranch(2, workDate, {
        publicOnly: true,
        now,
      });
      return { src, dest, srcRoster, destRoster };
    }

    const b = await check(before);
    expect(b.src).toBe(true);
    expect(b.dest).toBe(false);
    expect(b.srcRoster).toContain(42);
    expect(b.destRoster).not.toContain(42);

    const s = await check(atStart);
    expect(s.src).toBe(false);
    expect(s.dest).toBe(true);
    expect(s.srcRoster).not.toContain(42);
    expect(s.destRoster).toContain(42);

    const n = await check(nearEnd);
    expect(n.src).toBe(false);
    expect(n.dest).toBe(true);

    const a = await check(atEnd);
    expect(a.src).toBe(false); // source still inactive after window
    expect(a.dest).toBe(false); // destination inactive after EndTime
  });

  it('C: leftover dest assignment after cancel is not publicly bookable', async () => {
    // Permanent CAMP weekly + leftover GLEEM assignment, no active transfer.
    vi.resetModules();
    vi.doMock('@/lib/branch/smokeExecutionContext', () => ({
      getSmokeExecutionContext: () => null,
    }));
    vi.doMock('@/lib/db', () => ({
      sql: { Int: 'Int', Date: 'Date', Bit: 'Bit', TinyInt: 'TinyInt' },
      getPool: async () => ({
        request: () => {
          const inputs: Record<string, unknown> = {};
          const req = {
            input(name: string, _t: unknown, value: unknown) {
              inputs[name] = value;
              return req;
            },
            async query(sqlText: string) {
              const sql = sqlText.replace(/\s+/g, ' ');
              if (sql.includes('FromBranchID = @branchId') || sql.includes('ToBranchID = @branchId')) {
                return { recordset: [] };
              }
              if (sql.includes('TblEmpBranchWorkSchedule')) {
                return { recordset: [{ EmpID: 42, BranchID: 1 }] };
              }
              if (sql.includes('TblEmpBranchAssignment') && sql.includes('AND ea.EmpID = @empId')) {
                return { recordset: [{ EmpID: 42 }] };
              }
              if (sql.includes('TblEmpBranchAssignment') && sql.includes('CanReceiveBookings')) {
                return { recordset: [{ EmpID: 42 }] };
              }
              return { recordset: [] };
            },
          };
          return req;
        },
      }),
    }));
    const mod = await import('@/lib/branch/bookingQueueOwnership');
    const campRoster = await mod.listBookableEmployeeIdsForBranch(1, '2026-09-02', {
      publicOnly: true,
    });
    const gleemRoster = await mod.listBookableEmployeeIdsForBranch(2, '2026-09-02', {
      publicOnly: true,
    });
    expect(campRoster).toContain(42);
    expect(gleemRoster).not.toContain(42);
    expect(
      await mod.isEmployeeBookableAtBranch(42, 1, '2026-09-02', { publicOnly: true }),
    ).toBe(true);
    expect(
      await mod.isEmployeeBookableAtBranch(42, 2, '2026-09-02', { publicOnly: true }),
    ).toBe(false);
  });

  it('E: genuine weekly work at dest assignment is preserved', async () => {
    vi.resetModules();
    vi.doMock('@/lib/branch/smokeExecutionContext', () => ({
      getSmokeExecutionContext: () => null,
    }));
    vi.doMock('@/lib/db', () => ({
      sql: { Int: 'Int', Date: 'Date', Bit: 'Bit', TinyInt: 'TinyInt' },
      getPool: async () => ({
        request: () => {
          const inputs: Record<string, unknown> = {};
          const req = {
            input(name: string, _t: unknown, value: unknown) {
              inputs[name] = value;
              return req;
            },
            async query(sqlText: string) {
              const sql = sqlText.replace(/\s+/g, ' ');
              const branchId = Number(inputs.branchId);
              if (sql.includes('FromBranchID = @branchId') || sql.includes('ToBranchID = @branchId')) {
                return { recordset: [] };
              }
              if (sql.includes('TblEmpBranchWorkSchedule')) {
                return { recordset: [{ EmpID: 42, BranchID: 2 }] };
              }
              if (sql.includes('TblEmpBranchAssignment')) {
                return { recordset: branchId === 2 ? [{ EmpID: 42 }] : [] };
              }
              return { recordset: [] };
            },
          };
          return req;
        },
      }),
    }));
    const mod = await import('@/lib/branch/bookingQueueOwnership');
    const destRoster = await mod.listBookableEmployeeIdsForBranch(2, '2026-09-02', {
      publicOnly: true,
    });
    expect(destRoster).toContain(42);
    expect(
      await mod.isEmployeeBookableAtBranch(42, 2, '2026-09-02', { publicOnly: true }),
    ).toBe(true);
  });
});

describe('selection evaluator maps empty eligibility to BARBER_NOT_BOOKABLE', () => {
  it('surfaces BARBER_NOT_BOOKABLE when engine contexts are empty', () => {
    const src = read('src/lib/booking/publicBookingSelectionEvaluator.ts');
    expect(src).toContain("availabilityCode = 'BARBER_NOT_BOOKABLE'");
    expect(src).toContain('not_bookable_at_branch');
  });
});

describe('BOOKING_PLAN_UNAVAILABLE Arabic message is actionable', () => {
  it('includes refresh/retry guidance', async () => {
    const { PUBLIC_BOOKING_ERROR_CATALOG } = await import(
      '@/lib/booking/publicBookingErrorCatalog'
    );
    expect(PUBLIC_BOOKING_ERROR_CATALOG.BOOKING_PLAN_UNAVAILABLE.messageAr).toMatch(
      /حدّث المواعيد/,
    );
    expect(PUBLIC_BOOKING_ERROR_CATALOG.BARBER_NOT_BOOKABLE.messageAr.length).toBeGreaterThan(10);
    expect(
      PUBLIC_BOOKING_ERROR_CATALOG.BARBER_AVAILABLE_AT_DIFFERENT_BRANCH.messageAr,
    ).toMatch(/فرع آخر/);
  });
});

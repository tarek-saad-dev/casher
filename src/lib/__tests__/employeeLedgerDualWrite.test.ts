import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('server-only', () => ({}));

describe('employeeLedgerConfig', () => {
  const original = process.env.EMP_LEDGER_DUAL_WRITE_ENABLED;

  afterEach(() => {
    if (original === undefined) {
      delete process.env.EMP_LEDGER_DUAL_WRITE_ENABLED;
    } else {
      process.env.EMP_LEDGER_DUAL_WRITE_ENABLED = original;
    }
  });

  it('is disabled by default', async () => {
    delete process.env.EMP_LEDGER_DUAL_WRITE_ENABLED;
    const { isEmployeeLedgerDualWriteEnabled } = await import('@/lib/employeeLedgerConfig');
    expect(isEmployeeLedgerDualWriteEnabled()).toBe(false);
  });

  it('is enabled only when env is true', async () => {
    process.env.EMP_LEDGER_DUAL_WRITE_ENABLED = 'true';
    const { isEmployeeLedgerDualWriteEnabled } = await import('@/lib/employeeLedgerConfig');
    expect(isEmployeeLedgerDualWriteEnabled()).toBe(true);
  });
});

describe('employeeLedgerDualWrite helpers', () => {
  it('builds payroll month and Arabic note from work date', async () => {
    const {
      payrollMonthFromWorkDate,
      buildHourlyWageLedgerNote,
      isMissingLedgerTableError,
    } = await import('@/lib/services/employeeLedgerDualWrite');

    expect(payrollMonthFromWorkDate('2026-04-15')).toBe('2026-04');
    expect(buildHourlyWageLedgerNote('2026-04-15')).toBe('استحقاق يومية/ساعات بتاريخ 2026-04-15');
    expect(isMissingLedgerTableError("Invalid object name 'dbo.TblEmpLedgerEntry'.")).toBe(true);
    expect(isMissingLedgerTableError('some other error')).toBe(false);
  });
});

describe('upsertHourlyWageLedgerEntry', () => {
  function makePool(queryHandler?: (sqlText: string, requestIndex: number) => Promise<unknown>) {
    let requestIndex = 0;
    const pool = {
      request: vi.fn(() => {
        const current = requestIndex++;
        return {
          input: vi.fn().mockReturnThis(),
          query: vi.fn(async (sqlText: string) => {
            if (queryHandler) {
              return queryHandler(sqlText, current);
            }
            if (sqlText.includes('UPDATE dbo.TblEmpLedgerEntry')) {
              return { rowsAffected: [0] };
            }
            return { rowsAffected: [1] };
          }),
        };
      }),
    };
    return pool;
  }

  it('inserts when no active row exists using separate requests for update and insert', async () => {
    const { upsertHourlyWageLedgerEntry } = await import('@/lib/services/employeeLedgerDualWrite');
    const pool = makePool();

    const outcome = await upsertHourlyWageLedgerEntry(pool as never, {
      payrollId: 10,
      empId: 3,
      workDate: '2026-04-15',
      attendanceId: 55,
      dailyWage: 250,
    });

    expect(outcome).toBe('inserted');
    expect(pool.request).toHaveBeenCalledTimes(2);
  });

  it('updates when active row exists', async () => {
    const { upsertHourlyWageLedgerEntry } = await import('@/lib/services/employeeLedgerDualWrite');
    const pool = makePool(async (sqlText) => (
      sqlText.includes('UPDATE dbo.TblEmpLedgerEntry')
        ? { rowsAffected: [1] }
        : { rowsAffected: [0] }
    ));

    const outcome = await upsertHourlyWageLedgerEntry(pool as never, {
      payrollId: 10,
      empId: 3,
      workDate: '2026-04-15',
      attendanceId: 55,
      dailyWage: 300,
    });

    expect(outcome).toBe('updated');
    expect(pool.request).toHaveBeenCalledTimes(1);
  });

  it('voids active row when daily wage is zero', async () => {
    const { upsertHourlyWageLedgerEntry } = await import('@/lib/services/employeeLedgerDualWrite');
    const pool = makePool(async (sqlText) => {
      expect(sqlText).toContain('IsVoided   = 1');
      return { rowsAffected: [1] };
    });

    const outcome = await upsertHourlyWageLedgerEntry(pool as never, {
      payrollId: 10,
      empId: 3,
      workDate: '2026-04-15',
      attendanceId: 55,
      dailyWage: 0,
    });

    expect(outcome).toBe('voided');
  });

  it('does not declare duplicate EmpID on the same request during insert path', async () => {
    const { upsertHourlyWageLedgerEntry } = await import('@/lib/services/employeeLedgerDualWrite');

    const pool = {
      request: vi.fn(() => {
        const declared = new Set<string>();
        const request = {
          input: vi.fn((name: string) => {
            if (declared.has(name)) {
              throw new Error(`The parameter name ${name} has already been declared. Parameter names must be unique`);
            }
            declared.add(name);
            return request;
          }),
          query: vi.fn(async (sqlText: string) => {
            if (sqlText.includes('UPDATE dbo.TblEmpLedgerEntry')) {
              return { rowsAffected: [0] };
            }
            return { rowsAffected: [1] };
          }),
        };
        return request;
      }),
    };

    const outcome = await upsertHourlyWageLedgerEntry(pool as never, {
      payrollId: 10,
      empId: 3,
      workDate: '2026-04-15',
      attendanceId: 55,
      dailyWage: 250,
    });

    expect(outcome).toBe('inserted');
    expect(pool.request).toHaveBeenCalledTimes(2);
  });
});

describe('syncHourlyWageLedgerForWorkDate', () => {
  it('creates one ledger write per generated payroll row', async () => {
    const { syncHourlyWageLedgerForWorkDate } = await import('@/lib/services/employeeLedgerDualWrite');

    let requestCount = 0;
    const pool = {
      request: vi.fn(() => {
        requestCount++;
        return {
          input: vi.fn().mockReturnThis(),
          query: vi.fn(async (sqlText: string) => {
            if (sqlText.includes('FROM dbo.TblEmpDailyPayroll')) {
              return {
                recordset: [
                  { payrollId: 1, empId: 1, workDate: '2026-04-15', attendanceId: 10, dailyWage: 100 },
                  { payrollId: 2, empId: 2, workDate: '2026-04-15', attendanceId: 11, dailyWage: 150 },
                ],
              };
            }
            if (sqlText.includes('UPDATE dbo.TblEmpLedgerEntry')) {
              return { rowsAffected: [0] };
            }
            if (sqlText.includes('INSERT INTO dbo.TblEmpLedgerEntry')) {
              return { rowsAffected: [1] };
            }
            return { recordset: [], rowsAffected: [0] };
          }),
        };
      }),
    };

    const result = await syncHourlyWageLedgerForWorkDate(pool as never, '2026-04-15');
    expect(result.inserted).toBe(2);
    expect(result.updated).toBe(0);
    expect(requestCount).toBeGreaterThanOrEqual(5);
  });

  it('updates existing ledger entry on regenerate instead of duplicating', async () => {
    const { syncHourlyWageLedgerForWorkDate } = await import('@/lib/services/employeeLedgerDualWrite');

    const pool = {
      request: vi.fn(() => ({
        input: vi.fn().mockReturnThis(),
        query: vi.fn(async (sqlText: string) => {
          if (sqlText.includes('FROM dbo.TblEmpDailyPayroll')) {
            return {
              recordset: [
                { payrollId: 1, empId: 1, workDate: '2026-04-15', attendanceId: 10, dailyWage: 200 },
              ],
            };
          }
          if (sqlText.includes('UPDATE dbo.TblEmpLedgerEntry')) {
            return { rowsAffected: [1] };
          }
          return { recordset: [], rowsAffected: [0] };
        }),
      })),
    };

    const result = await syncHourlyWageLedgerForWorkDate(pool as never, '2026-04-15');
    expect(result.updated).toBe(1);
    expect(result.inserted).toBe(0);
  });

  it('dual-writes multiple ledger rows inside a transaction without duplicate parameter errors', async () => {
    vi.resetModules();

    const queryImpl = async (sqlText: string) => {
      if (sqlText.includes('FROM dbo.TblEmpDailyPayroll')) {
        return {
          recordset: [
            { payrollId: 1, empId: 1, workDate: '2026-04-15', attendanceId: 10, dailyWage: 100 },
            { payrollId: 2, empId: 2, workDate: '2026-04-15', attendanceId: 11, dailyWage: 150 },
          ],
        };
      }
      if (sqlText.includes('UPDATE dbo.TblEmpLedgerEntry')) {
        return { rowsAffected: [0] };
      }
      if (sqlText.includes('INSERT INTO dbo.TblEmpLedgerEntry')) {
        return { rowsAffected: [1] };
      }
      return { recordset: [], rowsAffected: [0] };
    };

    class FakeRequest {
      private declared = new Set<string>();
      constructor(_tx?: unknown) {}
      input(name: string) {
        if (this.declared.has(name)) {
          throw new Error(`The parameter name ${name} has already been declared. Parameter names must be unique`);
        }
        this.declared.add(name);
        return this;
      }
      async query(sqlText: string) {
        return queryImpl(sqlText);
      }
    }

    vi.doMock('@/lib/db', () => ({
      getPool: vi.fn(),
      sql: {
        Request: FakeRequest,
        Transaction: class {},
        Int: () => ({}),
        Date: () => ({}),
        Decimal: () => ({}),
        NVarChar: () => ({}),
      },
    }));

    const { syncHourlyWageLedgerForWorkDate } = await import('@/lib/services/employeeLedgerDualWrite');
    const result = await syncHourlyWageLedgerForWorkDate(
      { request: vi.fn() } as never,
      '2026-04-15',
      {} as never,
    );

    expect(result.inserted).toBe(2);
    expect(result.updated).toBe(0);
  });
});

describe('runDailyPayrollGenerateWithOptionalLedger', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('skips ledger writes when feature flag is disabled', async () => {
    process.env.EMP_LEDGER_DUAL_WRITE_ENABLED = 'false';

    vi.doMock('@/lib/db', () => ({
      getPool: vi.fn(async () => ({ request: vi.fn() })),
      sql: {
        Transaction: class {
          async begin() {}
          async commit() {}
          async rollback() {}
        },
        Request: class {},
      },
    }));

    vi.doMock('@/lib/payroll/dailyPayrollGenerateCore', () => ({
      executeDailyPayrollGenerate: vi.fn(async () => ({
        workDate: '2026-04-15',
        generatedCount: 2,
        totalHours: 16,
        totalWage: 400,
        newRows: 2,
      })),
    }));

    const syncSpy = vi.fn();
    vi.doMock('@/lib/services/employeeLedgerDualWrite', async (importOriginal) => {
      const actual = await importOriginal<typeof import('@/lib/services/employeeLedgerDualWrite')>();
      return {
        ...actual,
        syncHourlyWageLedgerForWorkDate: syncSpy,
      };
    });

    const { runDailyPayrollGenerateWithOptionalLedger } = await import('@/lib/services/employeeLedgerDualWrite');
    const result = await runDailyPayrollGenerateWithOptionalLedger('2026-04-15');

    expect(result.ledgerDualWrite).toBe(false);
    expect(result.ledgerSync).toBeUndefined();
    expect(syncSpy).not.toHaveBeenCalled();
  });

  it('throws clear error when ledger table is missing and flag is enabled', async () => {
    process.env.EMP_LEDGER_DUAL_WRITE_ENABLED = 'true';

    vi.doMock('@/lib/db', () => ({
      getPool: vi.fn(async () => ({ request: vi.fn() })),
      sql: {
        Transaction: class {
          async begin() {}
          async commit() {}
          async rollback() {}
        },
        Request: class {},
      },
    }));

    vi.doMock('@/lib/payroll/dailyPayrollGenerateCore', () => ({
      executeDailyPayrollGenerate: vi.fn(async () => {
        throw new Error("Invalid object name 'dbo.TblEmpLedgerEntry'.");
      }),
    }));

    const { runDailyPayrollGenerateWithOptionalLedger, EmployeeLedgerDualWriteError } =
      await import('@/lib/services/employeeLedgerDualWrite');

    await expect(runDailyPayrollGenerateWithOptionalLedger('2026-04-15'))
      .rejects
      .toBeInstanceOf(EmployeeLedgerDualWriteError);
  });
});

describe('POST /api/payroll/daily/generate', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('returns ledgerDualWrite flag in success response', async () => {
    vi.doMock('@/lib/api-auth', () => ({
      isAuthResult: (v: { ok?: boolean }) => v?.ok === true,
      requirePageAccess: vi.fn(async () => ({
        ok: true,
        userId: 1,
        userName: 'Admin',
        userLevel: 'admin',
        roles: ['admin'],
        isSuperAdmin: false,
      })),
    }));

    vi.doMock('@/lib/db', () => ({
      getPool: vi.fn(async () => ({
        request: vi.fn(() => ({
          input: vi.fn().mockReturnThis(),
          query: vi.fn(async () => ({ recordset: [{ cnt: 0 }] })),
        })),
      })),
    }));

    vi.doMock('@/lib/payroll/dailyPayrollGenerateCore', () => ({
      countPostedDailyPayroll: vi.fn(async () => 0),
      validateDailyPayrollAttendance: vi.fn(async () => ({ missing: [], excluded: [] })),
    }));

    vi.doMock('@/lib/services/employeeLedgerDualWrite', () => ({
      EmployeeLedgerDualWriteError: class extends Error {},
      runDailyPayrollGenerateWithOptionalLedger: vi.fn(async () => ({
        result: {
          workDate: '2026-04-15',
          generatedCount: 1,
          totalHours: 8,
          totalWage: 200,
          newRows: 1,
        },
        ledgerDualWrite: true,
        ledgerSync: { inserted: 1, updated: 0, voided: 0, skipped: 0 },
      })),
    }));

    const { POST } = await import('@/app/api/payroll/daily/generate/route');
    const res = await POST(new NextRequest('http://localhost/api/payroll/daily/generate', {
      method: 'POST',
      body: JSON.stringify({ workDate: '2026-04-15' }),
    }));
    const data = await res.json();

    expect(res.status).toBe(201);
    expect(data.ledgerDualWrite).toBe(true);
    expect(data.ledgerSync.inserted).toBe(1);
  });

  it('returns 503 when ledger dual-write fails', async () => {
    vi.doMock('@/lib/api-auth', () => ({
      isAuthResult: (v: { ok?: boolean }) => v?.ok === true,
      requirePageAccess: vi.fn(async () => ({
        ok: true,
        userId: 1,
        userName: 'Admin',
        userLevel: 'admin',
        roles: ['admin'],
        isSuperAdmin: false,
      })),
    }));

    vi.doMock('@/lib/db', () => ({
      getPool: vi.fn(async () => ({
        request: vi.fn(() => ({
          input: vi.fn().mockReturnThis(),
          query: vi.fn(async () => ({ recordset: [{ cnt: 0 }] })),
        })),
      })),
    }));

    vi.doMock('@/lib/payroll/dailyPayrollGenerateCore', () => ({
      countPostedDailyPayroll: vi.fn(async () => 0),
      validateDailyPayrollAttendance: vi.fn(async () => ({ missing: [], excluded: [] })),
    }));

    class EmployeeLedgerDualWriteError extends Error {
      constructor(message: string) {
        super(message);
        this.name = 'EmployeeLedgerDualWriteError';
      }
    }

    vi.doMock('@/lib/services/employeeLedgerDualWrite', () => ({
      EmployeeLedgerDualWriteError,
      runDailyPayrollGenerateWithOptionalLedger: vi.fn(async () => {
        throw new EmployeeLedgerDualWriteError('جدول دفتر الموظفين غير موجود');
      }),
    }));

    const { POST } = await import('@/app/api/payroll/daily/generate/route');
    const res = await POST(new NextRequest('http://localhost/api/payroll/daily/generate', {
      method: 'POST',
      body: JSON.stringify({ workDate: '2026-04-15' }),
    }));
    const data = await res.json();

    expect(res.status).toBe(503);
    expect(data.error).toContain('دفتر الموظفين');
  });
});

describe('POST /api/payroll/daily/auto-generate', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('returns ledger sync counts when dual-write succeeds', async () => {
    vi.doMock('@/lib/db', () => ({
      getPool: vi.fn(async () => ({
        request: vi.fn(() => ({
          input: vi.fn().mockReturnThis(),
          query: vi.fn(async () => ({ recordset: [{ EmpID: 1, EmpName: 'A', HourlyRate: 50 }] })),
        })),
      })),
      sql: { Date: () => ({}), Bit: () => ({}), Int: () => ({}), Decimal: () => ({}), NVarChar: () => ({}) },
    }));

    vi.doMock('@/lib/payroll/dailyPayrollGenerateCore', () => ({
      countPostedDailyPayroll: vi.fn(async () => 0),
      countEligibleDailyPayrollEmployees: vi.fn(async () => 1),
      validateDailyPayrollAttendance: vi.fn(async () => ({ missing: [], excluded: [] })),
    }));

    vi.doMock('@/lib/services/employeeLedgerDualWrite', () => ({
      EmployeeLedgerDualWriteError: class extends Error {},
      runDailyPayrollGenerateWithOptionalLedger: vi.fn(async () => ({
        result: {
          workDate: '2026-04-15',
          generatedCount: 2,
          totalHours: 16,
          totalWage: 250,
          newRows: 2,
        },
        ledgerDualWrite: true,
        ledgerSync: { inserted: 2, updated: 0, voided: 0, skipped: 0 },
      })),
    }));

    vi.doMock('@/lib/api-auth', () => ({
      isSystemJobAuthResult: (v: { ok?: boolean }) => v?.ok === true,
      requireSystemJobAuth: vi.fn(async () => ({
        ok: true,
        userId: 0,
        userName: 'system-job',
        userLevel: 'admin',
        roles: ['system_job'],
        isSuperAdmin: true,
        via: 'cron_bearer',
      })),
    }));

    const { POST } = await import('@/app/api/payroll/daily/auto-generate/route');
    const res = await POST(new NextRequest('http://localhost/api/payroll/daily/auto-generate', {
      method: 'POST',
      body: JSON.stringify({ workDate: '2026-04-15' }),
    }));
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.ledgerDualWrite).toBe(true);
    expect(data.ledgerSync.inserted).toBe(2);
  });
});

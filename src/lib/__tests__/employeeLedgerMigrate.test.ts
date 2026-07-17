import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('server-only', () => ({}));

const readFileSync = vi.fn();
vi.mock('fs', () => ({
  readFileSync: (...args: unknown[]) => readFileSync(...args),
}));

function makePool(options: {
  tableExistsSequence?: boolean[];
  indexExistsSequence?: boolean[];
  fundingAllowedSequence?: boolean[];
  batchError?: {
    step: 'create_table' | 'create_unique_index' | 'update_entry_reason_check';
    error: Error & { number?: number };
  };
}) {
  let tableIdx = 0;
  let indexIdx = 0;
  let fundingIdx = 0;
  const tableSeq = options.tableExistsSequence ?? [false, true, true];
  const indexSeq = options.indexExistsSequence ?? [false, true];
  // Called 4 times: fundingBefore, tipBefore, fundingAfter, tipAfter
  const fundingSeq = options.fundingAllowedSequence ?? [false, false, true, true];
  let batchCalls = 0;

  return {
    request: vi.fn(() => ({
      query: vi.fn(async (sql: string) => {
        if (sql.includes('INFORMATION_SCHEMA.TABLES')) {
          const exists = tableSeq[Math.min(tableIdx, tableSeq.length - 1)];
          tableIdx++;
          return { recordset: exists ? [{ ok: 1 }] : [] };
        }
        if (sql.includes('UX_TblEmpLedgerEntry_ActiveRefReason')) {
          const exists = indexSeq[Math.min(indexIdx, indexSeq.length - 1)];
          indexIdx++;
          return { recordset: exists ? [{ ok: 1 }] : [] };
        }
        if (sql.includes('CK_TblEmpLedgerEntry_EntryReason')) {
          const allowed = fundingSeq[Math.min(fundingIdx, fundingSeq.length - 1)];
          fundingIdx++;
          return {
            recordset: [{
              definition: allowed
                ? "([EntryReason] IN (N'hourly_wage', N'employee_funding', N'tip'))"
                : "([EntryReason] IN (N'hourly_wage', N'advance'))",
            }],
          };
        }
        batchCalls++;
        if (options.batchError) {
          const step = options.batchError.step;
          if (
            (step === 'create_table' && batchCalls === 1)
            || (step === 'create_unique_index' && batchCalls === 2)
            || (step === 'update_entry_reason_check' && batchCalls === 3)
          ) {
            throw options.batchError.error;
          }
        }
        return { recordset: [] };
      }),
    })),
  };
}

describe('employeeLedgerMigrateService', () => {
  beforeEach(() => {
    vi.resetModules();
    readFileSync.mockReset();
    readFileSync.mockReturnValue('MIGRATION SQL');
  });

  it('extracts sql error number and message', async () => {
    const { extractSqlError } = await import('@/lib/services/employeeLedgerMigrateService');
    const err = Object.assign(new Error('Duplicate key'), { number: 2601 });
    expect(extractSqlError(err)).toEqual({ message: 'Duplicate key', number: 2601 });
  });

  it('splits migration SQL on GO batch separators', async () => {
    const { splitSqlBatches } = await import('@/lib/services/employeeLedgerMigrateService');
    const batches = splitSqlBatches(`
      SELECT 1;
      GO
      SELECT 2;
    `);
    expect(batches).toEqual(['SELECT 1;', 'SELECT 2;']);
  });

  it('runs migrations and reports created objects', async () => {
    vi.doMock('@/lib/db', () => ({
      getPool: vi.fn(async () => makePool({
        tableExistsSequence: [false, true],
        indexExistsSequence: [false, true],
        fundingAllowedSequence: [false, false, true, true],
      })),
    }));

    const { runEmployeeLedgerMigrations } = await import('@/lib/services/employeeLedgerMigrateService');
    const result = await runEmployeeLedgerMigrations();

    expect(result).toEqual({
      success: true,
      tableCreated: true,
      tableExists: true,
      uniqueIndexCreated: true,
      uniqueIndexExists: true,
      employeeFundingReasonAllowed: true,
      employeeTipReasonAllowed: true,
      entryReasonCheckUpdated: true,
    });
    expect(readFileSync).toHaveBeenCalledTimes(4);
  });

  it('reports exists when table and index already present', async () => {
    vi.doMock('@/lib/db', () => ({
      getPool: vi.fn(async () => makePool({
        tableExistsSequence: [true, true],
        indexExistsSequence: [true, true],
        fundingAllowedSequence: [true, true, true, true],
      })),
    }));

    const { runEmployeeLedgerMigrations } = await import('@/lib/services/employeeLedgerMigrateService');
    const result = await runEmployeeLedgerMigrations();

    expect(result).toEqual({
      success: true,
      tableCreated: false,
      tableExists: true,
      uniqueIndexCreated: false,
      uniqueIndexExists: true,
      employeeFundingReasonAllowed: true,
      employeeTipReasonAllowed: true,
      entryReasonCheckUpdated: false,
    });
  });

  it('returns failure when table migration fails', async () => {
    vi.doMock('@/lib/db', () => ({
      getPool: vi.fn(async () => makePool({
        batchError: {
          step: 'create_table',
          error: Object.assign(new Error('Invalid object name'), { number: 208 }),
        },
      })),
    }));

    const { runEmployeeLedgerMigrations } = await import('@/lib/services/employeeLedgerMigrateService');
    const result = await runEmployeeLedgerMigrations();

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.failedStep).toBe('create_table');
      expect(result.sqlError.message).toContain('Invalid object name');
      expect(result.sqlError.number).toBe(208);
    }
  });

  it('returns failure when unique index migration fails', async () => {
    vi.doMock('@/lib/db', () => ({
      getPool: vi.fn(async () => makePool({
        tableExistsSequence: [true, true],
        indexExistsSequence: [false],
        batchError: {
          step: 'create_unique_index',
          error: Object.assign(new Error('Index already exists'), { number: 1913 }),
        },
      })),
    }));

    const { runEmployeeLedgerMigrations } = await import('@/lib/services/employeeLedgerMigrateService');
    const result = await runEmployeeLedgerMigrations();

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.failedStep).toBe('create_unique_index');
      expect(result.sqlError.number).toBe(1913);
    }
  });

  it('returns failure when entry-reason check migration fails', async () => {
    vi.doMock('@/lib/db', () => ({
      getPool: vi.fn(async () => makePool({
        tableExistsSequence: [true, true],
        indexExistsSequence: [true, true],
        fundingAllowedSequence: [false],
        batchError: {
          step: 'update_entry_reason_check',
          error: Object.assign(new Error('CHECK constraint conflict'), { number: 547 }),
        },
      })),
    }));

    const { runEmployeeLedgerMigrations } = await import('@/lib/services/employeeLedgerMigrateService');
    const result = await runEmployeeLedgerMigrations();

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.failedStep).toBe('update_entry_reason_check');
      expect(result.sqlError.number).toBe(547);
    }
  });
});

describe('POST /api/admin/hr/employee-ledger/migrate', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('returns success payload from migration service', async () => {
    vi.doMock('@/lib/api-auth', () => ({
      requirePageAccess: vi.fn(async () => ({ ok: true, userId: 1 })),
      isAuthResult: vi.fn().mockReturnValue(true),
    }));
    vi.doMock('@/lib/services/employeeLedgerMigrateService', () => ({
      runEmployeeLedgerMigrations: vi.fn(async () => ({
        success: true,
        tableCreated: false,
        tableExists: true,
        uniqueIndexCreated: false,
        uniqueIndexExists: true,
      })),
    }));

    const { POST } = await import('@/app/api/admin/hr/employee-ledger/migrate/route');
    const res = await POST(new NextRequest('http://localhost/api/admin/hr/employee-ledger/migrate', {
      method: 'POST',
    }));
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.tableExists).toBe(true);
    expect(data.uniqueIndexExists).toBe(true);
  });

  it('returns 500 with failedStep on migration failure', async () => {
    vi.doMock('@/lib/api-auth', () => ({
      requirePageAccess: vi.fn(async () => ({ ok: true, userId: 1 })),
      isAuthResult: vi.fn().mockReturnValue(true),
    }));
    vi.doMock('@/lib/services/employeeLedgerMigrateService', () => ({
      runEmployeeLedgerMigrations: vi.fn(async () => ({
        success: false,
        failedStep: 'create_unique_index',
        sqlError: { message: 'duplicate key', number: 2601 },
      })),
    }));

    const { POST } = await import('@/app/api/admin/hr/employee-ledger/migrate/route');
    const res = await POST(new NextRequest('http://localhost/api/admin/hr/employee-ledger/migrate', {
      method: 'POST',
    }));
    const data = await res.json();

    expect(res.status).toBe(500);
    expect(data.success).toBe(false);
    expect(data.failedStep).toBe('create_unique_index');
    expect(data.sqlError.number).toBe(2601);
  });

  it('allows ADMIN_SETUP_SECRET without session', async () => {
    const original = process.env.ADMIN_SETUP_SECRET;
    process.env.ADMIN_SETUP_SECRET = 'test-setup-secret';

    vi.doMock('@/lib/api-auth', () => ({
      requirePageAccess: vi.fn(async () => {
        throw new Error('should not require session when setup secret matches');
      }),
      isAuthResult: vi.fn().mockReturnValue(true),
    }));
    vi.doMock('@/lib/services/employeeLedgerMigrateService', () => ({
      runEmployeeLedgerMigrations: vi.fn(async () => ({
        success: true,
        tableCreated: false,
        tableExists: true,
        uniqueIndexCreated: false,
        uniqueIndexExists: true,
      })),
    }));

    const { POST } = await import('@/app/api/admin/hr/employee-ledger/migrate/route');
    const res = await POST(new NextRequest('http://localhost/api/admin/hr/employee-ledger/migrate', {
      method: 'POST',
      headers: { 'x-admin-setup-secret': 'test-setup-secret' },
    }));

    if (original === undefined) {
      delete process.env.ADMIN_SETUP_SECRET;
    } else {
      process.env.ADMIN_SETUP_SECRET = original;
    }

    expect(res.status).toBe(200);
  });
});

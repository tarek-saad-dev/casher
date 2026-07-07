import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('server-only', () => ({}));

const mockQuery = vi.fn();
let lastInputs: Record<string, unknown> = {};

function makeRequest() {
  const chain = {
    input: vi.fn((name: string, _type: unknown, value: unknown) => {
      lastInputs[name] = value;
      return chain;
    }),
    query: mockQuery,
  };
  return chain;
}

const mockPool = { request: vi.fn(() => makeRequest()) };

vi.mock('@/lib/db', () => ({
  getPool: vi.fn(async () => mockPool),
  sql: {
    NVarChar: (n: number) => `NVarChar(${n})`,
    Int: 'Int',
    Bit: 'Bit',
  },
}));

vi.mock('@/lib/api-auth', () => ({
  requireRole: vi.fn(async () => ({ userId: 1 })),
  isAuthResult: () => true,
}));

const ALL_TABLES = [
  'TblAccountingCategoryClassificationMap',
  'TblAccountingKeywordClassificationRule',
  'TblAccountingEmployeeAlias',
] as const;

function mockTablesExist(existing: Set<string>) {
  mockQuery.mockImplementation(async (sqlText: string) => {
    if (sqlText.includes('INFORMATION_SCHEMA.TABLES') && sqlText.includes('@TableName')) {
      const table = String(lastInputs.TableName ?? '');
      return { recordset: existing.has(table) ? [{ x: 1 }] : [] };
    }
    if (sqlText.includes('CREATE TABLE') || sqlText.includes('CREATE INDEX')) {
      if (sqlText.includes('TblAccountingCategoryClassificationMap')) existing.add('TblAccountingCategoryClassificationMap');
      if (sqlText.includes('TblAccountingKeywordClassificationRule')) existing.add('TblAccountingKeywordClassificationRule');
      if (sqlText.includes('TblAccountingEmployeeAlias')) existing.add('TblAccountingEmployeeAlias');
      return { recordset: [] };
    }
    if (sqlText.includes('SELECT 1 AS x FROM dbo.TblAccountingKeywordClassificationRule WHERE Keyword')) {
      return { recordset: [{ x: 1 }] };
    }
    if (sqlText.includes('SELECT 1 AS x FROM dbo.TblAccountingCategoryClassificationMap WHERE ExpINID')) {
      return { recordset: [{ x: 1 }] };
    }
    if (sqlText.includes('FROM dbo.TblExpINCat')) return { recordset: [] };
    if (sqlText.includes('FROM dbo.TblEmp')) return { recordset: [{ EmpID: 1, EmpName: 'Test' }] };
    return { recordset: [] };
  });
}

describe('accounting settings migration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    lastInputs = {};
    mockPool.request.mockImplementation(() => makeRequest());
  });

  it('extractSqlError surfaces mssql error fields', async () => {
    const { extractSqlError } = await import('@/lib/accounting/accountingSettingsMigration');
    const err = extractSqlError({
      message: 'outer',
      number: 102,
      lineNumber: 12,
      originalError: { message: "Incorrect syntax near ';'", number: 102, lineNumber: 12 },
    });
    expect(err.message).toContain('Incorrect syntax');
    expect(err.number).toBe(102);
    expect(err.lineNumber).toBe(12);
  });

  it('getAccountingSettingsMigrationStatus reports migrationRequired when tables missing', async () => {
    mockTablesExist(new Set());
    const { getAccountingSettingsMigrationStatus } = await import('@/lib/accounting/accountingSettingsMigration');
    const status = await getAccountingSettingsMigrationStatus();
    expect(status.migrationRequired).toBe(true);
    expect(status.tablesExist).toBe(false);
    expect(status.missingTables).toHaveLength(3);
    expect(status.existingTables).toHaveLength(0);
  });

  it('getAccountingSettingsMigrationStatus reports ready when all tables exist', async () => {
    mockTablesExist(new Set(ALL_TABLES));
    const { getAccountingSettingsMigrationStatus } = await import('@/lib/accounting/accountingSettingsMigration');
    const status = await getAccountingSettingsMigrationStatus();
    expect(status.migrationRequired).toBe(false);
    expect(status.tablesExist).toBe(true);
    expect(status.missingTables).toHaveLength(0);
  });

  it('ensureAccountingSettingsTablesExist runs DDL steps as separate queries', async () => {
    const existing = new Set<string>();
    const ddlCalls: string[] = [];
    mockQuery.mockImplementation(async (sqlText: string) => {
      if (sqlText.includes('CREATE TABLE') || sqlText.includes('CREATE INDEX')) {
        ddlCalls.push(sqlText);
      }
      if (sqlText.includes('INFORMATION_SCHEMA.TABLES') && sqlText.includes('@TableName')) {
        const table = String(lastInputs.TableName ?? '');
        return { recordset: existing.has(table) ? [{ x: 1 }] : [] };
      }
      if (sqlText.includes('CREATE TABLE dbo.TblAccountingCategoryClassificationMap')) existing.add('TblAccountingCategoryClassificationMap');
      if (sqlText.includes('CREATE TABLE dbo.TblAccountingKeywordClassificationRule')) existing.add('TblAccountingKeywordClassificationRule');
      if (sqlText.includes('CREATE TABLE dbo.TblAccountingEmployeeAlias')) existing.add('TblAccountingEmployeeAlias');
      return { recordset: [] };
    });

    const { ensureAccountingSettingsTablesExist } = await import('@/lib/accounting/accountingSettingsMigration');
    const result = await ensureAccountingSettingsTablesExist();
    expect(result.success).toBe(true);
    expect(ddlCalls.length).toBeGreaterThanOrEqual(3);
    expect(ddlCalls.every((s) => !s.trim().endsWith(';'))).toBe(true);
  });

  it('seedDefaultClassificationSettings skips existing keywords (no duplicates)', async () => {
    mockTablesExist(new Set(ALL_TABLES));
    const { seedDefaultClassificationSettings } = await import('@/lib/accounting/accountingSettingsService');
    const result = await seedDefaultClassificationSettings(1);
    expect(result.seededRows.keywords).toBe(0);
    expect(result.skippedSeeds.length).toBeGreaterThan(0);
    const inserts = mockQuery.mock.calls.filter(([sql]) =>
      String(sql).includes('INSERT INTO dbo.TblAccountingKeywordClassificationRule'),
    );
    expect(inserts).toHaveLength(0);
  });

  it('GET category-mappings returns 200 with migrationRequired before migration', async () => {
    mockTablesExist(new Set());
    const { GET } = await import('@/app/api/admin/accounting/classification-settings/category-mappings/route');
    const res = await GET(new Request('http://localhost/api') as any);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.rows).toEqual([]);
    expect(body.meta.migrationRequired).toBe(true);
  });

  it('GET keyword-rules returns 200 with empty rules before migration', async () => {
    mockTablesExist(new Set());
    const { GET } = await import('@/app/api/admin/accounting/classification-settings/keyword-rules/route');
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.rules).toEqual([]);
    expect(body.meta.migrationRequired).toBe(true);
  });

  it('GET employee-aliases returns 200 with empty aliases before migration', async () => {
    mockTablesExist(new Set());
    const { GET } = await import('@/app/api/admin/accounting/classification-settings/employee-aliases/route');
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.aliases).toEqual([]);
    expect(body.employees).toHaveLength(1);
    expect(body.meta.migrationRequired).toBe(true);
  });

  it('runFullAccountingSettingsMigration is idempotent on second call', async () => {
    const existing = new Set<string>();
    mockQuery.mockImplementation(async (sqlText: string) => {
      if (sqlText.includes('INFORMATION_SCHEMA.TABLES') && sqlText.includes('@TableName')) {
        const table = String(lastInputs.TableName ?? '');
        return { recordset: existing.has(table) ? [{ x: 1 }] : [] };
      }
      if (sqlText.includes('CREATE TABLE dbo.TblAccountingCategoryClassificationMap')) existing.add('TblAccountingCategoryClassificationMap');
      if (sqlText.includes('CREATE TABLE dbo.TblAccountingKeywordClassificationRule')) existing.add('TblAccountingKeywordClassificationRule');
      if (sqlText.includes('CREATE TABLE dbo.TblAccountingEmployeeAlias')) existing.add('TblAccountingEmployeeAlias');
      if (sqlText.includes('SELECT 1 AS x FROM dbo.TblAccountingKeywordClassificationRule WHERE Keyword')) {
        return { recordset: [{ x: 1 }] };
      }
      if (sqlText.includes('FROM dbo.TblExpINCat')) return { recordset: [] };
      return { recordset: [] };
    });

    const { runFullAccountingSettingsMigration } = await import('@/lib/accounting/accountingSettingsService');
    const first = await runFullAccountingSettingsMigration(1);
    const second = await runFullAccountingSettingsMigration(1);
    expect(first.success).toBe(true);
    expect(second.success).toBe(true);
    expect(second.seededRows.keywords).toBe(0);
  });
});

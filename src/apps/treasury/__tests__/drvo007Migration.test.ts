import { describe, expect, it, vi, beforeEach } from 'vitest';

type QueryHandler = (sql: string) => Promise<{ recordset: Array<Record<string, unknown>> }>;

function makePool(options: {
  tables?: Set<string>;
  indexes?: Set<string>;
  foreignKeys?: Set<string>;
  columns?: Set<string>;
  tenantBootstrap?: boolean;
  tblCashMovePk?: { typeName: string; isNullable: number } | null;
  batchError?: { stepMatch: string; error: Error & { number?: number; lineNumber?: number; state?: number } };
  onBatch?: (sql: string) => void;
}) {
  const tables = new Set(options.tables ?? ['TblCashMove', 'Tenant', 'TreasuryMovementRegistry']);
  const indexes = new Set(options.indexes ?? [
    'TreasuryMovementRegistry:UX_TreasuryMovementRegistry_Tenant_Idempotency',
    'TreasuryMovementRegistry:IX_TreasuryMovementRegistry_CashMove',
    'TreasuryMovementRegistry:IX_TreasuryMovementRegistry_TransferGroup',
  ]);
  const foreignKeys = new Set(options.foreignKeys ?? [
    'FK_TreasuryMovementRegistry_Tenant',
    'FK_TreasuryMovementRegistry_CashMove',
    'FK_TblCashMove_ReversalOf',
  ]);
  const columns = new Set(options.columns ?? [
    'TblCashMove:ReversalOfCashMoveId',
    'TblCashMove:IsReversed',
  ]);
  const tenantBootstrap = options.tenantBootstrap ?? true;
  const tblCashMovePk = options.tblCashMovePk ?? { typeName: 'int', isNullable: 0 };

  return {
    request: vi.fn(() => ({
      batch: vi.fn(async (sql: string) => {
        options.onBatch?.(sql);
        if (options.batchError && sql.includes(options.batchError.stepMatch)) {
          throw options.batchError.error;
        }
        if (sql.includes('CREATE TABLE dbo.Tenant')) tables.add('Tenant');
        if (sql.includes('INSERT INTO dbo.Tenant')) {
          // bootstrap row inserted
        }
        if (sql.includes('CREATE TABLE dbo.TreasuryMovementRegistry')) tables.add('TreasuryMovementRegistry');
        if (sql.includes('UX_TreasuryMovementRegistry_Tenant_Idempotency')) {
          indexes.add('TreasuryMovementRegistry:UX_TreasuryMovementRegistry_Tenant_Idempotency');
        }
        if (sql.includes('IX_TreasuryMovementRegistry_CashMove')) {
          indexes.add('TreasuryMovementRegistry:IX_TreasuryMovementRegistry_CashMove');
        }
        if (sql.includes('IX_TreasuryMovementRegistry_TransferGroup')) {
          indexes.add('TreasuryMovementRegistry:IX_TreasuryMovementRegistry_TransferGroup');
        }
        if (sql.includes('FK_TreasuryMovementRegistry_Tenant')) foreignKeys.add('FK_TreasuryMovementRegistry_Tenant');
        if (sql.includes('FK_TreasuryMovementRegistry_CashMove')) foreignKeys.add('FK_TreasuryMovementRegistry_CashMove');
        if (sql.includes('ReversalOfCashMoveId')) columns.add('TblCashMove:ReversalOfCashMoveId');
        if (sql.includes('IsReversed')) columns.add('TblCashMove:IsReversed');
        if (sql.includes('FK_TblCashMove_ReversalOf')) foreignKeys.add('FK_TblCashMove_ReversalOf');
      }),
      query: vi.fn(async (sql: string) => {
        if (sql.includes('INFORMATION_SCHEMA.TABLES')) {
          const match = sql.match(/TABLE_NAME = N'([^']+)'/);
          const table = match?.[1] ?? '';
          return { recordset: tables.has(table) ? [{ ok: 1 }] : [] };
        }
        if (sql.includes('sys.indexes i') && sql.includes('i.name = N')) {
          const tableMatch = sql.match(/o\.name = N'([^']+)'/);
          const indexMatch = sql.match(/i\.name = N'([^']+)'/);
          const key = `${tableMatch?.[1]}:${indexMatch?.[1]}`;
          return { recordset: indexes.has(key) ? [{ ok: 1 }] : [] };
        }
        if (sql.includes('sys.foreign_keys WHERE name = N')) {
          const match = sql.match(/name = N'([^']+)'/);
          const fk = match?.[1] ?? '';
          return { recordset: foreignKeys.has(fk) ? [{ ok: 1 }] : [] };
        }
        if (sql.includes('COL_LENGTH(N')) {
          const match = sql.match(/N'dbo\.([^']+)', N'([^']+)'/);
          const key = `${match?.[1]}:${match?.[2]}`;
          return { recordset: columns.has(key) ? [{ ok: 1 }] : [] };
        }
        if (sql.includes("Code = N'CASHER_BOOT'")) {
          return { recordset: tenantBootstrap ? [{ ok: 1 }] : [] };
        }
        if (sql.includes('TblCashMove') && sql.includes('is_primary_key = 1')) {
          return { recordset: tblCashMovePk ? [tblCashMovePk] : [] };
        }
        return { recordset: [] };
      }),
    })),
  };
}

describe('drvo007Migration', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('extractSqlError surfaces nested mssql fields and constraint name', async () => {
    const { extractSqlError } = await import('../../../../scripts/drvo007Migration');
    const err = extractSqlError({
      message: 'Could not create constraint or index.',
      number: 1750,
      precedingErrors: [{
        message: 'Could not create constraint. See previous errors.',
        number: 1750,
      }],
      originalError: {
        message: 'Foreign key references invalid table dbo.Tenant.',
        number: 1767,
        lineNumber: 18,
        state: 1,
      },
    });
    expect(err.number).toBe(1767);
    expect(err.lineNumber).toBe(18);
    expect(err.message).toContain('Foreign key');
  });

  it('formatSqlErrorContext includes step and sql details', async () => {
    const { formatSqlErrorContext } = await import('../../../../scripts/drvo007Migration');
    const text = formatSqlErrorContext('fk_FK_TreasuryMovementRegistry_Tenant', {
      message: 'Could not create constraint or index.',
      number: 1750,
      originalError: { message: 'FK_TreasuryMovementRegistry_Tenant references missing object', number: 1767, lineNumber: 4 },
    });
    expect(text).toContain('fk_FK_TreasuryMovementRegistry_Tenant');
    expect(text).toContain('1767');
    expect(text).toContain('line 4');
  });

  it('preflight warns on legacy schema without Tenant table', async () => {
    const pool = makePool({
      tables: new Set(['TblCashMove']),
      indexes: new Set(),
      foreignKeys: new Set(),
      columns: new Set(),
      tenantBootstrap: false,
    });
    const { runDrvo007Preflight } = await import('../../../../scripts/drvo007Migration');
    const report = await runDrvo007Preflight(pool);
    expect(report.tenantTableExists).toBe(false);
    expect(report.blockers).toHaveLength(0);
    expect(report.warnings.some((w) => w.includes('Tenant is missing'))).toBe(true);
  });

  it('preflight warns when registry table exists but an index is missing', async () => {
    const pool = makePool({
      indexes: new Set(['TreasuryMovementRegistry:IX_TreasuryMovementRegistry_CashMove']),
    });
    const { runDrvo007Preflight } = await import('../../../../scripts/drvo007Migration');
    const report = await runDrvo007Preflight(pool);
    expect(report.registryTableExists).toBe(true);
    expect(report.registryIndexes.UX_TreasuryMovementRegistry_Tenant_Idempotency).toBe(false);
    expect(report.warnings.some((w) => w.includes('UX_TreasuryMovementRegistry_Tenant_Idempotency'))).toBe(true);
  });

  it('applies minimal Tenant prerequisite on legacy production-shaped schema', async () => {
    const batches: string[] = [];
    const pool = makePool({
      tables: new Set(['TblCashMove']),
      indexes: new Set(),
      foreignKeys: new Set(),
      columns: new Set(),
      tenantBootstrap: false,
      onBatch: (sql) => batches.push(sql),
    });
    const { applyDrvo007TreasuryMigration } = await import('../../../../scripts/drvo007Migration');
    await applyDrvo007TreasuryMigration(pool);
    expect(batches.some((sql) => sql.includes('CREATE TABLE dbo.Tenant'))).toBe(true);
    expect(batches.some((sql) => sql.includes('CREATE TABLE dbo.TreasuryMovementRegistry'))).toBe(true);
    expect(batches.some((sql) => sql.includes('FK_TreasuryMovementRegistry_Tenant'))).toBe(true);
  });

  it('completes missing registry index on partial migration state', async () => {
    const batches: string[] = [];
    const pool = makePool({
      indexes: new Set(['TreasuryMovementRegistry:IX_TreasuryMovementRegistry_CashMove']),
      onBatch: (sql) => batches.push(sql),
    });
    const { applyDrvo007TreasuryMigration } = await import('../../../../scripts/drvo007Migration');
    await applyDrvo007TreasuryMigration(pool);
    expect(batches.some((sql) => sql.includes('UX_TreasuryMovementRegistry_Tenant_Idempotency'))).toBe(true);
    expect(batches.some((sql) => sql.includes('CREATE TABLE dbo.TreasuryMovementRegistry'))).toBe(false);
  });

  it('skips reversal columns when already present', async () => {
    const batches: string[] = [];
    const pool = makePool({ onBatch: (sql) => batches.push(sql) });
    const { applyDrvo007TreasuryMigration } = await import('../../../../scripts/drvo007Migration');
    await applyDrvo007TreasuryMigration(pool);
    expect(batches.some((sql) => sql.includes('ReversalOfCashMoveId'))).toBe(false);
    expect(batches.some((sql) => sql.includes('IsReversed'))).toBe(false);
  });

  it('is idempotent on second run', async () => {
    const pool = makePool({});
    const { applyDrvo007TreasuryMigration } = await import('../../../../scripts/drvo007Migration');
    await applyDrvo007TreasuryMigration(pool);
    const batch = pool.request().batch as ReturnType<typeof vi.fn>;
    const callsAfterFirst = batch.mock.calls.length;
    await applyDrvo007TreasuryMigration(pool);
    expect(batch.mock.calls.length).toBe(callsAfterFirst);
  });

  it('propagates detailed SQL failure instead of collapsing to generic message', async () => {
    const pool = makePool({
      tables: new Set(['TblCashMove']),
      indexes: new Set(),
      foreignKeys: new Set(),
      columns: new Set(),
      tenantBootstrap: false,
      batchError: {
        stepMatch: 'FK_TreasuryMovementRegistry_Tenant',
        error: Object.assign(new Error('Could not create constraint or index.'), {
          number: 1750,
          originalError: {
            message: 'Foreign key FK_TreasuryMovementRegistry_Tenant references invalid table dbo.Tenant.',
            number: 1767,
            lineNumber: 12,
            state: 0,
          },
        }),
      },
    });
    const { applyDrvo007TreasuryMigration } = await import('../../../../scripts/drvo007Migration');
    await expect(applyDrvo007TreasuryMigration(pool)).rejects.toThrow(/1767[\s\S]*line 12/);
  });

  it('keeps SQL batches idempotent for manual inspection', async () => {
    const { readDrvo007MigrationBatches } = await import('../../../../scripts/drvo007Migration');
    const batches = readDrvo007MigrationBatches().join('\n');
    expect(batches).toContain('TreasuryMovementRegistry');
    expect(batches).toContain('COL_LENGTH');
    expect(batches).toContain('ReversalOfCashMoveId');
    expect(batches).toContain('FK_TreasuryMovementRegistry_Tenant');
    expect(batches).toContain('sys.indexes');
  });
});

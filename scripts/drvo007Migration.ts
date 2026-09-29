import fs from 'fs';
import path from 'path';

type SqlBatchRunner = {
  request: () => {
    batch: (sqlText: string) => Promise<unknown>;
    query: (sqlText: string) => Promise<{ recordset: Array<Record<string, unknown>> }>;
  };
};

export type SqlErrorInfo = {
  message: string;
  number?: number;
  lineNumber?: number;
  state?: number;
  constraint?: string;
};

export type MigrationStepOutcome = {
  step: string;
  action: 'applied' | 'skipped' | 'verified';
  detail?: string;
};

export type Drvo007PreflightReport = {
  tenantTableExists: boolean;
  tenantBootstrapRowExists: boolean;
  tblCashMoveExists: boolean;
  tblCashMoveIdIsIntPrimaryKey: boolean;
  registryTableExists: boolean;
  registryIndexes: Record<string, boolean>;
  registryForeignKeys: Record<string, boolean>;
  reversalOfColumnExists: boolean;
  isReversedColumnExists: boolean;
  reversalForeignKeyExists: boolean;
  blockers: string[];
  warnings: string[];
};

const BOOTSTRAP_TENANT_CODE = 'CASHER_BOOT';
const BOOTSTRAP_TENANT_NAME = 'Casher Bootstrap Tenant';

const REGISTRY_INDEXES = [
  'UX_TreasuryMovementRegistry_Tenant_Idempotency',
  'IX_TreasuryMovementRegistry_CashMove',
  'IX_TreasuryMovementRegistry_TransferGroup',
] as const;

const REGISTRY_FOREIGN_KEYS = [
  'FK_TreasuryMovementRegistry_Tenant',
  'FK_TreasuryMovementRegistry_CashMove',
] as const;

export function readDrvo007MigrationBatches(): string[] {
  const file = path.join(__dirname, '..', 'db/migrations/add-drvo-007-treasury-movement-registry.sql');
  const text = fs.readFileSync(file, 'utf8');
  return text.split(/^\s*GO\s*$/gim).map((batch) => batch.trim()).filter(Boolean);
}

export function extractSqlError(error: unknown): SqlErrorInfo {
  if (error && typeof error === 'object') {
    const e = error as Record<string, unknown>;
    const orig = e.originalError as Record<string, unknown> | undefined;
    const preceding = Array.isArray(e.precedingErrors) && e.precedingErrors.length
      ? (e.precedingErrors[0] as Record<string, unknown>)
      : undefined;
    const src = (orig && typeof orig === 'object' ? orig : undefined)
      ?? preceding
      ?? e;
    const message = String(src.message ?? e.message ?? 'Unknown SQL error');
    const constraintMatch = message.match(/constraint "([^"]+)"/i)
      ?? message.match(/CONSTRAINT '([^']+)'/i);
    return {
      message,
      number: typeof src.number === 'number'
        ? src.number
        : typeof e.number === 'number'
          ? e.number
          : undefined,
      lineNumber: typeof src.lineNumber === 'number'
        ? src.lineNumber
        : typeof e.lineNumber === 'number'
          ? e.lineNumber
          : undefined,
      state: typeof src.state === 'number'
        ? src.state
        : typeof e.state === 'number'
          ? e.state
          : undefined,
      constraint: constraintMatch?.[1],
    };
  }
  return { message: error instanceof Error ? error.message : String(error) };
}

export function formatSqlErrorContext(step: string, error: unknown): string {
  const info = extractSqlError(error);
  const parts = [
    `DRVO-007 migration failed at step "${step}"`,
    info.number != null ? `SQL error ${info.number}` : null,
    info.state != null ? `state ${info.state}` : null,
    info.lineNumber != null ? `line ${info.lineNumber}` : null,
    info.constraint ? `constraint ${info.constraint}` : null,
    info.message,
  ].filter(Boolean);
  return parts.join(' | ');
}

async function tableExists(pool: SqlBatchRunner, tableName: string): Promise<boolean> {
  const result = await pool.request().query(`
    SELECT 1 AS ok
    FROM INFORMATION_SCHEMA.TABLES
    WHERE TABLE_SCHEMA = N'dbo' AND TABLE_NAME = N'${tableName.replace(/'/g, "''")}'
  `);
  return result.recordset.length > 0;
}

async function indexExists(pool: SqlBatchRunner, tableName: string, indexName: string): Promise<boolean> {
  const result = await pool.request().query(`
    SELECT 1 AS ok
    FROM sys.indexes i
    INNER JOIN sys.objects o ON o.object_id = i.object_id
    WHERE o.name = N'${tableName.replace(/'/g, "''")}'
      AND i.name = N'${indexName.replace(/'/g, "''")}'
  `);
  return result.recordset.length > 0;
}

async function foreignKeyExists(pool: SqlBatchRunner, fkName: string): Promise<boolean> {
  const result = await pool.request().query(`
    SELECT 1 AS ok FROM sys.foreign_keys WHERE name = N'${fkName.replace(/'/g, "''")}'
  `);
  return result.recordset.length > 0;
}

async function columnExists(pool: SqlBatchRunner, tableName: string, columnName: string): Promise<boolean> {
  const result = await pool.request().query(`
    SELECT 1 AS ok
    WHERE COL_LENGTH(N'dbo.${tableName}', N'${columnName.replace(/'/g, "''")}') IS NOT NULL
  `);
  return result.recordset.length > 0;
}

export async function runDrvo007Preflight(pool: SqlBatchRunner): Promise<Drvo007PreflightReport> {
  const tenantTableExists = await tableExists(pool, 'Tenant');
  const tblCashMoveExists = await tableExists(pool, 'TblCashMove');
  const registryTableExists = await tableExists(pool, 'TreasuryMovementRegistry');

  let tenantBootstrapRowExists = false;
  if (tenantTableExists) {
    const tenantRow = await pool.request().query(`
      SELECT TOP 1 1 AS ok
      FROM dbo.Tenant
      WHERE Code = N'${BOOTSTRAP_TENANT_CODE}' AND Status = N'active'
    `);
    tenantBootstrapRowExists = tenantRow.recordset.length > 0;
  }

  let tblCashMoveIdIsIntPrimaryKey = false;
  if (tblCashMoveExists) {
    const pk = await pool.request().query(`
      SELECT TOP 1 t.name AS typeName, c.is_nullable AS isNullable
      FROM sys.indexes i
      INNER JOIN sys.index_columns ic ON ic.object_id = i.object_id AND ic.index_id = i.index_id
      INNER JOIN sys.columns c ON c.object_id = ic.object_id AND c.column_id = ic.column_id
      INNER JOIN sys.types t ON t.user_type_id = c.user_type_id
      WHERE i.object_id = OBJECT_ID(N'dbo.TblCashMove')
        AND i.is_primary_key = 1
        AND c.name = N'ID'
    `);
    const row = pk.recordset[0];
    tblCashMoveIdIsIntPrimaryKey = row?.typeName === 'int' && Number(row.isNullable) === 0;
  }

  const registryIndexes = Object.fromEntries(
    await Promise.all(
      REGISTRY_INDEXES.map(async (name) => [name, await indexExists(pool, 'TreasuryMovementRegistry', name)]),
    ),
  ) as Record<string, boolean>;

  const registryForeignKeys = Object.fromEntries(
    await Promise.all(
      REGISTRY_FOREIGN_KEYS.map(async (name) => [name, await foreignKeyExists(pool, name)]),
    ),
  ) as Record<string, boolean>;

  const reversalOfColumnExists = tblCashMoveExists
    ? await columnExists(pool, 'TblCashMove', 'ReversalOfCashMoveId')
    : false;
  const isReversedColumnExists = tblCashMoveExists
    ? await columnExists(pool, 'TblCashMove', 'IsReversed')
    : false;
  const reversalForeignKeyExists = await foreignKeyExists(pool, 'FK_TblCashMove_ReversalOf');

  const blockers: string[] = [];
  const warnings: string[] = [];

  if (!tblCashMoveExists) {
    blockers.push('dbo.TblCashMove is missing');
  } else if (!tblCashMoveIdIsIntPrimaryKey) {
    blockers.push('dbo.TblCashMove.ID is not a non-null INT primary key');
  }

  if (!tenantTableExists) {
    warnings.push('dbo.Tenant is missing; minimal Platform Core Tenant table will be created before Treasury FKs');
  } else if (!tenantBootstrapRowExists) {
    warnings.push(`dbo.Tenant has no active ${BOOTSTRAP_TENANT_CODE} row; bootstrap tenant row will be inserted if table is empty`);
  }

  if (registryTableExists) {
    for (const indexName of REGISTRY_INDEXES) {
      if (!registryIndexes[indexName]) {
        warnings.push(`TreasuryMovementRegistry exists but index ${indexName} is missing`);
      }
    }
    for (const fkName of REGISTRY_FOREIGN_KEYS) {
      if (!registryForeignKeys[fkName]) {
        warnings.push(`TreasuryMovementRegistry exists but foreign key ${fkName} is missing`);
      }
    }
  }

  if (reversalOfColumnExists !== isReversedColumnExists) {
    warnings.push('TblCashMove reversal columns are partially present');
  }
  if (reversalOfColumnExists && !reversalForeignKeyExists) {
    warnings.push('TblCashMove.ReversalOfCashMoveId exists but FK_TblCashMove_ReversalOf is missing');
  }

  return {
    tenantTableExists,
    tenantBootstrapRowExists,
    tblCashMoveExists,
    tblCashMoveIdIsIntPrimaryKey,
    registryTableExists,
    registryIndexes,
    registryForeignKeys,
    reversalOfColumnExists,
    isReversedColumnExists,
    reversalForeignKeyExists,
    blockers,
    warnings,
  };
}

async function runStep(
  pool: SqlBatchRunner,
  step: string,
  sqlText: string,
  skip?: () => Promise<boolean>,
): Promise<MigrationStepOutcome> {
  if (skip && await skip()) {
    return { step, action: 'skipped' };
  }
  try {
    await pool.request().batch(sqlText);
    return { step, action: 'applied' };
  } catch (error) {
    throw new Error(formatSqlErrorContext(step, error), { cause: error });
  }
}

async function ensureMinimalTenantTable(pool: SqlBatchRunner): Promise<MigrationStepOutcome> {
  return runStep(pool, 'ensure_minimal_tenant_table', `
IF OBJECT_ID(N'dbo.Tenant', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.Tenant (
    TenantId UNIQUEIDENTIFIER NOT NULL CONSTRAINT DF_Tenant_TenantId DEFAULT NEWSEQUENTIALID(),
    Code NVARCHAR(64) NOT NULL,
    Name NVARCHAR(256) NOT NULL,
    Status NVARCHAR(20) NOT NULL CONSTRAINT DF_Tenant_Status DEFAULT N'active',
    DefaultTimezone NVARCHAR(64) NOT NULL CONSTRAINT DF_Tenant_TZ DEFAULT N'Africa/Cairo',
    CreatedAt DATETIME2 NOT NULL CONSTRAINT DF_Tenant_CreatedAt DEFAULT SYSUTCDATETIME(),
    UpdatedAt DATETIME2 NOT NULL CONSTRAINT DF_Tenant_UpdatedAt DEFAULT SYSUTCDATETIME(),
    CONSTRAINT PK_Tenant PRIMARY KEY (TenantId),
    CONSTRAINT UQ_Tenant_Code UNIQUE (Code),
    CONSTRAINT CK_Tenant_Status CHECK (Status IN (N'active', N'suspended'))
  );
END
`, async () => tableExists(pool, 'Tenant'));
}

async function ensureBootstrapTenantRow(pool: SqlBatchRunner): Promise<MigrationStepOutcome> {
  return runStep(pool, 'ensure_bootstrap_tenant_row', `
IF NOT EXISTS (SELECT 1 FROM dbo.Tenant WHERE Code = N'${BOOTSTRAP_TENANT_CODE}')
BEGIN
  IF (SELECT COUNT(*) FROM dbo.Tenant) > 0
    THROW 51007, N'Refusing bootstrap tenant insert: Tenant table already has rows without ${BOOTSTRAP_TENANT_CODE}', 1;

  INSERT INTO dbo.Tenant (Code, Name, Status, DefaultTimezone)
  VALUES (N'${BOOTSTRAP_TENANT_CODE}', N'${BOOTSTRAP_TENANT_NAME}', N'active', N'Africa/Cairo');
END
`, async () => {
    const result = await pool.request().query(`
      SELECT TOP 1 1 AS ok
      FROM dbo.Tenant
      WHERE Code = N'${BOOTSTRAP_TENANT_CODE}' AND Status = N'active'
    `);
    return result.recordset.length > 0;
  });
}

async function ensureTreasuryMovementRegistryTable(pool: SqlBatchRunner): Promise<MigrationStepOutcome> {
  return runStep(pool, 'create_treasury_movement_registry_table', `
IF OBJECT_ID(N'dbo.TreasuryMovementRegistry', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.TreasuryMovementRegistry (
    Id BIGINT IDENTITY(1,1) NOT NULL,
    TenantId UNIQUEIDENTIFIER NOT NULL,
    IdempotencyKey NVARCHAR(256) NOT NULL,
    Fingerprint NVARCHAR(128) NOT NULL,
    Kind NVARCHAR(32) NOT NULL,
    CashMoveId INT NOT NULL,
    TransferGroupKey NVARCHAR(256) NULL,
    OriginalIdempotencyKey NVARCHAR(256) NULL,
    SourceRef NVARCHAR(256) NULL,
    CreatedAt DATETIME2 NOT NULL CONSTRAINT DF_TreasuryMovementRegistry_CreatedAt DEFAULT SYSUTCDATETIME(),
    CONSTRAINT PK_TreasuryMovementRegistry PRIMARY KEY (Id)
  );
END
`, async () => tableExists(pool, 'TreasuryMovementRegistry'));
}

async function ensureRegistryIndexes(pool: SqlBatchRunner): Promise<MigrationStepOutcome[]> {
  const outcomes: MigrationStepOutcome[] = [];

  outcomes.push(await runStep(pool, 'index_UX_TreasuryMovementRegistry_Tenant_Idempotency', `
IF OBJECT_ID(N'dbo.TreasuryMovementRegistry', N'U') IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE name = N'UX_TreasuryMovementRegistry_Tenant_Idempotency'
      AND object_id = OBJECT_ID(N'dbo.TreasuryMovementRegistry')
  )
BEGIN
  CREATE UNIQUE INDEX UX_TreasuryMovementRegistry_Tenant_Idempotency
    ON dbo.TreasuryMovementRegistry (TenantId, IdempotencyKey);
END
`, async () => indexExists(pool, 'TreasuryMovementRegistry', 'UX_TreasuryMovementRegistry_Tenant_Idempotency')));

  outcomes.push(await runStep(pool, 'index_IX_TreasuryMovementRegistry_CashMove', `
IF OBJECT_ID(N'dbo.TreasuryMovementRegistry', N'U') IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE name = N'IX_TreasuryMovementRegistry_CashMove'
      AND object_id = OBJECT_ID(N'dbo.TreasuryMovementRegistry')
  )
BEGIN
  CREATE INDEX IX_TreasuryMovementRegistry_CashMove
    ON dbo.TreasuryMovementRegistry (CashMoveId);
END
`, async () => indexExists(pool, 'TreasuryMovementRegistry', 'IX_TreasuryMovementRegistry_CashMove')));

  outcomes.push(await runStep(pool, 'index_IX_TreasuryMovementRegistry_TransferGroup', `
IF OBJECT_ID(N'dbo.TreasuryMovementRegistry', N'U') IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE name = N'IX_TreasuryMovementRegistry_TransferGroup'
      AND object_id = OBJECT_ID(N'dbo.TreasuryMovementRegistry')
  )
BEGIN
  CREATE INDEX IX_TreasuryMovementRegistry_TransferGroup
    ON dbo.TreasuryMovementRegistry (TenantId, TransferGroupKey)
    WHERE TransferGroupKey IS NOT NULL;
END
`, async () => indexExists(pool, 'TreasuryMovementRegistry', 'IX_TreasuryMovementRegistry_TransferGroup')));

  return outcomes;
}

async function ensureRegistryForeignKeys(pool: SqlBatchRunner): Promise<MigrationStepOutcome[]> {
  const outcomes: MigrationStepOutcome[] = [];

  outcomes.push(await runStep(pool, 'fk_FK_TreasuryMovementRegistry_Tenant', `
IF OBJECT_ID(N'dbo.TreasuryMovementRegistry', N'U') IS NOT NULL
  AND OBJECT_ID(N'dbo.Tenant', N'U') IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = N'FK_TreasuryMovementRegistry_Tenant')
BEGIN
  ALTER TABLE dbo.TreasuryMovementRegistry
    ADD CONSTRAINT FK_TreasuryMovementRegistry_Tenant
    FOREIGN KEY (TenantId) REFERENCES dbo.Tenant (TenantId);
END
`, async () => foreignKeyExists(pool, 'FK_TreasuryMovementRegistry_Tenant')));

  outcomes.push(await runStep(pool, 'fk_FK_TreasuryMovementRegistry_CashMove', `
IF OBJECT_ID(N'dbo.TreasuryMovementRegistry', N'U') IS NOT NULL
  AND OBJECT_ID(N'dbo.TblCashMove', N'U') IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = N'FK_TreasuryMovementRegistry_CashMove')
BEGIN
  ALTER TABLE dbo.TreasuryMovementRegistry
    ADD CONSTRAINT FK_TreasuryMovementRegistry_CashMove
    FOREIGN KEY (CashMoveId) REFERENCES dbo.TblCashMove (ID);
END
`, async () => foreignKeyExists(pool, 'FK_TreasuryMovementRegistry_CashMove')));

  return outcomes;
}

async function ensureReversalColumns(pool: SqlBatchRunner): Promise<MigrationStepOutcome[]> {
  const outcomes: MigrationStepOutcome[] = [];

  outcomes.push(await runStep(pool, 'column_TblCashMove_ReversalOfCashMoveId', `
IF COL_LENGTH(N'dbo.TblCashMove', N'ReversalOfCashMoveId') IS NULL
BEGIN
  ALTER TABLE dbo.TblCashMove ADD ReversalOfCashMoveId INT NULL;
END
`, async () => columnExists(pool, 'TblCashMove', 'ReversalOfCashMoveId')));

  outcomes.push(await runStep(pool, 'column_TblCashMove_IsReversed', `
IF COL_LENGTH(N'dbo.TblCashMove', N'IsReversed') IS NULL
BEGIN
  ALTER TABLE dbo.TblCashMove ADD IsReversed BIT NOT NULL CONSTRAINT DF_TblCashMove_IsReversed DEFAULT 0;
END
`, async () => columnExists(pool, 'TblCashMove', 'IsReversed')));

  outcomes.push(await runStep(pool, 'fk_FK_TblCashMove_ReversalOf', `
IF COL_LENGTH(N'dbo.TblCashMove', N'ReversalOfCashMoveId') IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = N'FK_TblCashMove_ReversalOf')
BEGIN
  ALTER TABLE dbo.TblCashMove
    ADD CONSTRAINT FK_TblCashMove_ReversalOf
    FOREIGN KEY (ReversalOfCashMoveId) REFERENCES dbo.TblCashMove (ID);
END
`, async () => foreignKeyExists(pool, 'FK_TblCashMove_ReversalOf')));

  return outcomes;
}

async function verifyDrvo007Migration(pool: SqlBatchRunner): Promise<void> {
  const preflight = await runDrvo007Preflight(pool);
  if (preflight.blockers.length > 0) {
    throw new Error(`DRVO-007 post-migration verification failed: ${preflight.blockers.join('; ')}`);
  }
  if (!preflight.registryTableExists) {
    throw new Error('DRVO-007 migration did not create TreasuryMovementRegistry');
  }
  for (const indexName of REGISTRY_INDEXES) {
    if (!preflight.registryIndexes[indexName]) {
      throw new Error(`DRVO-007 migration missing index ${indexName}`);
    }
  }
  for (const fkName of REGISTRY_FOREIGN_KEYS) {
    if (!preflight.registryForeignKeys[fkName]) {
      throw new Error(`DRVO-007 migration missing foreign key ${fkName}`);
    }
  }
  if (!preflight.reversalOfColumnExists || !preflight.isReversedColumnExists || !preflight.reversalForeignKeyExists) {
    throw new Error('DRVO-007 migration did not create reversal columns and FK on TblCashMove');
  }
}

export async function applyDrvo007TreasuryMigration(pool: SqlBatchRunner): Promise<void> {
  const preflight = await runDrvo007Preflight(pool);
  if (preflight.blockers.length > 0) {
    throw new Error(`DRVO-007 preflight blocked: ${preflight.blockers.join('; ')}`);
  }

  if (preflight.warnings.length > 0) {
    for (const warning of preflight.warnings) {
      console.log(`DRVO-007 preflight warning: ${warning}`);
    }
  }

  const steps: MigrationStepOutcome[] = [];
  steps.push(await ensureMinimalTenantTable(pool));
  steps.push(await ensureBootstrapTenantRow(pool));
  steps.push(await ensureTreasuryMovementRegistryTable(pool));
  steps.push(...await ensureRegistryIndexes(pool));
  steps.push(...await ensureRegistryForeignKeys(pool));
  steps.push(...await ensureReversalColumns(pool));

  for (const step of steps) {
    if (step.action === 'applied') {
      console.log(`DRVO-007 ${step.step}: applied`);
    }
  }

  await verifyDrvo007Migration(pool);
}

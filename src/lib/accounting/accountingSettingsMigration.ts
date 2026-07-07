import { getPool, sql } from '@/lib/db';

export const ACCOUNTING_SETTINGS_TABLES = [
  'TblAccountingCategoryClassificationMap',
  'TblAccountingKeywordClassificationRule',
  'TblAccountingEmployeeAlias',
] as const;

export type AccountingSettingsTableName = (typeof ACCOUNTING_SETTINGS_TABLES)[number];

export interface AccountingSettingsMigrationStatus {
  tablesExist: boolean;
  migrationRequired: boolean;
  existingTables: AccountingSettingsTableName[];
  missingTables: AccountingSettingsTableName[];
}

export interface MigrationStepOutcome {
  step: string;
  action: 'created' | 'skipped' | 'seeded' | 'skipped_seed';
  detail?: string;
}

export interface SqlErrorInfo {
  message: string;
  number?: number;
  lineNumber?: number;
}

export interface AccountingSettingsMigrationResult {
  success: boolean;
  createdTables: AccountingSettingsTableName[];
  existingTables: AccountingSettingsTableName[];
  seededRows: { keywords: number; categoryMappings: number };
  skippedSeeds: string[];
  steps: MigrationStepOutcome[];
  failedStep?: string;
  sqlError?: SqlErrorInfo;
}

/** Individual SQL Server batches — never split by semicolon; each runs as one query(). */
const MIGRATION_STEPS: { step: string; table?: AccountingSettingsTableName; createsTable?: boolean; sql: string }[] = [
  {
    step: 'create_TblAccountingCategoryClassificationMap',
    table: 'TblAccountingCategoryClassificationMap',
    createsTable: true,
    sql: `
IF OBJECT_ID(N'dbo.TblAccountingCategoryClassificationMap', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.TblAccountingCategoryClassificationMap (
    ID INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    ExpINID INT NOT NULL,
    FlowGroup NVARCHAR(80) NOT NULL,
    FlowKind NVARCHAR(80) NOT NULL,
    PnlImpact NVARCHAR(30) NOT NULL,
    PartyType NVARCHAR(40) NOT NULL,
    RequiresEmployee BIT NOT NULL CONSTRAINT DF_AccCatMap_RequiresEmployee DEFAULT 0,
    NeedsReviewByDefault BIT NOT NULL CONSTRAINT DF_AccCatMap_NeedsReview DEFAULT 0,
    Confidence NVARCHAR(10) NOT NULL CONSTRAINT DF_AccCatMap_Confidence DEFAULT N'high',
    Notes NVARCHAR(500) NULL,
    IsActive BIT NOT NULL CONSTRAINT DF_AccCatMap_IsActive DEFAULT 1,
    CreatedByUserID INT NULL,
    UpdatedByUserID INT NULL,
    CreatedAt DATETIME2 NOT NULL CONSTRAINT DF_AccCatMap_CreatedAt DEFAULT SYSUTCDATETIME(),
    UpdatedAt DATETIME2 NOT NULL CONSTRAINT DF_AccCatMap_UpdatedAt DEFAULT SYSUTCDATETIME(),
    CONSTRAINT FK_AccCatMap_ExpINID FOREIGN KEY (ExpINID) REFERENCES dbo.TblExpINCat(ExpINID),
    CONSTRAINT UQ_AccCatMap_ExpINID UNIQUE (ExpINID)
  )
END`,
  },
  {
    step: 'index_IX_AccCatMap_IsActive',
    table: 'TblAccountingCategoryClassificationMap',
    sql: `
IF OBJECT_ID(N'dbo.TblAccountingCategoryClassificationMap', N'U') IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE name = N'IX_AccCatMap_IsActive'
      AND object_id = OBJECT_ID(N'dbo.TblAccountingCategoryClassificationMap')
  )
BEGIN
  CREATE INDEX IX_AccCatMap_IsActive
    ON dbo.TblAccountingCategoryClassificationMap(IsActive)
    WHERE IsActive = 1
END`,
  },
  {
    step: 'create_TblAccountingKeywordClassificationRule',
    table: 'TblAccountingKeywordClassificationRule',
    createsTable: true,
    sql: `
IF OBJECT_ID(N'dbo.TblAccountingKeywordClassificationRule', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.TblAccountingKeywordClassificationRule (
    ID INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    Keyword NVARCHAR(200) NOT NULL,
    MatchTarget NVARCHAR(20) NOT NULL,
    MatchMode NVARCHAR(20) NOT NULL,
    FlowGroup NVARCHAR(80) NOT NULL,
    FlowKind NVARCHAR(80) NOT NULL,
    PnlImpact NVARCHAR(30) NOT NULL,
    PartyType NVARCHAR(40) NOT NULL,
    RequiresEmployee BIT NOT NULL CONSTRAINT DF_AccKwRule_RequiresEmployee DEFAULT 0,
    NeedsReviewByDefault BIT NOT NULL CONSTRAINT DF_AccKwRule_NeedsReview DEFAULT 0,
    Confidence NVARCHAR(10) NOT NULL CONSTRAINT DF_AccKwRule_Confidence DEFAULT N'high',
    Priority INT NOT NULL CONSTRAINT DF_AccKwRule_Priority DEFAULT 100,
    IsActive BIT NOT NULL CONSTRAINT DF_AccKwRule_IsActive DEFAULT 1,
    CreatedByUserID INT NULL,
    UpdatedByUserID INT NULL,
    CreatedAt DATETIME2 NOT NULL CONSTRAINT DF_AccKwRule_CreatedAt DEFAULT SYSUTCDATETIME(),
    UpdatedAt DATETIME2 NOT NULL CONSTRAINT DF_AccKwRule_UpdatedAt DEFAULT SYSUTCDATETIME(),
    CONSTRAINT CHK_AccKwRule_MatchTarget CHECK (MatchTarget IN (N'category', N'notes', N'both')),
    CONSTRAINT CHK_AccKwRule_MatchMode CHECK (MatchMode IN (N'contains', N'exact'))
  )
END`,
  },
  {
    step: 'index_IX_AccKwRule_Priority',
    table: 'TblAccountingKeywordClassificationRule',
    sql: `
IF OBJECT_ID(N'dbo.TblAccountingKeywordClassificationRule', N'U') IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE name = N'IX_AccKwRule_Priority'
      AND object_id = OBJECT_ID(N'dbo.TblAccountingKeywordClassificationRule')
  )
BEGIN
  CREATE INDEX IX_AccKwRule_Priority
    ON dbo.TblAccountingKeywordClassificationRule(Priority, IsActive)
END`,
  },
  {
    step: 'create_TblAccountingEmployeeAlias',
    table: 'TblAccountingEmployeeAlias',
    createsTable: true,
    sql: `
IF OBJECT_ID(N'dbo.TblAccountingEmployeeAlias', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.TblAccountingEmployeeAlias (
    ID INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    EmpID INT NOT NULL,
    AliasText NVARCHAR(200) NOT NULL,
    IsActive BIT NOT NULL CONSTRAINT DF_AccEmpAlias_IsActive DEFAULT 1,
    CreatedByUserID INT NULL,
    UpdatedByUserID INT NULL,
    CreatedAt DATETIME2 NOT NULL CONSTRAINT DF_AccEmpAlias_CreatedAt DEFAULT SYSUTCDATETIME(),
    UpdatedAt DATETIME2 NOT NULL CONSTRAINT DF_AccEmpAlias_UpdatedAt DEFAULT SYSUTCDATETIME(),
    CONSTRAINT FK_AccEmpAlias_EmpID FOREIGN KEY (EmpID) REFERENCES dbo.TblEmp(EmpID)
  )
END`,
  },
  {
    step: 'index_IX_AccEmpAlias_AliasText',
    table: 'TblAccountingEmployeeAlias',
    sql: `
IF OBJECT_ID(N'dbo.TblAccountingEmployeeAlias', N'U') IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE name = N'IX_AccEmpAlias_AliasText'
      AND object_id = OBJECT_ID(N'dbo.TblAccountingEmployeeAlias')
  )
BEGIN
  CREATE INDEX IX_AccEmpAlias_AliasText
    ON dbo.TblAccountingEmployeeAlias(AliasText)
    WHERE IsActive = 1
END`,
  },
  {
    step: 'index_IX_AccEmpAlias_EmpID',
    table: 'TblAccountingEmployeeAlias',
    sql: `
IF OBJECT_ID(N'dbo.TblAccountingEmployeeAlias', N'U') IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE name = N'IX_AccEmpAlias_EmpID'
      AND object_id = OBJECT_ID(N'dbo.TblAccountingEmployeeAlias')
  )
BEGIN
  CREATE INDEX IX_AccEmpAlias_EmpID
    ON dbo.TblAccountingEmployeeAlias(EmpID)
    WHERE IsActive = 1
END`,
  },
];

export function extractSqlError(error: unknown): SqlErrorInfo {
  if (error && typeof error === 'object') {
    const e = error as Record<string, unknown>;
    const orig = (e.originalError ?? e.precedingErrors) as Record<string, unknown> | undefined;
    const nested = Array.isArray(e.precedingErrors) && e.precedingErrors.length
      ? (e.precedingErrors[0] as Record<string, unknown>)
      : undefined;
    const src = nested ?? (orig && typeof orig === 'object' ? orig : e);
    return {
      message: String(src.message ?? e.message ?? 'Unknown SQL error'),
      number: typeof src.number === 'number' ? src.number : typeof e.number === 'number' ? e.number : undefined,
      lineNumber: typeof src.lineNumber === 'number' ? src.lineNumber : typeof e.lineNumber === 'number' ? e.lineNumber : undefined,
    };
  }
  return { message: error instanceof Error ? error.message : String(error) };
}

async function tableExists(db: Awaited<ReturnType<typeof getPool>>, tableName: string): Promise<boolean> {
  const result = await db.request()
    .input('TableName', sql.NVarChar(128), tableName)
    .query(`
      SELECT 1 AS x
      FROM INFORMATION_SCHEMA.TABLES
      WHERE TABLE_SCHEMA = N'dbo' AND TABLE_NAME = @TableName
    `);
  return result.recordset.length > 0;
}

export async function getAccountingSettingsMigrationStatus(): Promise<AccountingSettingsMigrationStatus> {
  const db = await getPool();
  const existingTables: AccountingSettingsTableName[] = [];
  const missingTables: AccountingSettingsTableName[] = [];

  for (const table of ACCOUNTING_SETTINGS_TABLES) {
    if (await tableExists(db, table)) {
      existingTables.push(table);
    } else {
      missingTables.push(table);
    }
  }

  const tablesExist = missingTables.length === 0;
  return {
    tablesExist,
    migrationRequired: !tablesExist,
    existingTables,
    missingTables,
  };
}

/** @deprecated use getAccountingSettingsMigrationStatus().tablesExist */
export async function settingsTablesExist(): Promise<boolean> {
  const status = await getAccountingSettingsMigrationStatus();
  return status.tablesExist;
}

export async function ensureAccountingSettingsTablesExist(): Promise<AccountingSettingsMigrationResult> {
  const db = await getPool();
  const before = await getAccountingSettingsMigrationStatus();
  const createdTables: AccountingSettingsTableName[] = [];
  const existingTables = [...before.existingTables];
  const steps: MigrationStepOutcome[] = [];

  for (const { step, table, createsTable, sql: stepSql } of MIGRATION_STEPS) {
    const existedBefore = table ? before.existingTables.includes(table) : true;
    try {
      await db.request().query(stepSql);
      if (createsTable && table) {
        const existsNow = await tableExists(db, table);
        if (!existedBefore && existsNow) {
          createdTables.push(table);
          if (!existingTables.includes(table)) existingTables.push(table);
          steps.push({ step, action: 'created', detail: table });
        } else {
          steps.push({ step, action: 'skipped', detail: table });
        }
      } else {
        steps.push({ step, action: 'skipped' });
      }
    } catch (error: unknown) {
      const sqlError = extractSqlError(error);
      return {
        success: false,
        createdTables,
        existingTables,
        seededRows: { keywords: 0, categoryMappings: 0 },
        skippedSeeds: [],
        steps,
        failedStep: step,
        sqlError,
      };
    }
  }

  return {
    success: true,
    createdTables,
    existingTables,
    seededRows: { keywords: 0, categoryMappings: 0 },
    skippedSeeds: [],
    steps,
  };
}

/** Runs table DDL only — one query per step, no semicolon splitting. */
export async function runAccountingSettingsMigration(): Promise<AccountingSettingsMigrationResult> {
  return ensureAccountingSettingsTablesExist();
}

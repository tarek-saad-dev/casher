import { getPool, sql } from '@/lib/db';
import type {
  CategoryClassificationMap,
  ClassificationSettingsBundle,
  EmployeeAlias,
  KeywordClassificationRule,
} from './accountingSettingsTypes';
import { normalizeForMatch } from './cashMoveClassification';
import {
  getAccountingSettingsMigrationStatus,
  runAccountingSettingsMigration,
  settingsTablesExist,
  type AccountingSettingsMigrationResult,
} from './accountingSettingsMigration';

export {
  getAccountingSettingsMigrationStatus,
  ensureAccountingSettingsTablesExist,
  settingsTablesExist,
  extractSqlError,
} from './accountingSettingsMigration';
export type {
  AccountingSettingsMigrationStatus,
  AccountingSettingsMigrationResult,
} from './accountingSettingsMigration';
export { seedDefaultClassificationSettings } from './accountingSettingsSeed';
import { seedDefaultClassificationSettings } from './accountingSettingsSeed';

export async function runFullAccountingSettingsMigration(userId?: number): Promise<
  AccountingSettingsMigrationResult & { seededRows: { keywords: number; categoryMappings: number }; skippedSeeds: string[] }
> {
  const migration = await runAccountingSettingsMigration();
  if (!migration.success) {
    return { ...migration, seededRows: { keywords: 0, categoryMappings: 0 }, skippedSeeds: [] };
  }
  const seed = await seedDefaultClassificationSettings(userId);
  return {
    ...migration,
    seededRows: seed.seededRows,
    skippedSeeds: seed.skippedSeeds,
  };
}

function mapCategoryRow(r: Record<string, unknown>): CategoryClassificationMap {
  return {
    id: Number(r.ID),
    expInId: Number(r.ExpINID),
    catName: r.CatName as string | undefined,
    expInType: r.ExpINType as string | undefined,
    flowGroup: String(r.FlowGroup),
    flowKind: String(r.FlowKind),
    pnlImpact: r.PnlImpact as CategoryClassificationMap['pnlImpact'],
    partyType: r.PartyType as CategoryClassificationMap['partyType'],
    requiresEmployee: r.RequiresEmployee === true || r.RequiresEmployee === 1,
    needsReviewByDefault: r.NeedsReviewByDefault === true || r.NeedsReviewByDefault === 1,
    confidence: r.Confidence as CategoryClassificationMap['confidence'],
    notes: (r.Notes as string) ?? null,
    isActive: r.IsActive === true || r.IsActive === 1,
  };
}

function mapKeywordRow(r: Record<string, unknown>): KeywordClassificationRule {
  return {
    id: Number(r.ID),
    keyword: String(r.Keyword),
    matchTarget: r.MatchTarget as KeywordClassificationRule['matchTarget'],
    matchMode: r.MatchMode as KeywordClassificationRule['matchMode'],
    flowGroup: String(r.FlowGroup),
    flowKind: String(r.FlowKind),
    pnlImpact: r.PnlImpact as KeywordClassificationRule['pnlImpact'],
    partyType: r.PartyType as KeywordClassificationRule['partyType'],
    requiresEmployee: r.RequiresEmployee === true || r.RequiresEmployee === 1,
    needsReviewByDefault: r.NeedsReviewByDefault === true || r.NeedsReviewByDefault === 1,
    confidence: r.Confidence as KeywordClassificationRule['confidence'],
    priority: Number(r.Priority),
    isActive: r.IsActive === true || r.IsActive === 1,
  };
}

function mapAliasRow(r: Record<string, unknown>): EmployeeAlias {
  return {
    id: Number(r.ID),
    empId: Number(r.EmpID),
    empName: r.EmpName as string | undefined,
    aliasText: String(r.AliasText),
    isActive: r.IsActive === true || r.IsActive === 1,
  };
}

export async function loadClassificationSettings(): Promise<ClassificationSettingsBundle> {
  const status = await getAccountingSettingsMigrationStatus();
  if (status.migrationRequired) {
    return {
      categoryMappingsByExpInId: new Map(),
      keywordRules: [],
      employeeAliases: [],
      employees: [],
      loaded: false,
    };
  }

  const db = await getPool();
  const [catRes, kwRes, aliasRes, empRes] = await Promise.all([
    db.request().query(`
      SELECT m.*, c.CatName, c.ExpINType
      FROM dbo.TblAccountingCategoryClassificationMap m
      INNER JOIN dbo.TblExpINCat c ON c.ExpINID = m.ExpINID
      WHERE m.IsActive = 1
    `),
    db.request().query(`
      SELECT * FROM dbo.TblAccountingKeywordClassificationRule
      WHERE IsActive = 1
      ORDER BY Priority ASC, ID ASC
    `),
    db.request().query(`
      SELECT a.*, e.EmpName
      FROM dbo.TblAccountingEmployeeAlias a
      INNER JOIN dbo.TblEmp e ON e.EmpID = a.EmpID
      WHERE a.IsActive = 1
      ORDER BY LEN(a.AliasText) DESC, a.ID ASC
    `),
    db.request().query(`
      SELECT EmpID, EmpName FROM dbo.TblEmp WHERE isActive = 1
    `),
  ]);

  const categoryMappingsByExpInId = new Map<number, CategoryClassificationMap>();
  for (const row of catRes.recordset) {
    const mapped = mapCategoryRow(row);
    categoryMappingsByExpInId.set(mapped.expInId, mapped);
  }

  return {
    categoryMappingsByExpInId,
    keywordRules: kwRes.recordset.map(mapKeywordRow),
    employeeAliases: aliasRes.recordset.map(mapAliasRow),
    employees: empRes.recordset.map((r: { EmpID: number; EmpName: string }) => ({
      empId: r.EmpID,
      empName: r.EmpName,
    })),
    loaded: true,
  };
}

export async function listCategoryMappings(search?: string, unmappedOnly?: boolean) {
  const status = await getAccountingSettingsMigrationStatus();
  if (status.migrationRequired) return [];

  const db = await getPool();
  const result = await db.request().query(`
    SELECT c.ExpINID, c.CatName, c.ExpINType,
           m.ID, m.FlowGroup, m.FlowKind, m.PnlImpact, m.PartyType,
           m.RequiresEmployee, m.NeedsReviewByDefault, m.Confidence, m.Notes, m.IsActive
    FROM dbo.TblExpINCat c
    LEFT JOIN dbo.TblAccountingCategoryClassificationMap m ON m.ExpINID = c.ExpINID AND m.IsActive = 1
    ORDER BY c.CatName
  `);

  let rows = result.recordset.map((r: Record<string, unknown>) => ({
    expInId: Number(r.ExpINID),
    catName: String(r.CatName),
    expInType: String(r.ExpINType),
    mapping: r.ID != null ? mapCategoryRow({ ...r, ExpINID: r.ExpINID }) : null,
  }));

  if (search) {
    const q = normalizeForMatch(search);
    rows = rows.filter((r) => normalizeForMatch(r.catName).includes(q));
  }
  if (unmappedOnly) {
    rows = rows.filter((r) => !r.mapping);
  }
  return rows;
}

export async function upsertCategoryMapping(input: {
  expInId: number;
  flowGroup: string;
  flowKind: string;
  pnlImpact: string;
  partyType: string;
  requiresEmployee: boolean;
  needsReviewByDefault: boolean;
  confidence: string;
  notes?: string | null;
  userId?: number;
}) {
  const db = await getPool();
  await db.request()
    .input('ExpINID', sql.Int, input.expInId)
    .input('FlowGroup', sql.NVarChar(80), input.flowGroup)
    .input('FlowKind', sql.NVarChar(80), input.flowKind)
    .input('PnlImpact', sql.NVarChar(30), input.pnlImpact)
    .input('PartyType', sql.NVarChar(40), input.partyType)
    .input('RequiresEmployee', sql.Bit, input.requiresEmployee)
    .input('NeedsReviewByDefault', sql.Bit, input.needsReviewByDefault)
    .input('Confidence', sql.NVarChar(10), input.confidence)
    .input('Notes', sql.NVarChar(500), input.notes ?? null)
    .input('UserID', sql.Int, input.userId ?? null)
    .query(`
      MERGE dbo.TblAccountingCategoryClassificationMap AS t
      USING (SELECT @ExpINID AS ExpINID) AS s ON t.ExpINID = s.ExpINID
      WHEN MATCHED THEN UPDATE SET
        FlowGroup = @FlowGroup, FlowKind = @FlowKind, PnlImpact = @PnlImpact, PartyType = @PartyType,
        RequiresEmployee = @RequiresEmployee, NeedsReviewByDefault = @NeedsReviewByDefault,
        Confidence = @Confidence, Notes = @Notes, IsActive = 1,
        UpdatedByUserID = @UserID, UpdatedAt = SYSUTCDATETIME()
      WHEN NOT MATCHED THEN INSERT
        (ExpINID, FlowGroup, FlowKind, PnlImpact, PartyType, RequiresEmployee, NeedsReviewByDefault,
         Confidence, Notes, CreatedByUserID, UpdatedByUserID)
        VALUES
        (@ExpINID, @FlowGroup, @FlowKind, @PnlImpact, @PartyType, @RequiresEmployee, @NeedsReviewByDefault,
         @Confidence, @Notes, @UserID, @UserID);
    `);
}

export async function bulkMapOperatingExpense(expInIds: number[], userId?: number) {
  for (const expInId of expInIds) {
    await upsertCategoryMapping({
      expInId,
      flowGroup: 'operating',
      flowKind: 'operating_expense',
      pnlImpact: 'expense',
      partyType: 'none',
      requiresEmployee: false,
      needsReviewByDefault: false,
      confidence: 'high',
      notes: 'تعيين جماعي: مصروف تشغيل',
      userId,
    });
  }
}

export async function listKeywordRules() {
  const status = await getAccountingSettingsMigrationStatus();
  if (status.migrationRequired) return [];

  const db = await getPool();
  const result = await db.request().query(`
    SELECT * FROM dbo.TblAccountingKeywordClassificationRule ORDER BY Priority ASC, ID ASC
  `);
  return result.recordset.map(mapKeywordRow);
}

export async function createKeywordRule(input: Omit<KeywordClassificationRule, 'id'>, userId?: number) {
  const db = await getPool();
  const result = await db.request()
    .input('Keyword', sql.NVarChar(200), input.keyword)
    .input('MatchTarget', sql.NVarChar(20), input.matchTarget)
    .input('MatchMode', sql.NVarChar(20), input.matchMode)
    .input('FlowGroup', sql.NVarChar(80), input.flowGroup)
    .input('FlowKind', sql.NVarChar(80), input.flowKind)
    .input('PnlImpact', sql.NVarChar(30), input.pnlImpact)
    .input('PartyType', sql.NVarChar(40), input.partyType)
    .input('RequiresEmployee', sql.Bit, input.requiresEmployee)
    .input('NeedsReviewByDefault', sql.Bit, input.needsReviewByDefault)
    .input('Confidence', sql.NVarChar(10), input.confidence)
    .input('Priority', sql.Int, input.priority)
    .input('IsActive', sql.Bit, input.isActive)
    .input('UserID', sql.Int, userId ?? null)
    .query(`
      INSERT INTO dbo.TblAccountingKeywordClassificationRule
        (Keyword, MatchTarget, MatchMode, FlowGroup, FlowKind, PnlImpact, PartyType,
         RequiresEmployee, NeedsReviewByDefault, Confidence, Priority, IsActive, CreatedByUserID, UpdatedByUserID)
      OUTPUT INSERTED.*
      VALUES
        (@Keyword, @MatchTarget, @MatchMode, @FlowGroup, @FlowKind, @PnlImpact, @PartyType,
         @RequiresEmployee, @NeedsReviewByDefault, @Confidence, @Priority, @IsActive, @UserID, @UserID)
    `);
  return mapKeywordRow(result.recordset[0]);
}

export async function updateKeywordRule(id: number, input: Partial<KeywordClassificationRule>, userId?: number) {
  const db = await getPool();
  const existing = await db.request().input('ID', sql.Int, id)
    .query(`SELECT * FROM dbo.TblAccountingKeywordClassificationRule WHERE ID = @ID`);
  if (!existing.recordset.length) throw new Error('القاعدة غير موجودة');
  const cur = mapKeywordRow(existing.recordset[0]);
  const merged = { ...cur, ...input, id };
  await db.request()
    .input('ID', sql.Int, id)
    .input('Keyword', sql.NVarChar(200), merged.keyword)
    .input('MatchTarget', sql.NVarChar(20), merged.matchTarget)
    .input('MatchMode', sql.NVarChar(20), merged.matchMode)
    .input('FlowGroup', sql.NVarChar(80), merged.flowGroup)
    .input('FlowKind', sql.NVarChar(80), merged.flowKind)
    .input('PnlImpact', sql.NVarChar(30), merged.pnlImpact)
    .input('PartyType', sql.NVarChar(40), merged.partyType)
    .input('RequiresEmployee', sql.Bit, merged.requiresEmployee)
    .input('NeedsReviewByDefault', sql.Bit, merged.needsReviewByDefault)
    .input('Confidence', sql.NVarChar(10), merged.confidence)
    .input('Priority', sql.Int, merged.priority)
    .input('IsActive', sql.Bit, merged.isActive)
    .input('UserID', sql.Int, userId ?? null)
    .query(`
      UPDATE dbo.TblAccountingKeywordClassificationRule SET
        Keyword=@Keyword, MatchTarget=@MatchTarget, MatchMode=@MatchMode,
        FlowGroup=@FlowGroup, FlowKind=@FlowKind, PnlImpact=@PnlImpact, PartyType=@PartyType,
        RequiresEmployee=@RequiresEmployee, NeedsReviewByDefault=@NeedsReviewByDefault,
        Confidence=@Confidence, Priority=@Priority, IsActive=@IsActive,
        UpdatedByUserID=@UserID, UpdatedAt=SYSUTCDATETIME()
      WHERE ID=@ID
    `);
  return merged;
}

export async function deleteKeywordRule(id: number, userId?: number) {
  const db = await getPool();
  await db.request()
    .input('ID', sql.Int, id)
    .input('UserID', sql.Int, userId ?? null)
    .query(`
      UPDATE dbo.TblAccountingKeywordClassificationRule
      SET IsActive = 0, UpdatedByUserID = @UserID, UpdatedAt = SYSUTCDATETIME()
      WHERE ID = @ID
    `);
}

export async function listEmployeeAliases() {
  const status = await getAccountingSettingsMigrationStatus();
  if (status.migrationRequired) return [];

  const db = await getPool();
  const result = await db.request().query(`
    SELECT a.*, e.EmpName FROM dbo.TblAccountingEmployeeAlias a
    INNER JOIN dbo.TblEmp e ON e.EmpID = a.EmpID
    ORDER BY a.AliasText
  `);
  return result.recordset.map(mapAliasRow);
}

export async function createEmployeeAlias(empId: number, aliasText: string, userId?: number) {
  const db = await getPool();
  const result = await db.request()
    .input('EmpID', sql.Int, empId)
    .input('AliasText', sql.NVarChar(200), aliasText.trim())
    .input('UserID', sql.Int, userId ?? null)
    .query(`
      INSERT INTO dbo.TblAccountingEmployeeAlias (EmpID, AliasText, CreatedByUserID, UpdatedByUserID)
      OUTPUT INSERTED.*
      VALUES (@EmpID, @AliasText, @UserID, @UserID)
    `);
  return mapAliasRow({ ...result.recordset[0], EmpName: null });
}

export async function updateEmployeeAlias(id: number, input: { empId?: number; aliasText?: string; isActive?: boolean }, userId?: number) {
  const db = await getPool();
  await db.request()
    .input('ID', sql.Int, id)
    .input('EmpID', sql.Int, input.empId ?? null)
    .input('AliasText', sql.NVarChar(200), input.aliasText ?? null)
    .input('IsActive', sql.Bit, input.isActive ?? null)
    .input('UserID', sql.Int, userId ?? null)
    .query(`
      UPDATE dbo.TblAccountingEmployeeAlias SET
        EmpID = COALESCE(@EmpID, EmpID),
        AliasText = COALESCE(@AliasText, AliasText),
        IsActive = COALESCE(@IsActive, IsActive),
        UpdatedByUserID = @UserID,
        UpdatedAt = SYSUTCDATETIME()
      WHERE ID = @ID
    `);
}

export async function listEmployees() {
  const db = await getPool();
  const result = await db.request().query(`
    SELECT EmpID, EmpName FROM dbo.TblEmp WHERE isActive = 1 ORDER BY EmpName
  `);
  return result.recordset.map((r: { EmpID: number; EmpName: string }) => ({
    empId: r.EmpID,
    empName: r.EmpName,
  }));
}

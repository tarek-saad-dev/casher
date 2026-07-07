import { getPool, sql } from '@/lib/db';
import type { KeywordClassificationRule } from './accountingSettingsTypes';
import { normalizeForMatch } from './cashMoveClassification';
import { getAccountingSettingsMigrationStatus } from './accountingSettingsMigration';

async function insertCategoryMappingSeed(input: {
  expInId: number;
  flowGroup: string;
  flowKind: string;
  pnlImpact: string;
  partyType: string;
  requiresEmployee: boolean;
  needsReviewByDefault: boolean;
  confidence: string;
  notes: string;
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
    .input('Notes', sql.NVarChar(500), input.notes)
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

const OPERATING_CATEGORY_NAMES = [
  'بوفيه', 'توصيل', 'تنظيف', 'كهرباء', 'بضاعة',
  'اشتراكات شهريه', 'اشتراكات شهرية', 'الالتزامات شهريه', 'الالتزامات شهرية',
  'التزامات شهريه', 'التزامات شهرية',
];

/** Exact category names — always upserted (not skipped) to reflect clarified business meaning. */
const BUSINESS_CATEGORY_DEFAULTS: {
  exactName: string;
  flowGroup: string;
  flowKind: string;
  pnlImpact: string;
  partyType: string;
  requiresEmployee: boolean;
  needsReviewByDefault: boolean;
  confidence: string;
  notes: string;
}[] = [
  {
    exactName: 'سد ذياد',
    flowGroup: 'capital',
    flowKind: 'loan_to_business',
    pnlImpact: 'none',
    partyType: 'partner',
    requiresEmployee: false,
    needsReviewByDefault: false,
    confidence: 'high',
    notes: 'فلوس داخلة من شريك/طرف للمحل ولا تؤثر على الربح',
  },
  {
    exactName: 'طارق',
    flowGroup: 'capital',
    flowKind: 'loan_to_business',
    pnlImpact: 'none',
    partyType: 'partner_or_person',
    requiresEmployee: false,
    needsReviewByDefault: false,
    confidence: 'high',
    notes: 'فلوس داخلة من شخص/طرف للمحل ولا تؤثر على الربح',
  },
];

const SETTLEMENT_KEYWORD_BASE = {
  flowGroup: 'payroll',
  flowKind: 'employee_final_settlement',
  pnlImpact: 'expense',
  partyType: 'employee',
  requiresEmployee: false,
  needsReviewByDefault: true,
  confidence: 'medium',
  isActive: true,
} as const;

const DEFAULT_KEYWORD_RULES: Omit<KeywordClassificationRule, 'id'>[] = [
  { keyword: 'سلف', matchTarget: 'both', matchMode: 'contains', flowGroup: 'employee_advance', flowKind: 'employee_advance_out', pnlImpact: 'expense', partyType: 'employee', requiresEmployee: true, needsReviewByDefault: false, confidence: 'high', priority: 10, isActive: true },
  { keyword: 'سلفة', matchTarget: 'both', matchMode: 'contains', flowGroup: 'employee_advance', flowKind: 'employee_advance_out', pnlImpact: 'expense', partyType: 'employee', requiresEmployee: true, needsReviewByDefault: false, confidence: 'high', priority: 11, isActive: true },
  { keyword: 'سلفه', matchTarget: 'both', matchMode: 'contains', flowGroup: 'employee_advance', flowKind: 'employee_advance_out', pnlImpact: 'expense', partyType: 'employee', requiresEmployee: true, needsReviewByDefault: false, confidence: 'high', priority: 12, isActive: true },
  { keyword: 'سد', matchTarget: 'both', matchMode: 'contains', flowGroup: 'employee_advance', flowKind: 'employee_advance_repayment', pnlImpact: 'contra_expense', partyType: 'employee', requiresEmployee: true, needsReviewByDefault: true, confidence: 'medium', priority: 20, isActive: true },
  { keyword: 'سداد', matchTarget: 'both', matchMode: 'contains', flowGroup: 'employee_advance', flowKind: 'employee_advance_repayment', pnlImpact: 'contra_expense', partyType: 'employee', requiresEmployee: true, needsReviewByDefault: true, confidence: 'medium', priority: 21, isActive: true },
  { keyword: 'رجع', matchTarget: 'both', matchMode: 'contains', flowGroup: 'employee_advance', flowKind: 'employee_advance_repayment', pnlImpact: 'contra_expense', partyType: 'employee', requiresEmployee: true, needsReviewByDefault: true, confidence: 'medium', priority: 22, isActive: true },
  { keyword: 'تسوية', matchTarget: 'both', matchMode: 'contains', flowGroup: 'employee_advance', flowKind: 'employee_advance_repayment', pnlImpact: 'contra_expense', partyType: 'employee', requiresEmployee: true, needsReviewByDefault: true, confidence: 'medium', priority: 23, isActive: true },
  { keyword: 'تصفية', matchTarget: 'both', matchMode: 'contains', ...SETTLEMENT_KEYWORD_BASE, priority: 25 },
  { keyword: 'تصفيه', matchTarget: 'both', matchMode: 'contains', ...SETTLEMENT_KEYWORD_BASE, priority: 26 },
  { keyword: 'حساب موظف قديم', matchTarget: 'both', matchMode: 'contains', ...SETTLEMENT_KEYWORD_BASE, priority: 27 },
  { keyword: 'يوميه عامل قديم', matchTarget: 'both', matchMode: 'contains', ...SETTLEMENT_KEYWORD_BASE, priority: 28 },
  { keyword: 'مرتب', matchTarget: 'both', matchMode: 'contains', flowGroup: 'payroll', flowKind: 'salary_payout', pnlImpact: 'expense', partyType: 'employee', requiresEmployee: true, needsReviewByDefault: false, confidence: 'high', priority: 30, isActive: true },
  { keyword: 'راتب', matchTarget: 'both', matchMode: 'contains', flowGroup: 'payroll', flowKind: 'salary_payout', pnlImpact: 'expense', partyType: 'employee', requiresEmployee: true, needsReviewByDefault: false, confidence: 'high', priority: 31, isActive: true },
  { keyword: 'يومية', matchTarget: 'both', matchMode: 'contains', flowGroup: 'payroll', flowKind: 'salary_payout', pnlImpact: 'expense', partyType: 'employee', requiresEmployee: true, needsReviewByDefault: true, confidence: 'medium', priority: 32, isActive: true },
  { keyword: 'يوميه', matchTarget: 'both', matchMode: 'contains', flowGroup: 'payroll', flowKind: 'salary_payout', pnlImpact: 'expense', partyType: 'employee', requiresEmployee: true, needsReviewByDefault: true, confidence: 'medium', priority: 33, isActive: true },
  { keyword: 'تارجت', matchTarget: 'both', matchMode: 'contains', flowGroup: 'payroll', flowKind: 'bonus_or_commission_payout', pnlImpact: 'expense', partyType: 'employee', requiresEmployee: true, needsReviewByDefault: false, confidence: 'high', priority: 40, isActive: true },
  { keyword: 'عمولة', matchTarget: 'both', matchMode: 'contains', flowGroup: 'payroll', flowKind: 'bonus_or_commission_payout', pnlImpact: 'expense', partyType: 'employee', requiresEmployee: true, needsReviewByDefault: false, confidence: 'high', priority: 41, isActive: true },
  { keyword: 'بونص', matchTarget: 'both', matchMode: 'contains', flowGroup: 'payroll', flowKind: 'bonus_or_commission_payout', pnlImpact: 'expense', partyType: 'employee', requiresEmployee: true, needsReviewByDefault: false, confidence: 'high', priority: 42, isActive: true },
  { keyword: 'bonus', matchTarget: 'both', matchMode: 'contains', flowGroup: 'payroll', flowKind: 'bonus_or_commission_payout', pnlImpact: 'expense', partyType: 'employee', requiresEmployee: true, needsReviewByDefault: false, confidence: 'high', priority: 43, isActive: true },
  { keyword: 'commission', matchTarget: 'both', matchMode: 'contains', flowGroup: 'payroll', flowKind: 'bonus_or_commission_payout', pnlImpact: 'expense', partyType: 'employee', requiresEmployee: true, needsReviewByDefault: false, confidence: 'high', priority: 44, isActive: true },
  { keyword: 'خصم', matchTarget: 'both', matchMode: 'contains', flowGroup: 'payroll', flowKind: 'salary_deduction', pnlImpact: 'contra_expense', partyType: 'employee', requiresEmployee: true, needsReviewByDefault: false, confidence: 'high', priority: 50, isActive: true },
  { keyword: 'غياب', matchTarget: 'both', matchMode: 'contains', flowGroup: 'payroll', flowKind: 'salary_deduction', pnlImpact: 'contra_expense', partyType: 'employee', requiresEmployee: true, needsReviewByDefault: false, confidence: 'high', priority: 51, isActive: true },
  { keyword: 'تأخير', matchTarget: 'both', matchMode: 'contains', flowGroup: 'payroll', flowKind: 'salary_deduction', pnlImpact: 'contra_expense', partyType: 'employee', requiresEmployee: true, needsReviewByDefault: false, confidence: 'high', priority: 52, isActive: true },
  { keyword: 'تحويل', matchTarget: 'both', matchMode: 'contains', flowGroup: 'transfer', flowKind: 'internal_transfer', pnlImpact: 'none', partyType: 'internal', requiresEmployee: false, needsReviewByDefault: false, confidence: 'high', priority: 60, isActive: true },
  { keyword: 'تحويلات', matchTarget: 'both', matchMode: 'contains', flowGroup: 'transfer', flowKind: 'internal_transfer', pnlImpact: 'none', partyType: 'internal', requiresEmployee: false, needsReviewByDefault: false, confidence: 'high', priority: 61, isActive: true },
  { keyword: 'بين طرق الدفع', matchTarget: 'both', matchMode: 'contains', flowGroup: 'transfer', flowKind: 'internal_transfer', pnlImpact: 'none', partyType: 'internal', requiresEmployee: false, needsReviewByDefault: false, confidence: 'high', priority: 62, isActive: true },
  { keyword: 'شريك', matchTarget: 'both', matchMode: 'contains', flowGroup: 'capital', flowKind: 'partner_capital_in', pnlImpact: 'none', partyType: 'partner', requiresEmployee: false, needsReviewByDefault: false, confidence: 'high', priority: 70, isActive: true },
  { keyword: 'رأس مال', matchTarget: 'both', matchMode: 'contains', flowGroup: 'capital', flowKind: 'partner_capital_in', pnlImpact: 'none', partyType: 'partner', requiresEmployee: false, needsReviewByDefault: false, confidence: 'high', priority: 71, isActive: true },
  { keyword: 'راس مال', matchTarget: 'both', matchMode: 'contains', flowGroup: 'capital', flowKind: 'partner_capital_in', pnlImpact: 'none', partyType: 'partner', requiresEmployee: false, needsReviewByDefault: false, confidence: 'high', priority: 72, isActive: true },
  { keyword: 'تمويل', matchTarget: 'both', matchMode: 'contains', flowGroup: 'capital', flowKind: 'partner_capital_in', pnlImpact: 'none', partyType: 'partner', requiresEmployee: false, needsReviewByDefault: false, confidence: 'high', priority: 73, isActive: true },
  { keyword: 'ضخ', matchTarget: 'both', matchMode: 'contains', flowGroup: 'capital', flowKind: 'partner_capital_in', pnlImpact: 'none', partyType: 'partner', requiresEmployee: false, needsReviewByDefault: false, confidence: 'high', priority: 74, isActive: true },
  { keyword: 'تبس', matchTarget: 'both', matchMode: 'contains', flowGroup: 'tips', flowKind: 'tips_collected', pnlImpact: 'none', partyType: 'employee_or_unknown', requiresEmployee: false, needsReviewByDefault: true, confidence: 'medium', priority: 80, isActive: true },
  { keyword: 'tips', matchTarget: 'both', matchMode: 'contains', flowGroup: 'tips', flowKind: 'tips_collected', pnlImpact: 'none', partyType: 'employee_or_unknown', requiresEmployee: false, needsReviewByDefault: true, confidence: 'medium', priority: 81, isActive: true },
];

export async function seedDefaultClassificationSettings(userId?: number): Promise<{
  seededRows: { keywords: number; categoryMappings: number };
  skippedSeeds: string[];
}> {
  const status = await getAccountingSettingsMigrationStatus();
  if (status.migrationRequired) {
    throw new Error('جداول الإعدادات غير موجودة — شغّل الترحيل أولاً');
  }

  const db = await getPool();
  const seededRows = { keywords: 0, categoryMappings: 0 };
  const skippedSeeds: string[] = [];

  for (const rule of DEFAULT_KEYWORD_RULES) {
    const exists = await db.request()
      .input('Keyword', sql.NVarChar(200), rule.keyword)
      .query(`
        SELECT 1 AS x FROM dbo.TblAccountingKeywordClassificationRule WHERE Keyword = @Keyword
      `);
    if (exists.recordset.length > 0) {
      skippedSeeds.push(`keyword:${rule.keyword}`);
      continue;
    }
    await db.request()
      .input('Keyword', sql.NVarChar(200), rule.keyword)
      .input('MatchTarget', sql.NVarChar(20), rule.matchTarget)
      .input('MatchMode', sql.NVarChar(20), rule.matchMode)
      .input('FlowGroup', sql.NVarChar(80), rule.flowGroup)
      .input('FlowKind', sql.NVarChar(80), rule.flowKind)
      .input('PnlImpact', sql.NVarChar(30), rule.pnlImpact)
      .input('PartyType', sql.NVarChar(40), rule.partyType)
      .input('RequiresEmployee', sql.Bit, rule.requiresEmployee)
      .input('NeedsReviewByDefault', sql.Bit, rule.needsReviewByDefault)
      .input('Confidence', sql.NVarChar(10), rule.confidence)
      .input('Priority', sql.Int, rule.priority)
      .input('UserID', sql.Int, userId ?? null)
      .query(`
        INSERT INTO dbo.TblAccountingKeywordClassificationRule
          (Keyword, MatchTarget, MatchMode, FlowGroup, FlowKind, PnlImpact, PartyType,
           RequiresEmployee, NeedsReviewByDefault, Confidence, Priority, CreatedByUserID, UpdatedByUserID)
        VALUES
          (@Keyword, @MatchTarget, @MatchMode, @FlowGroup, @FlowKind, @PnlImpact, @PartyType,
           @RequiresEmployee, @NeedsReviewByDefault, @Confidence, @Priority, @UserID, @UserID)
      `);
    seededRows.keywords += 1;
  }

  const cats = await db.request().query(`SELECT ExpINID, CatName FROM dbo.TblExpINCat`);
  for (const cat of cats.recordset as { ExpINID: number; CatName: string }[]) {
    const norm = normalizeForMatch(cat.CatName);
    const isOperating = OPERATING_CATEGORY_NAMES.some((n) => norm.includes(normalizeForMatch(n)));
    const isTips = norm.includes(normalizeForMatch('تبس')) || norm.includes('tips');

    if (!isTips && !isOperating) continue;

    const existing = await db.request()
      .input('ExpINID', sql.Int, cat.ExpINID)
      .query(`SELECT 1 AS x FROM dbo.TblAccountingCategoryClassificationMap WHERE ExpINID = @ExpINID`);
    if (existing.recordset.length > 0) {
      skippedSeeds.push(`category:${cat.ExpINID}`);
      continue;
    }

    if (isTips) {
      await insertCategoryMappingSeed({
        expInId: cat.ExpINID,
        flowGroup: 'tips',
        flowKind: 'tips_collected',
        pnlImpact: 'none',
        partyType: 'employee_or_unknown',
        requiresEmployee: false,
        needsReviewByDefault: true,
        confidence: 'medium',
        notes: 'تصنيف تلقائي: تبس',
        userId,
      });
    } else {
      await insertCategoryMappingSeed({
        expInId: cat.ExpINID,
        flowGroup: 'operating',
        flowKind: 'operating_expense',
        pnlImpact: 'expense',
        partyType: 'none',
        requiresEmployee: false,
        needsReviewByDefault: false,
        confidence: 'high',
        notes: 'تصنيف تلقائي: مصروف تشغيل',
        userId,
      });
    }
    seededRows.categoryMappings += 1;
  }

  for (const cat of cats.recordset as { ExpINID: number; CatName: string }[]) {
    const norm = normalizeForMatch(cat.CatName);
    const businessDefault = BUSINESS_CATEGORY_DEFAULTS.find(
      (d) => normalizeForMatch(d.exactName) === norm,
    );
    if (!businessDefault) continue;

    await insertCategoryMappingSeed({
      expInId: cat.ExpINID,
      flowGroup: businessDefault.flowGroup,
      flowKind: businessDefault.flowKind,
      pnlImpact: businessDefault.pnlImpact,
      partyType: businessDefault.partyType,
      requiresEmployee: businessDefault.requiresEmployee,
      needsReviewByDefault: businessDefault.needsReviewByDefault,
      confidence: businessDefault.confidence,
      notes: businessDefault.notes,
      userId,
    });
  }

  return { seededRows, skippedSeeds };
}

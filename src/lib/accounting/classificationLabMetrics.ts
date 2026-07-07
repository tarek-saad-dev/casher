/**
 * Read-only metrics and grouping for the classification lab dashboard.
 */

import type {
  CashMoveClassification,
  ClassificationAuditSummary,
  ClassificationConfidence,
  PnlImpact,
} from '@/lib/accounting/cashMoveClassification';

export type LabBucketKey =
  | 'sales'
  | 'operating'
  | 'payroll'
  | 'advances'
  | 'bonus_commission'
  | 'tips'
  | 'transfers'
  | 'capital'
  | 'unclassified';

export type ReadinessStatus = 'ready' | 'needs_cleanup' | 'not_ready';

export type RiskType =
  | 'needs_review'
  | 'low_confidence'
  | 'unknown_classification'
  | 'missing_employee'
  | 'revenue_expense_unknown';

export interface LabBucketDefinition {
  key: LabBucketKey;
  label: string;
  color: string;
}

export const LAB_BUCKET_DEFINITIONS: LabBucketDefinition[] = [
  { key: 'sales', label: 'مبيعات فعلية', color: 'emerald' },
  { key: 'operating', label: 'مصروفات تشغيل', color: 'orange' },
  { key: 'payroll', label: 'مرتبات', color: 'violet' },
  { key: 'advances', label: 'سلف موظفين', color: 'amber' },
  { key: 'bonus_commission', label: 'تارجت / عمولات / بونص', color: 'cyan' },
  { key: 'tips', label: 'تبس / إكراميات', color: 'pink' },
  { key: 'transfers', label: 'تحويلات داخلية', color: 'zinc' },
  { key: 'capital', label: 'رأس مال / تمويل / قرض للمحل', color: 'blue' },
  { key: 'unclassified', label: 'غير مصنف / يحتاج مراجعة', color: 'rose' },
];

export interface LabBucketStats {
  key: LabBucketKey;
  label: string;
  color: string;
  count: number;
  totalAmount: number;
  pnlImpact: PnlImpact | 'mixed';
  confidence: Record<ClassificationConfidence, number>;
  needsReviewCount: number;
}

export interface ReadinessResult {
  score: number;
  status: ReadinessStatus;
  statusLabel: string;
  deductions: {
    needsReviewPct: number;
    lowConfidencePct: number;
    unclassifiedPct: number;
    payrollMissingEmployeePct: number;
  };
}

export interface PnlSimulation {
  cashIn: number;
  cashOut: number;
  revenue: number;
  expense: number;
  contraExpense: number;
  noPnlImpact: number;
  unknown: number;
}

export interface LabKpis {
  totalRows: number;
  totalAmount: number;
  needsReviewCount: number;
  needsReviewPct: number;
  lowConfidenceCount: number;
  unclassifiedCount: number;
  payrollMissingEmployeeCount: number;
  internalTransfersTotal: number;
  pnlImpactingAmount: number;
  nonPnlAmount: number;
}

export interface EmployeePayrollGroup {
  empId: number | null;
  empLabel: string;
  advances: { count: number; amount: number };
  salaryPayouts: { count: number; amount: number };
  bonusCommission: { count: number; amount: number };
  deductions: { count: number; amount: number };
  missingEmployee: { count: number; amount: number };
  rows: CashMoveClassification[];
}

export const RISK_TYPE_LABELS: Record<RiskType, string> = {
  needs_review: 'يحتاج مراجعة',
  low_confidence: 'ثقة منخفضة',
  unknown_classification: 'تصنيف غير معروف',
  missing_employee: 'مرتبط بالمرتبات بدون موظف',
  revenue_expense_unknown: 'إيراد/مصروف غير مصنف',
};

export function isRevenueOrExpenseInvType(invType: string): boolean {
  const t = invType.trim();
  return t === 'مصروفات' || t === 'ايرادات';
}

export function isPayrollMissingEmployee(row: CashMoveClassification): boolean {
  return (
    (row.suggestedFlowGroup === 'payroll' || row.suggestedFlowGroup === 'employee_advance') &&
    !row.suggestedEmpId
  );
}

export function isUnknownRow(row: CashMoveClassification): boolean {
  return (
    row.suggestedFlowGroup === 'unclassified' ||
    row.suggestedFlowKind === 'unknown' ||
    row.suggestedFlowKind === 'operating_expense' ||
    row.suggestedFlowKind === 'misc_income'
  );
}

export function getRiskTypes(row: CashMoveClassification): RiskType[] {
  const risks: RiskType[] = [];
  if (row.needsReview) risks.push('needs_review');
  if (row.confidence === 'low') risks.push('low_confidence');
  if (row.suggestedFlowGroup === 'unclassified' || row.suggestedFlowKind === 'unknown') {
    risks.push('unknown_classification');
  }
  if (isPayrollMissingEmployee(row)) risks.push('missing_employee');
  if (
    isRevenueOrExpenseInvType(row.invType) &&
    (row.suggestedFlowGroup === 'unclassified' || row.suggestedFlowKind === 'unknown')
  ) {
    risks.push('revenue_expense_unknown');
  }
  return risks;
}

export function isRiskyRow(row: CashMoveClassification): boolean {
  return getRiskTypes(row).length > 0;
}

export function assignLabBucket(row: CashMoveClassification): LabBucketKey {
  if (row.suggestedFlowGroup === 'sales') return 'sales';
  if (row.suggestedFlowGroup === 'tips' || row.suggestedFlowKind === 'tips_collected') return 'tips';
  if (row.suggestedFlowGroup === 'employee_advance') return 'advances';
  if (row.suggestedFlowKind === 'bonus_or_commission_payout') return 'bonus_commission';
  if (row.suggestedFlowGroup === 'payroll') return 'payroll';
  if (row.suggestedFlowGroup === 'transfer') return 'transfers';
  if (row.suggestedFlowGroup === 'capital') return 'capital';
  if (
    row.suggestedFlowGroup === 'unclassified' ||
    row.suggestedFlowKind === 'unknown' ||
    row.needsReview
  ) {
    return 'unclassified';
  }
  if (row.suggestedFlowGroup === 'operating' || row.suggestedFlowKind === 'operating_expense') {
    return 'operating';
  }
  if (row.suggestedPnlImpact === 'expense' && row.suggestedFlowGroup !== 'payroll') {
    return 'operating';
  }
  return 'unclassified';
}

function dominantPnlImpact(rows: CashMoveClassification[]): PnlImpact | 'mixed' {
  const impacts = new Set(rows.map((r) => r.suggestedPnlImpact));
  if (impacts.size === 1) return [...impacts][0];
  return 'mixed';
}

export function buildLabBuckets(rows: CashMoveClassification[]): LabBucketStats[] {
  const grouped = new Map<LabBucketKey, CashMoveClassification[]>();
  for (const def of LAB_BUCKET_DEFINITIONS) grouped.set(def.key, []);

  for (const row of rows) {
    grouped.get(assignLabBucket(row))!.push(row);
  }

  return LAB_BUCKET_DEFINITIONS.map((def) => {
    const bucketRows = grouped.get(def.key) ?? [];
    const confidence: Record<ClassificationConfidence, number> = {
      high: 0,
      medium: 0,
      low: 0,
    };
    for (const r of bucketRows) confidence[r.confidence] += 1;

    return {
      key: def.key,
      label: def.label,
      color: def.color,
      count: bucketRows.length,
      totalAmount: bucketRows.reduce((s, r) => s + Math.abs(r.amount), 0),
      pnlImpact: bucketRows.length ? dominantPnlImpact(bucketRows) : 'none',
      confidence,
      needsReviewCount: bucketRows.filter((r) => r.needsReview).length,
    };
  });
}

export function computeReadiness(
  rows: CashMoveClassification[],
  summary: ClassificationAuditSummary,
): ReadinessResult {
  const total = summary.totalRows || rows.length || 1;
  const needsReviewCount =
    summary.byNeedsReview.find((b) => b.key === 'true')?.count ??
    rows.filter((r) => r.needsReview).length;
  const lowConfidenceCount =
    summary.byConfidence.find((b) => b.key === 'low')?.count ??
    rows.filter((r) => r.confidence === 'low').length;
  const unclassifiedCount =
    summary.byFlowGroup.find((b) => b.key === 'unclassified')?.count ??
    rows.filter((r) => r.suggestedFlowGroup === 'unclassified').length;
  const payrollMissingCount = rows.filter(isPayrollMissingEmployee).length;

  const needsReviewPct = (needsReviewCount / total) * 100;
  const lowConfidencePct = (lowConfidenceCount / total) * 100;
  const unclassifiedPct = (unclassifiedCount / total) * 100;
  const payrollMissingEmployeePct = (payrollMissingCount / total) * 100;

  const score = Math.max(
    0,
    Math.min(
      100,
      Math.round(
        100 -
          needsReviewPct -
          lowConfidencePct -
          unclassifiedPct -
          payrollMissingEmployeePct,
      ),
    ),
  );

  let status: ReadinessStatus = 'not_ready';
  let statusLabel = 'غير جاهز';
  if (score >= 85) {
    status = 'ready';
    statusLabel = 'جاهز';
  } else if (score >= 65) {
    status = 'needs_cleanup';
    statusLabel = 'يحتاج تنظيف';
  }

  return {
    score,
    status,
    statusLabel,
    deductions: {
      needsReviewPct,
      lowConfidencePct,
      unclassifiedPct,
      payrollMissingEmployeePct,
    },
  };
}

export function computePnlSimulation(rows: CashMoveClassification[]): PnlSimulation {
  const sim: PnlSimulation = {
    cashIn: 0,
    cashOut: 0,
    revenue: 0,
    expense: 0,
    contraExpense: 0,
    noPnlImpact: 0,
    unknown: 0,
  };

  for (const row of rows) {
    const amt = Math.abs(row.amount);
    if (row.inOut === 'in') sim.cashIn += amt;
    else sim.cashOut += amt;

    switch (row.suggestedPnlImpact) {
      case 'revenue':
        sim.revenue += amt;
        break;
      case 'expense':
        sim.expense += amt;
        break;
      case 'contra_expense':
        sim.contraExpense += amt;
        break;
      case 'none':
        sim.noPnlImpact += amt;
        break;
      default:
        sim.unknown += amt;
    }

    if (row.suggestedFlowGroup === 'unclassified' || row.suggestedFlowKind === 'unknown') {
      sim.unknown += 0; // already counted in pnl bucket
    }
  }

  return sim;
}

export function computeLabKpis(
  rows: CashMoveClassification[],
  summary: ClassificationAuditSummary,
): LabKpis {
  const totalRows = summary.totalRows || rows.length;
  const totalAmount = summary.byFlowGroup.reduce((s, b) => s + b.totalAmount, 0);
  const needsReviewCount =
    summary.byNeedsReview.find((b) => b.key === 'true')?.count ??
    rows.filter((r) => r.needsReview).length;
  const lowConfidenceCount =
    summary.byConfidence.find((b) => b.key === 'low')?.count ??
    rows.filter((r) => r.confidence === 'low').length;
  const unclassifiedCount =
    summary.byFlowGroup.find((b) => b.key === 'unclassified')?.count ??
    rows.filter((r) => r.suggestedFlowGroup === 'unclassified').length;

  let internalTransfersTotal = 0;
  let pnlImpactingAmount = 0;
  let nonPnlAmount = 0;

  for (const row of rows) {
    const amt = Math.abs(row.amount);
    if (row.suggestedFlowGroup === 'transfer') internalTransfersTotal += amt;
    if (row.suggestedPnlImpact === 'none') nonPnlAmount += amt;
    else pnlImpactingAmount += amt;
  }

  const transferBucket = summary.byFlowGroup.find((b) => b.key === 'transfer');
  if (transferBucket && rows.length < totalRows) {
    internalTransfersTotal = transferBucket.totalAmount;
  }

  const pnlFromSummary = summary.byPnlImpact
    .filter((b) => b.key !== 'none')
    .reduce((s, b) => s + b.totalAmount, 0);
  const nonPnlFromSummary =
    summary.byPnlImpact.find((b) => b.key === 'none')?.totalAmount ?? 0;

  if (rows.length < totalRows) {
    pnlImpactingAmount = pnlFromSummary;
    nonPnlAmount = nonPnlFromSummary;
  }

  return {
    totalRows,
    totalAmount,
    needsReviewCount,
    needsReviewPct: totalRows ? (needsReviewCount / totalRows) * 100 : 0,
    lowConfidenceCount,
    unclassifiedCount,
    payrollMissingEmployeeCount: rows.filter(isPayrollMissingEmployee).length,
    internalTransfersTotal,
    pnlImpactingAmount,
    nonPnlAmount,
  };
}

function employeeLabel(row: CashMoveClassification): string {
  if (row.linkedPayrollTxn?.empName) return row.linkedPayrollTxn.empName;
  if (row.suggestedEmpId) return `موظف #${row.suggestedEmpId}`;
  return 'بدون موظف';
}

export function buildEmployeePayrollGroups(rows: CashMoveClassification[]): EmployeePayrollGroup[] {
  const map = new Map<string, EmployeePayrollGroup>();

  const payrollRows = rows.filter(
    (r) =>
      r.suggestedFlowGroup === 'payroll' ||
      r.suggestedFlowGroup === 'employee_advance' ||
      isPayrollMissingEmployee(r),
  );

  for (const row of payrollRows) {
    const empId = row.suggestedEmpId;
    const key = empId != null ? String(empId) : '__missing__';
    const label = empId != null ? employeeLabel(row) : 'بدون موظف';

    if (!map.has(key)) {
      map.set(key, {
        empId,
        empLabel: label,
        advances: { count: 0, amount: 0 },
        salaryPayouts: { count: 0, amount: 0 },
        bonusCommission: { count: 0, amount: 0 },
        deductions: { count: 0, amount: 0 },
        missingEmployee: { count: 0, amount: 0 },
        rows: [],
      });
    }

    const group = map.get(key)!;
    group.rows.push(row);
    const amt = Math.abs(row.amount);

    if (isPayrollMissingEmployee(row)) {
      group.missingEmployee.count += 1;
      group.missingEmployee.amount += amt;
    } else if (row.suggestedFlowGroup === 'employee_advance') {
      group.advances.count += 1;
      group.advances.amount += amt;
    } else if (row.suggestedFlowKind === 'bonus_or_commission_payout') {
      group.bonusCommission.count += 1;
      group.bonusCommission.amount += amt;
    } else if (row.suggestedFlowKind === 'salary_deduction') {
      group.deductions.count += 1;
      group.deductions.amount += amt;
    } else if (
      row.suggestedFlowKind === 'salary_payout' ||
      row.suggestedFlowKind === 'employee_final_settlement' ||
      row.suggestedFlowGroup === 'payroll'
    ) {
      group.salaryPayouts.count += 1;
      group.salaryPayouts.amount += amt;
    }
  }

  return [...map.values()].sort((a, b) => {
    if (a.empId == null) return 1;
    if (b.empId == null) return -1;
    return a.empLabel.localeCompare(b.empLabel, 'ar');
  });
}

export function dedupeRows(rows: CashMoveClassification[]): CashMoveClassification[] {
  const seen = new Set<number>();
  const out: CashMoveClassification[] = [];
  for (const row of rows) {
    if (seen.has(row.cashMoveId)) continue;
    seen.add(row.cashMoveId);
    out.push(row);
  }
  return out;
}

export const CSV_HEADERS = [
  'cashMoveId',
  'invDate',
  'amount',
  'inOut',
  'invType',
  'categoryName',
  'notes',
  'linkedPayrollTxn',
  'suggestedFlowGroup',
  'suggestedFlowKind',
  'suggestedPnlImpact',
  'suggestedPartyType',
  'suggestedEmpId',
  'confidence',
  'needsReview',
  'reason',
  'matchedRuleSource',
  'matchedRuleId',
  'matchedKeyword',
  'fromAdminMapping',
];

function formatLinkedPayroll(row: CashMoveClassification): string {
  const txn = row.linkedPayrollTxn;
  if (!txn) return '';
  const name = txn.empName ? ` · ${txn.empName}` : '';
  return `${txn.source} #${txn.id}${name}`;
}

export function rowsToCsv(rows: CashMoveClassification[]): string {
  const lines = [
    CSV_HEADERS.join(','),
    ...rows.map((row) =>
      [
        row.cashMoveId,
        row.invDate,
        row.amount,
        row.inOut,
        row.invType,
        row.categoryName ?? '',
        row.notes ?? '',
        formatLinkedPayroll(row),
        row.suggestedFlowGroup,
        row.suggestedFlowKind,
        row.suggestedPnlImpact,
        row.suggestedPartyType,
        row.suggestedEmpId ?? '',
        row.confidence,
        row.needsReview,
        row.reason,
        row.matchedRuleSource,
        row.matchedRuleId ?? '',
        row.matchedKeyword ?? '',
        row.fromAdminMapping,
      ]
        .map((cell) => `"${String(cell).replace(/"/g, '""')}"`)
        .join(','),
    ),
  ];
  return '\ufeff' + lines.join('\n');
}

export function downloadCsv(filename: string, rows: CashMoveClassification[]) {
  const blob = new Blob([rowsToCsv(rows)], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
  URL.revokeObjectURL(link.href);
}

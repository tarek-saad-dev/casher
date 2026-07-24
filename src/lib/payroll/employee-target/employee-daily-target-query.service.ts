import 'server-only';

import Decimal from 'decimal.js';
import { calculateDailyTarget } from './calculate-daily-target';
import { amountStr, moneyStr } from './calculation-breakdown-json';
import {
  deriveTargetDisplayStatus,
  type TargetDisplayStatus,
  type TargetPersistenceStatus,
} from './employee-daily-target.schemas';
import {
  listDailyTargetsByWorkDate,
  listEnabledPlansCoveringDate,
  listTiersForPlanIds,
  type DailyTargetRow,
  type EffectiveTargetPlanRow,
  type TargetTierDbRow,
} from './employee-daily-target.repository';
import { resolveUniqueEffectivePlans } from './effective-plan-resolve';
import { getEmployeesNetServiceSalesByDate } from './employee-target-sales-service';
import { assertValidWorkDate, EmployeeTargetValidationError } from './target.validation';
import type { DailyTargetTier, TargetInputBasis } from './target.types';
import { listTargetRecalcRequestsForDate } from './employee-target-recalc.repository';
import type { TargetSyncStatus } from './employee-target-recalc.schemas';
import type { TargetRecalcRequestRow } from './employee-target-recalc.repository';

export interface DailyTargetQueryEmployee {
  empId: number;
  empName: string;
  targetPlanId: number;
  planEffectiveFrom: string;
  planEffectiveTo: string | null;
  inputBasis: TargetInputBasis;
  conversionDays: number;
  tierCount: number;
  firstDailyStartAmount: string;
  firstRatePercent: string;
  planSummary: string;
  /** Live sales from shared core for the work date. */
  currentNetSalesAfterDiscount: string;
  /** Stored value when generated; null if not_generated. */
  storedNetSalesAfterDiscount: string | null;
  storedTargetAmount: string | null;
  persistenceStatus: TargetPersistenceStatus;
  displayStatus: TargetDisplayStatus | null;
  dailyTargetId: number | null;
  calculationVersion: string | null;
  calculationBreakdownJson: string | null;
  generatedAt: string | null;
  updatedAt: string | null;
  /** Preview using current sales + plan (not persisted). */
  previewTargetAmount: string;
  previewBreakdown: Array<{
    from: string;
    to: string | null;
    eligibleAmount: string;
    ratePercent: string;
    targetAmount: string;
  }>;
  tiers: Array<{
    sortOrder: number;
    dailyStartAmount: string;
    ratePercent: string;
    inputStartAmount: string;
  }>;
  syncStatus: TargetSyncStatus;
  syncRequestedAt: string | null;
  syncProcessedAt: string | null;
  syncAttemptCount: number;
  syncLastErrorSafe: string | null;
}

export interface DailyTargetDayQueryResult {
  workDate: string;
  totals: {
    eligibleEmployees: number;
    notGenerated: number;
    generated: number;
    recalculated: number;
    zeroSales: number;
    belowFirstTier: number;
    earnedTarget: number;
    totalCurrentNetSalesAfterDiscount: string;
    totalStoredTargetAmount: string;
  };
  employees: DailyTargetQueryEmployee[];
  planConflicts: string[];
}

function planSummaryLabel(tiers: DailyTargetTier[]): string {
  if (tiers.length === 0) return 'لا توجد شرائح';
  const first = tiers[0]!;
  if (tiers.length === 1) {
    return `فوق ${amountStr(first.dailyStartAmount, 2)} = ${amountStr(first.ratePercent, 2)}%`;
  }
  return `${tiers.length} شرائح · يبدأ من ${amountStr(first.dailyStartAmount, 2)}`;
}

function toCalcTiers(planId: number, allTiers: TargetTierDbRow[]): DailyTargetTier[] {
  return allTiers
    .filter((t) => t.targetPlanId === planId)
    .map((t) => ({
      sortOrder: t.sortOrder,
      inputStartAmount: t.inputStartAmount,
      dailyStartAmount: t.dailyStartAmount,
      ratePercent: t.ratePercent,
    }));
}

export function deriveTargetSyncStatus(
  req: TargetRecalcRequestRow | null | undefined,
): {
  syncStatus: TargetSyncStatus;
  syncRequestedAt: string | null;
  syncProcessedAt: string | null;
  syncAttemptCount: number;
  syncLastErrorSafe: string | null;
} {
  if (!req) {
    return {
      syncStatus: 'up_to_date',
      syncRequestedAt: null,
      syncProcessedAt: null,
      syncAttemptCount: 0,
      syncLastErrorSafe: null,
    };
  }
  let syncStatus: TargetSyncStatus = 'up_to_date';
  if (req.status === 'pending') syncStatus = 'pending';
  else if (req.status === 'processing') syncStatus = 'processing';
  else if (req.status === 'failed') syncStatus = 'failed';
  else if (req.status === 'completed' && req.requestedVersion > req.processedVersion) {
    syncStatus = 'pending';
  }

  return {
    syncStatus,
    syncRequestedAt: req.requestedAt,
    syncProcessedAt: req.processedAt,
    syncAttemptCount: req.attemptCount,
    syncLastErrorSafe: req.status === 'failed' ? req.lastError : null,
  };
}

function mapOneEmployee(params: {
  plan: EffectiveTargetPlanRow;
  tiers: DailyTargetTier[];
  currentSales: number;
  stored: DailyTargetRow | null;
  recalcRequest: TargetRecalcRequestRow | null;
}): DailyTargetQueryEmployee {
  const { plan, tiers, currentSales, stored, recalcRequest } = params;
  const calc = calculateDailyTarget(currentSales, tiers);
  const first = tiers[0];

  let persistenceStatus: TargetPersistenceStatus = 'not_generated';
  if (stored?.status === 'recalculated') persistenceStatus = 'recalculated';
  else if (stored) persistenceStatus = 'generated';

  const displayStatus: TargetDisplayStatus | null = stored
    ? deriveTargetDisplayStatus(stored.netSalesAfterDiscount, stored.targetAmount)
    : null;

  const sync = deriveTargetSyncStatus(recalcRequest);

  return {
    empId: plan.empId,
    empName: plan.empName,
    targetPlanId: plan.planId,
    planEffectiveFrom: plan.effectiveFrom,
    planEffectiveTo: plan.effectiveTo,
    inputBasis: plan.inputBasis,
    conversionDays: plan.conversionDays,
    tierCount: tiers.length,
    firstDailyStartAmount: first ? amountStr(first.dailyStartAmount) : '0.000000',
    firstRatePercent: first ? amountStr(first.ratePercent) : '0.000000',
    planSummary: planSummaryLabel(tiers),
    currentNetSalesAfterDiscount: moneyStr(currentSales),
    storedNetSalesAfterDiscount: stored ? moneyStr(stored.netSalesAfterDiscount) : null,
    storedTargetAmount: stored ? moneyStr(stored.targetAmount) : null,
    persistenceStatus,
    displayStatus,
    dailyTargetId: stored?.id ?? null,
    calculationVersion: stored?.calculationVersion ?? null,
    calculationBreakdownJson: stored?.calculationBreakdownJson ?? null,
    generatedAt: stored?.generatedAt ?? null,
    updatedAt: stored?.updatedAt ?? null,
    previewTargetAmount: moneyStr(calc.targetAmount),
    previewBreakdown: calc.breakdown.map((b) => ({
      from: amountStr(b.from),
      to: b.to == null ? null : amountStr(b.to),
      eligibleAmount: amountStr(b.eligibleAmount),
      ratePercent: amountStr(b.ratePercent),
      targetAmount: amountStr(b.targetAmount),
    })),
    tiers: tiers.map((t) => ({
      sortOrder: t.sortOrder,
      dailyStartAmount: amountStr(t.dailyStartAmount),
      ratePercent: amountStr(t.ratePercent),
      inputStartAmount: amountStr(t.inputStartAmount),
    })),
    ...sync,
  };
}

/**
 * Read model for a work date: all employees with an enabled covering plan,
 * live sales, and optional stored TblEmpDailyTarget — no N+1.
 */
export async function getEmployeeDailyTargetsForDate(
  workDate: string,
  empIds?: number[] | null,
  branchId?: number,
): Promise<DailyTargetDayQueryResult> {
  assertValidWorkDate(workDate);
  if (branchId == null || !Number.isInteger(branchId) || branchId <= 0) {
    throw new EmployeeTargetValidationError('branchId مطلوب لاستعلام التارجت (Phase 1L)');
  }

  const filterIds =
    empIds != null && empIds.length > 0
      ? [...new Set(empIds.filter((id) => Number.isInteger(id) && id > 0))]
      : null;

  if (empIds != null && filterIds != null && filterIds.length === 0) {
    throw new EmployeeTargetValidationError('empIds غير صالحة');
  }

  const plans = await listEnabledPlansCoveringDate(workDate, filterIds, branchId);

  const planConflicts: string[] = [];
  let planByEmp: Map<number, EffectiveTargetPlanRow>;
  try {
    planByEmp = resolveUniqueEffectivePlans(plans);
  } catch (err) {
    // Still return partials for GET: drop conflicting emps and surface message.
    const byEmp = new Map<number, EffectiveTargetPlanRow[]>();
    for (const p of plans) {
      const list = byEmp.get(p.empId) ?? [];
      list.push(p);
      byEmp.set(p.empId, list);
    }
    planByEmp = new Map();
    for (const [empId, list] of byEmp) {
      if (list.length > 1) {
        planConflicts.push(
          `${list[0]!.empName} (EmpID=${empId}) — خطط: ${list.map((x) => x.planId).join(', ')}`,
        );
      } else {
        planByEmp.set(empId, list[0]!);
      }
    }
    if (err instanceof Error && planConflicts.length === 0) {
      throw err;
    }
  }

  const planIds = [...planByEmp.values()].map((p) => p.planId);
  const allTiers = await listTiersForPlanIds(planIds);
  const eligibleEmpIds = [...planByEmp.keys()];

  const [salesRows, storedRows, recalcRows] = await Promise.all([
    eligibleEmpIds.length > 0
      ? getEmployeesNetServiceSalesByDate(workDate, branchId, eligibleEmpIds)
      : Promise.resolve([]),
    listDailyTargetsByWorkDate(workDate, filterIds),
    listTargetRecalcRequestsForDate(workDate, filterIds).catch(() => [] as TargetRecalcRequestRow[]),
  ]);

  const salesByEmp = new Map(salesRows.map((r) => [r.empId, r.netSalesAfterDiscount]));
  const storedByEmp = new Map(
    storedRows
      .filter((r) => r.branchId === branchId)
      .map((r) => [r.empId, r]),
  );
  const recalcByEmp = new Map(
    recalcRows
      .filter((r) => r.branchId === branchId)
      .map((r) => [r.empId, r]),
  );

  const employees: DailyTargetQueryEmployee[] = [];
  let notGenerated = 0;
  let generated = 0;
  let recalculated = 0;
  let zeroSales = 0;
  let belowFirstTier = 0;
  let earnedTarget = 0;
  let totalCurrentSales = new Decimal(0);
  let totalStoredTarget = new Decimal(0);

  for (const empId of eligibleEmpIds.sort((a, b) => a - b)) {
    const plan = planByEmp.get(empId)!;
    const tiers = toCalcTiers(plan.planId, allTiers);
    const currentSales = Number(salesByEmp.get(empId) ?? 0);
    const stored = storedByEmp.get(empId) ?? null;
    const row = mapOneEmployee({
      plan,
      tiers,
      currentSales,
      stored,
      recalcRequest: recalcByEmp.get(empId) ?? null,
    });
    employees.push(row);

    totalCurrentSales = totalCurrentSales.plus(currentSales);
    if (row.persistenceStatus === 'not_generated') notGenerated += 1;
    else if (row.persistenceStatus === 'generated') generated += 1;
    else recalculated += 1;

    if (row.displayStatus === 'no_sales') zeroSales += 1;
    else if (row.displayStatus === 'below_first_tier') belowFirstTier += 1;
    else if (row.displayStatus === 'earned_target') earnedTarget += 1;

    if (stored) totalStoredTarget = totalStoredTarget.plus(stored.targetAmount);
  }

  employees.sort((a, b) => a.empName.localeCompare(b.empName, 'ar'));

  return {
    workDate,
    totals: {
      eligibleEmployees: employees.length,
      notGenerated,
      generated,
      recalculated,
      zeroSales,
      belowFirstTier,
      earnedTarget,
      totalCurrentNetSalesAfterDiscount: moneyStr(totalCurrentSales),
      totalStoredTargetAmount: moneyStr(totalStoredTarget),
    },
    employees,
    planConflicts,
  };
}

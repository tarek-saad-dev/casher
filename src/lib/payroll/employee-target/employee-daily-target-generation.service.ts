import 'server-only';

import Decimal from 'decimal.js';
import { getPool, sql } from '@/lib/db';
import { assertEmpBranchWorkDayMutable } from '@/lib/hr/empBranchWorkDayClose.service';
import { calculateDailyTarget } from './calculate-daily-target';
import {
  buildCalculationBreakdownJson,
  CALCULATION_VERSION,
  moneyStr,
  amountStr,
} from './calculation-breakdown-json';
import {
  deriveTargetDisplayStatus,
  type TargetDisplayStatus,
  type TargetUpsertStatus,
} from './employee-daily-target.schemas';
import {
  listEnabledPlansCoveringDate,
  listTiersForPlanIds,
  upsertDailyTargetInTransaction,
  type TargetTierDbRow,
} from './employee-daily-target.repository';
import {
  EmployeeDailyTargetDomainError,
  resolveUniqueEffectivePlans,
} from './effective-plan-resolve';
import {
  getEmployeesNetServiceSalesByDate,
  getEmployeesNetServiceSalesByDateRange,
} from './employee-target-sales-service';
import {
  assertValidWorkDate,
  EmployeeTargetValidationError,
  monthStartFromWorkDate,
  previousWorkDateInMonth,
} from './target.validation';
import type { DailyTargetTier } from './target.types';
import {
  syncEmployeeDailyTargetLedgerEntry,
  EmployeeDailyTargetLedgerConflictError,
} from './employee-daily-target-ledger-sync.service';
import type { TargetLedgerSyncAction } from './employee-daily-target-ledger.schemas';

export {
  EmployeeDailyTargetDomainError,
  resolveUniqueEffectivePlans,
  EmployeeDailyTargetLedgerConflictError,
};

export interface GenerateEmployeeDailyTargetsParams {
  workDate: string;
  /** Required Phase 1L — invoice/target branch; never from browser body alone. */
  branchId: number;
  generatedByUserId: number | null;
  empIds?: number[] | null;
}

export interface GeneratedTargetEmployeeResult {
  empId: number;
  empName: string;
  dailyTargetId: number;
  targetPlanId: number;
  planEffectiveFrom: string;
  planEffectiveTo: string | null;
  /** Day-only sales (column NetSalesAfterDiscount). */
  netSalesAfterDiscount: string;
  /** Day payable = MTD target delta (column TargetAmount). */
  targetAmount: string;
  mtdSales: string;
  mtdTargetAmount: string;
  dayDelta: string;
  persistenceStatus: TargetUpsertStatus;
  displayStatus: TargetDisplayStatus;
  ledgerSyncAction: TargetLedgerSyncAction;
  ledgerEntryId: number | null;
  tierCount: number;
  firstDailyStartAmount: string;
  firstRatePercent: string;
  breakdown: Array<{
    from: string;
    to: string | null;
    eligibleAmount: string;
    ratePercent: string;
    targetAmount: string;
  }>;
  generatedAt: string;
  updatedAt: string | null;
}

export interface GenerateEmployeeDailyTargetsResult {
  workDate: string;
  totals: {
    eligibleEmployees: number;
    generated: number;
    recalculated: number;
    zeroSales: number;
    belowFirstTier: number;
    earnedTarget: number;
    totalNetSalesAfterDiscount: string;
    totalTargetAmount: string;
    ledgerInserted: number;
    ledgerUpdated: number;
    ledgerDeleted: number;
    ledgerUnchanged: number;
  };
  employees: GeneratedTargetEmployeeResult[];
}

function tiersForPlan(planId: number, allTiers: TargetTierDbRow[]): DailyTargetTier[] {
  return allTiers
    .filter((t) => t.targetPlanId === planId)
    .map((t) => ({
      sortOrder: t.sortOrder,
      inputStartAmount: t.inputStartAmount,
      // MTD engine: monthly input thresholds applied to cumulative sales.
      dailyStartAmount: t.inputStartAmount,
      ratePercent: t.ratePercent,
    }));
}

function moneyNumber(value: Decimal | number | string): number {
  return Number(moneyStr(value));
}

export async function generateEmployeeDailyTargets(
  params: GenerateEmployeeDailyTargetsParams,
): Promise<GenerateEmployeeDailyTargetsResult> {
  const { workDate, generatedByUserId, branchId } = params;
  assertValidWorkDate(workDate);
  if (!Number.isInteger(branchId) || branchId <= 0) {
    throw new EmployeeTargetValidationError('branchId مطلوب لتوليد التارجت (Phase 1L)');
  }
  await assertEmpBranchWorkDayMutable(branchId, workDate);

  const empIds =
    params.empIds != null && params.empIds.length > 0
      ? [...new Set(params.empIds.filter((id) => Number.isInteger(id) && id > 0))]
      : null;

  if (params.empIds != null && empIds != null && empIds.length === 0) {
    throw new EmployeeTargetValidationError('empIds غير صالحة');
  }

  const plans = await listEnabledPlansCoveringDate(workDate, empIds, branchId);
  const planByEmp = resolveUniqueEffectivePlans(plans);

  if (planByEmp.size === 0) {
    return {
      workDate,
      totals: {
        eligibleEmployees: 0,
        generated: 0,
        recalculated: 0,
        zeroSales: 0,
        belowFirstTier: 0,
        earnedTarget: 0,
        totalNetSalesAfterDiscount: '0.00',
        totalTargetAmount: '0.00',
        ledgerInserted: 0,
        ledgerUpdated: 0,
        ledgerDeleted: 0,
        ledgerUnchanged: 0,
      },
      employees: [],
    };
  }

  const planIds = [...planByEmp.values()].map((p) => p.planId);
  const allTiers = await listTiersForPlanIds(planIds);
  const eligibleEmpIds = [...planByEmp.keys()];
  const monthStart = monthStartFromWorkDate(workDate);
  const priorWorkDate = previousWorkDateInMonth(workDate);

  const [daySalesRows, mtdSalesRows] = await Promise.all([
    getEmployeesNetServiceSalesByDate(workDate, branchId, eligibleEmpIds),
    getEmployeesNetServiceSalesByDateRange(monthStart, workDate, branchId, eligibleEmpIds),
  ]);
  const daySalesByEmp = new Map(daySalesRows.map((r) => [r.empId, r]));
  const mtdSalesByEmp = new Map(mtdSalesRows.map((r) => [r.empId, r]));

  const db = await getPool();
  const transaction = new sql.Transaction(db);
  await transaction.begin();

  const employees: GeneratedTargetEmployeeResult[] = [];
  let generated = 0;
  let recalculated = 0;
  let zeroSales = 0;
  let belowFirstTier = 0;
  let earnedTarget = 0;
  let ledgerInserted = 0;
  let ledgerUpdated = 0;
  let ledgerDeleted = 0;
  let ledgerUnchanged = 0;
  let totalSales = new Decimal(0);
  let totalTarget = new Decimal(0);

  try {
    for (const empId of eligibleEmpIds) {
      const plan = planByEmp.get(empId)!;
      const tiers = tiersForPlan(plan.planId, allTiers);
      if (tiers.length === 0) {
        throw new EmployeeDailyTargetDomainError(
          `الخطة المفعّلة للموظف ${plan.empName} لا تحتوي شرائح`,
        );
      }

      const daySales = new Decimal(daySalesByEmp.get(empId)?.netSalesAfterDiscount ?? 0);
      const mtdSales = new Decimal(mtdSalesByEmp.get(empId)?.netSalesAfterDiscount ?? 0);
      if (daySales.isNeg() || mtdSales.isNeg()) {
        throw new EmployeeTargetValidationError('صافي المبيعات لا يمكن أن يكون سالبًا');
      }

      const mtdCalculation = calculateDailyTarget(mtdSales.toString(), tiers);
      const mtdTargetAmount = Math.max(0, mtdCalculation.targetAmount);

      let priorMtdTargetAmount = 0;
      if (priorWorkDate) {
        const priorMtdSales = Decimal.max(0, mtdSales.minus(daySales));
        const priorCalc = calculateDailyTarget(priorMtdSales.toString(), tiers);
        priorMtdTargetAmount = Math.max(0, priorCalc.targetAmount);
      }

      const dayDelta = Math.max(0, moneyNumber(new Decimal(mtdTargetAmount).minus(priorMtdTargetAmount)));

      const breakdownJson = buildCalculationBreakdownJson({
        workDate,
        monthStart,
        targetPlanId: plan.planId,
        inputBasis: 'monthly',
        conversionDays: plan.conversionDays,
        tiers,
        mtdCalculation,
        daySales: daySales.toString(),
        mtdSales: mtdSales.toString(),
        mtdTargetAmount,
        dayDelta,
        priorWorkDate,
        priorMtdTargetAmount,
      });

      const upsert = await upsertDailyTargetInTransaction(transaction, {
        empId,
        branchId,
        workDate,
        targetPlanId: plan.planId,
        netSalesAfterDiscount: moneyNumber(daySales),
        targetAmount: dayDelta,
        calculationBreakdownJson: breakdownJson,
        calculationVersion: CALCULATION_VERSION,
        generatedByUserId,
      });

      const ledgerSync = await syncEmployeeDailyTargetLedgerEntry({
        dailyTarget: {
          id: upsert.id,
          empId,
          branchId,
          workDate,
          targetAmount: dayDelta,
        },
        actorUserId: generatedByUserId,
        transaction,
      });

      if (ledgerSync.action === 'inserted') ledgerInserted += 1;
      else if (ledgerSync.action === 'updated') ledgerUpdated += 1;
      else if (ledgerSync.action === 'deleted') ledgerDeleted += 1;
      else ledgerUnchanged += 1;

      // Display: earned if MTD progressive target > 0 (not merely today's delta).
      const displayStatus = deriveTargetDisplayStatus(
        moneyNumber(mtdSales),
        mtdTargetAmount,
      );
      if (upsert.persistenceStatus === 'generated') generated += 1;
      else recalculated += 1;
      if (displayStatus === 'no_sales') zeroSales += 1;
      else if (displayStatus === 'below_first_tier') belowFirstTier += 1;
      else earnedTarget += 1;

      totalSales = totalSales.plus(daySales);
      totalTarget = totalTarget.plus(dayDelta);

      const first = tiers[0]!;
      employees.push({
        empId,
        empName: plan.empName,
        dailyTargetId: upsert.id,
        targetPlanId: plan.planId,
        planEffectiveFrom: plan.effectiveFrom,
        planEffectiveTo: plan.effectiveTo,
        netSalesAfterDiscount: moneyStr(daySales),
        targetAmount: moneyStr(dayDelta),
        mtdSales: moneyStr(mtdSales),
        mtdTargetAmount: moneyStr(mtdTargetAmount),
        dayDelta: moneyStr(dayDelta),
        persistenceStatus: upsert.persistenceStatus,
        displayStatus,
        ledgerSyncAction: ledgerSync.action,
        ledgerEntryId: ledgerSync.ledgerEntryId,
        tierCount: tiers.length,
        firstDailyStartAmount: amountStr(first.dailyStartAmount),
        firstRatePercent: amountStr(first.ratePercent),
        breakdown: mtdCalculation.breakdown.map((b) => ({
          from: amountStr(b.from),
          to: b.to == null ? null : amountStr(b.to),
          eligibleAmount: amountStr(b.eligibleAmount),
          ratePercent: amountStr(b.ratePercent),
          targetAmount: amountStr(b.targetAmount),
        })),
        generatedAt: upsert.generatedAt,
        updatedAt: upsert.updatedAt,
      });
    }

    await transaction.commit();
  } catch (err) {
    try {
      await transaction.rollback();
    } catch {
      /* ignore */
    }
    throw err;
  }

  return {
    workDate,
    totals: {
      eligibleEmployees: eligibleEmpIds.length,
      generated,
      recalculated,
      zeroSales,
      belowFirstTier,
      earnedTarget,
      totalNetSalesAfterDiscount: moneyStr(totalSales),
      totalTargetAmount: moneyStr(totalTarget),
      ledgerInserted,
      ledgerUpdated,
      ledgerDeleted,
      ledgerUnchanged,
    },
    employees,
  };
}

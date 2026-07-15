import 'server-only';

import Decimal from 'decimal.js';
import { getPool, sql } from '@/lib/db';
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
import { getEmployeesNetServiceSalesByDate } from './employee-target-sales-service';
import { assertValidWorkDate, EmployeeTargetValidationError } from './target.validation';
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
  netSalesAfterDiscount: string;
  targetAmount: string;
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
      dailyStartAmount: t.dailyStartAmount,
      ratePercent: t.ratePercent,
    }));
}

export async function generateEmployeeDailyTargets(
  params: GenerateEmployeeDailyTargetsParams,
): Promise<GenerateEmployeeDailyTargetsResult> {
  const { workDate, generatedByUserId } = params;
  assertValidWorkDate(workDate);

  const empIds =
    params.empIds != null && params.empIds.length > 0
      ? [...new Set(params.empIds.filter((id) => Number.isInteger(id) && id > 0))]
      : null;

  if (params.empIds != null && empIds != null && empIds.length === 0) {
    throw new EmployeeTargetValidationError('empIds غير صالحة');
  }

  const plans = await listEnabledPlansCoveringDate(workDate, empIds);
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

  // Shared sales core — never duplicate employee-services SQL here.
  const salesRows = await getEmployeesNetServiceSalesByDate(workDate, eligibleEmpIds);
  const salesByEmp = new Map(salesRows.map((r) => [r.empId, r]));

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

      const salesRow = salesByEmp.get(empId);
      const netSales = new Decimal(salesRow?.netSalesAfterDiscount ?? 0);
      if (netSales.isNeg()) {
        throw new EmployeeTargetValidationError('صافي المبيعات لا يمكن أن يكون سالبًا');
      }

      const calculation = calculateDailyTarget(netSales.toString(), tiers);
      const targetAmount = Math.max(0, calculation.targetAmount);

      const breakdownJson = buildCalculationBreakdownJson({
        workDate,
        targetPlanId: plan.planId,
        inputBasis: plan.inputBasis,
        conversionDays: plan.conversionDays,
        tiers,
        calculation,
      });

      const upsert = await upsertDailyTargetInTransaction(transaction, {
        empId,
        workDate,
        targetPlanId: plan.planId,
        netSalesAfterDiscount: Number(moneyStr(calculation.netSalesAfterDiscount)),
        targetAmount,
        calculationBreakdownJson: breakdownJson,
        calculationVersion: CALCULATION_VERSION,
        generatedByUserId,
      });

      // Same TX as DailyTarget upsert — no CashMove, no DailyPayroll.
      const ledgerSync = await syncEmployeeDailyTargetLedgerEntry({
        dailyTarget: {
          id: upsert.id,
          empId,
          workDate,
          targetAmount,
        },
        actorUserId: generatedByUserId,
        transaction,
      });

      if (ledgerSync.action === 'inserted') ledgerInserted += 1;
      else if (ledgerSync.action === 'updated') ledgerUpdated += 1;
      else if (ledgerSync.action === 'deleted') ledgerDeleted += 1;
      else ledgerUnchanged += 1;

      const displayStatus = deriveTargetDisplayStatus(
        calculation.netSalesAfterDiscount,
        targetAmount,
      );
      if (upsert.persistenceStatus === 'generated') generated += 1;
      else recalculated += 1;
      if (displayStatus === 'no_sales') zeroSales += 1;
      else if (displayStatus === 'below_first_tier') belowFirstTier += 1;
      else earnedTarget += 1;

      totalSales = totalSales.plus(calculation.netSalesAfterDiscount);
      totalTarget = totalTarget.plus(targetAmount);

      const first = tiers[0]!;
      employees.push({
        empId,
        empName: plan.empName,
        dailyTargetId: upsert.id,
        targetPlanId: plan.planId,
        planEffectiveFrom: plan.effectiveFrom,
        planEffectiveTo: plan.effectiveTo,
        netSalesAfterDiscount: moneyStr(calculation.netSalesAfterDiscount),
        targetAmount: moneyStr(targetAmount),
        persistenceStatus: upsert.persistenceStatus,
        displayStatus,
        ledgerSyncAction: ledgerSync.action,
        ledgerEntryId: ledgerSync.ledgerEntryId,
        tierCount: tiers.length,
        firstDailyStartAmount: amountStr(first.dailyStartAmount),
        firstRatePercent: amountStr(first.ratePercent),
        breakdown: calculation.breakdown.map((b) => ({
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

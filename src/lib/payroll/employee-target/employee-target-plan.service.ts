import 'server-only';

import { getPool, sql } from '@/lib/db';
import { getCairoBusinessDate } from '@/lib/businessDate';
import { calculateDailyTarget } from './calculate-daily-target';
import { convertInputTiersToDaily } from './convert-target-tiers';
import {
  EmployeeTargetValidationError,
  assertValidInputBasis,
  assertValidConversionDays,
} from './target.validation';
import type { TargetInputBasis } from './target.types';
import type { TargetPreviewBody, TargetSaveBody } from './employee-target-plan.schemas';
import {
  closePlanEffectiveTo,
  countDailyTargetsForPlan,
  deletePlanInTransaction,
  getEmployeeBasic,
  getPlanWithTiers,
  insertPlanWithTiers,
  listPlansForEmployee,
  listTiersForPlans,
  replacePlanTiersInTransaction,
  type TargetPlanWithTiers,
  type TargetTierRow,
} from './employee-target-plan.repository';
import { addDaysIso, computeTargetPlanVersioning } from './target-plan-versioning';

export class EmployeeTargetConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EmployeeTargetConflictError';
  }
}

function serializeTier(tier: TargetTierRow, conversionDays: number) {
  const monthlyEquivalent = Number(
    (tier.dailyStartAmount * conversionDays).toFixed(6),
  );
  return {
    id: tier.id,
    sortOrder: tier.sortOrder,
    inputStartAmount: tier.inputStartAmount,
    dailyStartAmount: tier.dailyStartAmount,
    monthlyEquivalent,
    ratePercent: tier.ratePercent,
  };
}

function serializePlan(plan: TargetPlanWithTiers) {
  return {
    id: plan.id,
    empId: plan.empId,
    isEnabled: plan.isEnabled,
    inputBasis: plan.inputBasis,
    conversionDays: plan.conversionDays,
    effectiveFrom: plan.effectiveFrom,
    effectiveTo: plan.effectiveTo,
    notes: plan.notes,
    createdByUserId: plan.createdByUserId,
    updatedByUserId: plan.updatedByUserId,
    createdAt: plan.createdAt,
    updatedAt: plan.updatedAt,
    tiers: plan.tiers.map((t) => serializeTier(t, plan.conversionDays)),
    tierCount: plan.tiers.length,
  };
}

function attachTiers(
  plans: Awaited<ReturnType<typeof listPlansForEmployee>>,
  tiers: TargetTierRow[],
): TargetPlanWithTiers[] {
  const byPlan = new Map<number, TargetTierRow[]>();
  for (const tier of tiers) {
    const list = byPlan.get(tier.targetPlanId) ?? [];
    list.push(tier);
    byPlan.set(tier.targetPlanId, list);
  }
  return plans.map((p) => ({
    ...p,
    tiers: byPlan.get(p.id) ?? [],
  }));
}

function findEffectivePlan(
  plans: TargetPlanWithTiers[],
  effectiveDate: string,
): TargetPlanWithTiers | null {
  const matching = plans.filter(
    (p) =>
      p.effectiveFrom <= effectiveDate &&
      (p.effectiveTo == null || p.effectiveTo >= effectiveDate),
  );
  if (matching.length === 0) return null;
  matching.sort((a, b) => {
    if (a.effectiveFrom !== b.effectiveFrom) {
      return a.effectiveFrom < b.effectiveFrom ? 1 : -1;
    }
    return b.id - a.id;
  });
  return matching[0] ?? null;
}

export async function getEmployeeTargetSettings(
  empId: number,
  effectiveDate?: string | null,
) {
  const employee = await getEmployeeBasic(empId);
  if (!employee) {
    const err = new Error('الموظف غير موجود');
    (err as Error & { status?: number }).status = 404;
    throw err;
  }

  const asOf = effectiveDate && /^\d{4}-\d{2}-\d{2}$/.test(effectiveDate)
    ? effectiveDate
    : getCairoBusinessDate();

  const plans = await listPlansForEmployee(empId);
  const tiers = await listTiersForPlans(plans.map((p) => p.id));
  const withTiers = attachTiers(plans, tiers);

  const effectivePlan = findEffectivePlan(withTiers, asOf);
  const latestPlan =
    withTiers.length === 0
      ? null
      : [...withTiers].sort((a, b) => {
          if (a.effectiveFrom !== b.effectiveFrom) {
            return a.effectiveFrom < b.effectiveFrom ? 1 : -1;
          }
          return b.id - a.id;
        })[0];

  const history = withTiers
    .map((p) => ({
      id: p.id,
      isEnabled: p.isEnabled,
      inputBasis: p.inputBasis,
      conversionDays: p.conversionDays,
      effectiveFrom: p.effectiveFrom,
      effectiveTo: p.effectiveTo,
      notes: p.notes,
      tierCount: p.tiers.length,
      tiers: p.tiers.map((t) => serializeTier(t, p.conversionDays)),
    }))
    .sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? 1 : -1));

  return {
    employee: {
      empId: employee.EmpID,
      empName: employee.EmpName,
      isActive: employee.isActive,
    },
    asOfDate: asOf,
    effectivePlan: effectivePlan ? serializePlan(effectivePlan) : null,
    latestPlan: latestPlan ? serializePlan(latestPlan) : null,
    history,
  };
}

export function previewEmployeeTargetPlan(body: TargetPreviewBody) {
  const converted = convertInputTiersToDaily({
    inputBasis: body.inputBasis,
    conversionDays: body.conversionDays,
    tiers: body.tiers,
    requireAtLeastOne: true,
  });

  const preview = calculateDailyTarget(
    body.sampleDailySales,
    converted.map((t) => ({
      sortOrder: t.sortOrder,
      inputStartAmount: t.inputStartAmount,
      dailyStartAmount: t.dailyStartAmount,
      ratePercent: t.ratePercent,
    })),
  );

  return { convertedTiers: converted, preview };
}

/**
 * Save plan settings:
 * - New EffectiveFrom → insert version + close prior (history preserved).
 * - Same EffectiveFrom → replace that version in place (same-day edit / enable toggle).
 */
export async function saveEmployeeTargetPlan(
  empId: number,
  body: TargetSaveBody,
  userId: number | null,
) {
  const employee = await getEmployeeBasic(empId);
  if (!employee) {
    const err = new Error('الموظف غير موجود');
    (err as Error & { status?: number }).status = 404;
    throw err;
  }

  const isEnabled = body.isEnabled;
  const inputBasis: TargetInputBasis = body.inputBasis ?? 'monthly';
  const conversionDays = body.conversionDays ?? 26;
  const effectiveFrom = body.effectiveFrom;
  const notes = body.notes === undefined ? null : body.notes;
  const tiersInput = body.tiers ?? [];

  try {
    assertValidInputBasis(inputBasis);
    assertValidConversionDays(conversionDays);
  } catch (e) {
    if (e instanceof EmployeeTargetValidationError) {
      if (e.message.includes('ConversionDays')) {
        throw new EmployeeTargetValidationError('عدد أيام التحويل من 1 إلى 31');
      }
      if (e.message.includes('InputBasis')) {
        throw new EmployeeTargetValidationError('طريقة الإدخال يجب أن تكون شهري أو يومي');
      }
    }
    throw e;
  }

  if (isEnabled && tiersInput.length === 0) {
    throw new EmployeeTargetValidationError('التارجت المفعّل يحتاج شريحة واحدة على الأقل');
  }

  const converted = convertInputTiersToDaily({
    inputBasis,
    conversionDays,
    tiers: tiersInput,
    requireAtLeastOne: isEnabled,
  });

  const existing = await listPlansForEmployee(empId);
  const monthKey = effectiveFrom.slice(0, 7);

  // أي خطة في نفس الشهر تُدمَج في خطة واحدة من أول الشهر (بدون تاريخ بداية يدوي)
  const sameMonth = existing
    .filter((p) => p.effectiveFrom.slice(0, 7) === monthKey)
    .sort((a, b) => {
      if (a.effectiveFrom === effectiveFrom && b.effectiveFrom !== effectiveFrom) return -1;
      if (b.effectiveFrom === effectiveFrom && a.effectiveFrom !== effectiveFrom) return 1;
      return a.effectiveFrom.localeCompare(b.effectiveFrom) || a.id - b.id;
    });

  const tierRows = converted.map((t) => ({
    inputStartAmount: t.inputStartAmount,
    dailyStartAmount: t.dailyStartAmount,
    ratePercent: t.ratePercent,
    sortOrder: t.sortOrder,
  }));

  const db = await getPool();
  const transaction = new sql.Transaction(db);
  await transaction.begin();

  try {
    let planId: number;

    if (sameMonth.length > 0) {
      const keep = sameMonth[0]!;
      for (const extra of sameMonth.slice(1)) {
        const refs = await countDailyTargetsForPlan(extra.id);
        if (refs > 0) {
          throw new EmployeeTargetConflictError(
            'لا يمكن توحيد خطط الشهر لوجود يوميات مربوطة بخطة أخرى في نفس الشهر',
          );
        }
        await deletePlanInTransaction(transaction, {
          planId: extra.id,
          priorPlanId: null,
          priorNewEffectiveTo: null,
          updatedByUserId: userId,
        });
      }

      const prior = existing
        .filter((p) => p.effectiveFrom < effectiveFrom && !sameMonth.some((s) => s.id === p.id))
        .sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom) || b.id - a.id)[0];
      if (prior) {
        await closePlanEffectiveTo(transaction, prior.id, addDaysIso(effectiveFrom, -1), userId);
      }

      planId = keep.id;
      await replacePlanTiersInTransaction(transaction, {
        planId,
        isEnabled,
        inputBasis,
        conversionDays,
        effectiveFrom,
        effectiveTo: null,
        notes,
        updatedByUserId: userId,
        tiers: tierRows,
      });
    } else {
      let versioning;
      try {
        versioning = computeTargetPlanVersioning(existing, effectiveFrom);
      } catch (e: unknown) {
        throw new EmployeeTargetConflictError(
          e instanceof Error ? e.message : 'حدث تعارض مع خطة مستقبلية',
        );
      }

      if (versioning.mode === 'replace' && versioning.replacePlanId != null) {
        planId = versioning.replacePlanId;
        await replacePlanTiersInTransaction(transaction, {
          planId,
          isEnabled,
          inputBasis,
          conversionDays,
          effectiveFrom,
          effectiveTo: versioning.newEffectiveTo,
          notes,
          updatedByUserId: userId,
          tiers: tierRows,
        });
      } else {
        if (versioning.priorPlanId != null && versioning.priorCloseTo != null) {
          await closePlanEffectiveTo(
            transaction,
            versioning.priorPlanId,
            versioning.priorCloseTo,
            userId,
          );
        }

        planId = await insertPlanWithTiers(transaction, {
          empId,
          isEnabled,
          inputBasis,
          conversionDays,
          effectiveFrom,
          effectiveTo: versioning.newEffectiveTo,
          notes,
          createdByUserId: userId,
          tiers: tierRows,
        });
      }
    }

    await transaction.commit();

    const saved = await getPlanWithTiers(planId);
    if (!saved) {
      throw new Error('فشل تحميل الخطة بعد الحفظ');
    }
    return serializePlan(saved);
  } catch (err) {
    try {
      await transaction.rollback();
    } catch {
      // ignore rollback errors if already aborted
    }
    throw err;
  }
}

/**
 * Delete a plan version from history.
 * Rejects if daily target rows still reference it.
 * Re-opens the prior plan window to fill the gap (EffectiveTo → deleted plan's EffectiveTo).
 */
export async function deleteEmployeeTargetPlan(
  empId: number,
  planId: number,
  userId: number | null,
): Promise<{ deletedPlanId: number }> {
  const employee = await getEmployeeBasic(empId);
  if (!employee) {
    const err = new Error('الموظف غير موجود');
    (err as Error & { status?: number }).status = 404;
    throw err;
  }

  const plan = await getPlanWithTiers(planId);
  if (!plan || plan.empId !== empId) {
    const err = new Error('الخطة غير موجودة');
    (err as Error & { status?: number }).status = 404;
    throw err;
  }

  const usedCount = await countDailyTargetsForPlan(planId);
  if (usedCount > 0) {
    throw new EmployeeTargetConflictError(
      `لا يمكن مسح الخطة لأنها مستخدمة في ${usedCount} يوم تارجت مولَّد — أعد حساب التارجت أو راجع الأيام أولاً`,
    );
  }

  const allPlans = await listPlansForEmployee(empId);
  const prior = [...allPlans]
    .filter((p) => p.effectiveFrom < plan.effectiveFrom)
    .sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? 1 : -1))[0];

  const db = await getPool();
  const transaction = new sql.Transaction(db);
  await transaction.begin();

  try {
    await deletePlanInTransaction(transaction, {
      planId,
      priorPlanId: prior?.id ?? null,
      // Restore continuity: prior ends where the deleted plan ended (or stays open).
      priorNewEffectiveTo: prior ? plan.effectiveTo : null,
      updatedByUserId: userId,
    });
    await transaction.commit();
    return { deletedPlanId: planId };
  } catch (err) {
    try {
      await transaction.rollback();
    } catch {
      /* ignore */
    }
    throw err;
  }
}

export { serializePlan };

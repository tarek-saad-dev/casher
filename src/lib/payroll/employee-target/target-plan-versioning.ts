/**
 * Pure versioning math for employee target plans (no DB I/O).
 *
 * Same EffectiveFrom → replace that version in place (same-day edits / toggle).
 * Different EffectiveFrom → insert a new version and close the prior window.
 */

export interface PlanDateWindow {
  id: number;
  effectiveFrom: string;
  effectiveTo: string | null;
}

export interface VersioningDecision {
  mode: 'insert' | 'replace';
  replacePlanId: number | null;
  priorPlanId: number | null;
  priorCloseTo: string | null;
  newEffectiveTo: string | null;
}

export function addDaysIso(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T12:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function computeTargetPlanVersioning(
  existing: PlanDateWindow[],
  effectiveFrom: string,
): VersioningDecision {
  const sameDay = existing
    .filter((p) => p.effectiveFrom === effectiveFrom)
    .sort((a, b) => b.id - a.id);

  if (sameDay.length > 1) {
    throw new Error(
      'توجد خطط متعددة بنفس تاريخ السريان — صحّح السجل يدويًا قبل الحفظ',
    );
  }

  if (sameDay.length === 1) {
    // Supersede today's (or chosen date's) version instead of 409.
    return {
      mode: 'replace',
      replacePlanId: sameDay[0]!.id,
      priorPlanId: null,
      priorCloseTo: null,
      newEffectiveTo: sameDay[0]!.effectiveTo,
    };
  }

  const prior = [...existing]
    .filter((p) => p.effectiveFrom < effectiveFrom)
    .sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? 1 : -1))[0];

  const next = [...existing]
    .filter((p) => p.effectiveFrom > effectiveFrom)
    .sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? -1 : 1))[0];

  const priorCloseTo = addDaysIso(effectiveFrom, -1);
  let newEffectiveTo: string | null = null;

  if (next) {
    newEffectiveTo = addDaysIso(next.effectiveFrom, -1);
    if (newEffectiveTo < effectiveFrom) {
      throw new Error('حدث تعارض مع خطة مستقبلية');
    }
  }

  const shouldClosePrior =
    !!prior && (prior.effectiveTo == null || prior.effectiveTo >= effectiveFrom);

  if (shouldClosePrior && prior && priorCloseTo < prior.effectiveFrom) {
    throw new Error('حدث تعارض مع خطة مستقبلية');
  }

  for (const p of existing) {
    if (prior && p.id === prior.id) continue;
    if (next && p.id === next.id) continue;
    const pEnds = p.effectiveTo ?? '9999-12-31';
    const newEnds = newEffectiveTo ?? '9999-12-31';
    const overlaps = p.effectiveFrom <= newEnds && pEnds >= effectiveFrom;
    if (overlaps) {
      throw new Error('حدث تعارض مع خطة مستقبلية');
    }
  }

  return {
    mode: 'insert',
    replacePlanId: null,
    priorPlanId: shouldClosePrior && prior ? prior.id : null,
    priorCloseTo: shouldClosePrior && prior ? priorCloseTo : null,
    newEffectiveTo,
  };
}

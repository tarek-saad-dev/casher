import { describe, it, expect } from 'vitest';
import {
  computeTargetPlanVersioning,
  addDaysIso,
} from '@/lib/payroll/employee-target/target-plan-versioning';

describe('computeTargetPlanVersioning', () => {
  it('create first plan → open-ended EffectiveTo, no prior close', () => {
    const d = computeTargetPlanVersioning([], '2026-07-01');
    expect(d.mode).toBe('insert');
    expect(d.priorPlanId).toBeNull();
    expect(d.priorCloseTo).toBeNull();
    expect(d.newEffectiveTo).toBeNull();
  });

  it('close prior plan at EffectiveFrom - 1 day', () => {
    const d = computeTargetPlanVersioning(
      [{ id: 10, effectiveFrom: '2026-01-01', effectiveTo: null }],
      '2026-07-01',
    );
    expect(d.mode).toBe('insert');
    expect(d.priorPlanId).toBe(10);
    expect(d.priorCloseTo).toBe('2026-06-30');
    expect(d.newEffectiveTo).toBeNull();
  });

  it('plan before future plan sets new EffectiveTo to day before future', () => {
    const d = computeTargetPlanVersioning(
      [
        { id: 1, effectiveFrom: '2026-01-01', effectiveTo: '2026-12-31' },
        { id: 2, effectiveFrom: '2027-01-01', effectiveTo: null },
      ],
      '2026-07-01',
    );
    // prior id=1 already ends 2026-12-31 which is >= 2026-07-01 → close to 2026-06-30
    expect(d.mode).toBe('insert');
    expect(d.priorPlanId).toBe(1);
    expect(d.priorCloseTo).toBe('2026-06-30');
    expect(d.newEffectiveTo).toBe('2026-12-31');
    expect(addDaysIso('2027-01-01', -1)).toBe('2026-12-31');
  });

  it('same effective date → replace that version (same-day edit)', () => {
    const d = computeTargetPlanVersioning(
      [{ id: 1, effectiveFrom: '2026-07-01', effectiveTo: null }],
      '2026-07-01',
    );
    expect(d.mode).toBe('replace');
    expect(d.replacePlanId).toBe(1);
    expect(d.priorPlanId).toBeNull();
  });

  it('does not close prior that already ended before new EffectiveFrom', () => {
    const d = computeTargetPlanVersioning(
      [{ id: 1, effectiveFrom: '2026-01-01', effectiveTo: '2026-03-31' }],
      '2026-07-01',
    );
    expect(d.priorPlanId).toBeNull();
    expect(d.priorCloseTo).toBeNull();
  });
});

import { describe, expect, it } from 'vitest';
import {
  normalizeExecutionSteps,
  toPublicExecutionStepWire,
  validateExecutionStepsBody,
} from '@/lib/catalog/serviceExecutionSteps';
import type { ExecutionStepRow } from '@/lib/catalog/serviceExecutionSteps.types';

describe('serviceExecutionSteps', () => {
  it('normalizeExecutionSteps assigns SortOrder and drops empty rows', () => {
    const steps = normalizeExecutionSteps([
      { TitleAr: 'غسيل', DetailAr: 'شطف' },
      { TitleAr: '  ', TitleEn: '', DetailAr: '', DetailEn: '' },
      { TitleEn: 'Cut', SortOrder: 99 },
    ]);
    expect(steps).toHaveLength(2);
    expect(steps[0].TitleAr).toBe('غسيل');
    expect(steps[0].SortOrder).toBe(10);
    expect(steps[1].TitleEn).toBe('Cut');
    expect(steps[1].SortOrder).toBe(99);
  });

  it('validateExecutionStepsBody rejects non-array steps', () => {
    const result = validateExecutionStepsBody({ steps: 'nope' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/مصفوفة/);
  });

  it('validateExecutionStepsBody accepts valid payload', () => {
    const result = validateExecutionStepsBody({
      steps: [{ TitleAr: 'مرحلة 1', DurationMinutes: 5 }],
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.steps).toHaveLength(1);
      expect(result.steps[0].DurationMinutes).toBe(5);
    }
  });

  it('toPublicExecutionStepWire maps camelCase fields and 1-based order', () => {
    const rows: ExecutionStepRow[] = [
      {
        StepID: 10,
        ProID: 11,
        SortOrder: 10,
        TitleAr: 'غسيل',
        TitleEn: null,
        DetailAr: null,
        DetailEn: null,
        DurationMinutes: 3,
        CreatedAt: null,
        UpdatedAt: null,
      },
      {
        StepID: 11,
        ProID: 11,
        SortOrder: 20,
        TitleAr: 'ماسك',
        TitleEn: 'Mask',
        DetailAr: null,
        DetailEn: null,
        DurationMinutes: 10,
        CreatedAt: null,
        UpdatedAt: null,
      },
    ];
    expect(toPublicExecutionStepWire(rows)).toEqual([
      {
        stepId: 10,
        sortOrder: 10,
        order: 1,
        titleAr: 'غسيل',
        titleEn: null,
        detailAr: null,
        detailEn: null,
        durationMinutes: 3,
      },
      {
        stepId: 11,
        sortOrder: 20,
        order: 2,
        titleAr: 'ماسك',
        titleEn: 'Mask',
        detailAr: null,
        detailEn: null,
        durationMinutes: 10,
      },
    ]);
  });
});

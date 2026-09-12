import { describe, expect, it } from 'vitest';
import {
  normalizeExecutionSteps,
  validateExecutionStepsBody,
} from '@/lib/catalog/serviceExecutionSteps';

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
});

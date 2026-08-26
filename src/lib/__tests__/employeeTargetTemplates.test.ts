import { describe, expect, it } from 'vitest';
import {
  createEmptyTemplatesFile,
  parseEmployeeTargetTemplatesFile,
  validateTemplateDraft,
} from '@/lib/payroll/employee-target/employee-target-templates';

describe('employee-target-templates', () => {
  it('parses empty / corrupt as empty file', () => {
    expect(parseEmployeeTargetTemplatesFile(null)).toEqual(createEmptyTemplatesFile());
    expect(parseEmployeeTargetTemplatesFile({ version: 1, templates: [{ id: 'x' }] }).templates).toEqual([]);
  });

  it('keeps valid templates', () => {
    const file = parseEmployeeTargetTemplatesFile({
      version: 1,
      templates: [
        {
          id: 'tt-1',
          name: 'حلاق أساسي',
          isEnabled: true,
          conversionDays: 26,
          tiers: [
            { inputStartAmount: 10000, ratePercent: 10 },
            { inputStartAmount: 30000, ratePercent: 20 },
          ],
          createdAt: '2026-08-01T00:00:00.000Z',
          updatedAt: '2026-08-01T00:00:00.000Z',
        },
      ],
    });
    expect(file.templates).toHaveLength(1);
    expect(file.templates[0]?.name).toBe('حلاق أساسي');
    expect(file.templates[0]?.tiers).toHaveLength(2);
  });

  it('validates draft name and ascending tiers', () => {
    expect(() => validateTemplateDraft({ name: '  ', isEnabled: true, tiers: [] })).toThrow(
      /اسم القالب/,
    );
    expect(() =>
      validateTemplateDraft({
        name: 'A',
        isEnabled: true,
        tiers: [
          { inputStartAmount: 20000, ratePercent: 10 },
          { inputStartAmount: 10000, ratePercent: 20 },
        ],
      }),
    ).toThrow(/تصاعدي/);

    const ok = validateTemplateDraft({
      name: ' أساسي ',
      isEnabled: true,
      tiers: [{ inputStartAmount: '10000', ratePercent: '10' }],
    });
    expect(ok.name).toBe('أساسي');
    expect(ok.tiers[0]?.inputStartAmount).toBe(10000);
  });
});

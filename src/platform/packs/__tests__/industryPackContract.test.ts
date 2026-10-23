import { describe, expect, it } from 'vitest';
import { INDUSTRY_PACKS, listPublicIndustryPacks } from '@/packs';
import { validatePackDefinition } from '@/platform/apps/compositionResolver';

describe('industry pack architecture contract', () => {
  it('all registered packs satisfy one shared contract', () => {
    for (const pack of INDUSTRY_PACKS) {
      expect(validatePackDefinition(pack), pack.packCode).toEqual({ ok: true });
    }
  });

  it('has unique pack codes and versions are positive', () => {
    const codes = INDUSTRY_PACKS.map((p) => p.packCode);
    expect(new Set(codes).size).toBe(codes.length);
    expect(INDUSTRY_PACKS.every((p) => p.version > 0)).toBe(true);
  });

  it('derives public signup industries from the same registry', () => {
    const expected = INDUSTRY_PACKS.filter((p) => p.publicSignup.enabled).map((p) => p.packCode).sort();
    expect(listPublicIndustryPacks().map((p) => p.code).sort()).toEqual(expected);
  });

  it('keeps commercial limits out of pack manifests', () => {
    for (const pack of INDUSTRY_PACKS) {
      expect(JSON.stringify(pack)).not.toMatch(/maxBranches|maxUsers|monthlyPrice|annualPrice|trialDays/);
    }
  });
});

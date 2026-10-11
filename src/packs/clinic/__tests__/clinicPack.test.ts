import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
import { CLINIC_PACK } from '@/packs/clinic/public';
import { INDUSTRY_PACKS, listPublicIndustryPacks } from '@/packs';
import { validatePackDefinition } from '@/platform/apps/compositionResolver';
import {
  isBookableJobForPack,
} from '@/platform/packs/runtimePolicy';

describe('clinic industry pack', () => {
  it('is a valid recipe over the shared app catalog', () => {
    expect(validatePackDefinition(CLINIC_PACK)).toEqual({ ok: true });
    expect(CLINIC_PACK.required).toEqual(['booking']);
    expect(CLINIC_PACK.recommended).toEqual(
      expect.arrayContaining(['queue', 'pos', 'attendance', 'payroll', 'treasury', 'reports']),
    );
    expect(CLINIC_PACK.optional).toEqual(
      expect.arrayContaining(['inventory', 'purchasing', 'messaging', 'ai-receptionist']),
    );
  });

  it('uses shared service/workforce concepts with clinic terminology', () => {
    expect(CLINIC_PACK.onboarding.catalogKind).toBe('services');
    expect(CLINIC_PACK.onboarding.terminology.customer).toBe('مريض');
    expect(CLINIC_PACK.onboarding.terminology.provider).toBe('طبيب');
    expect(CLINIC_PACK.onboarding.jobOptions).toContain('طبيب');
    expect(isBookableJobForPack(CLINIC_PACK, 'طبيب')).toBe(true);
    expect(isBookableJobForPack(CLINIC_PACK, 'ممرض')).toBe(false);
  });

  it('is exposed through the same registry used by operator and public onboarding', () => {
    expect(INDUSTRY_PACKS.map((p) => p.packCode)).toEqual(
      expect.arrayContaining(['salon', 'clinic', 'supermarket']),
    );
    const publicClinic = listPublicIndustryPacks().find((p) => p.code === 'clinic');
    expect(publicClinic).toMatchObject({
      supportsDemo: true,
      catalogKind: 'services',
      titleAr: 'عيادة / Clinic',
    });
  });

  it('keeps clinical records outside shared customer/booking tables', () => {
    expect(CLINIC_PACK.configDefaults).toMatchObject({
      futureExtensions: ['clinical-records'],
    });
  });
});

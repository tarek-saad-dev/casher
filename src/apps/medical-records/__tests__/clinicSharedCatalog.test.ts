import { describe, expect, it } from 'vitest';
import {
  clinicPriceUpdate, isSuggestedClinicService, selectSharedServices, type ClinicSharedService,
} from '../application/clinicSharedCatalog';

const service = (patch: Partial<ClinicSharedService> = {}): ClinicSharedService => ({
  ProID: 102, ProName: 'Consultation', ProNameAr: 'كشف', SPrice1: 400,
  Bonus: 12, ImageUrl: '/images/clinic-consult.png', CatID: 4, CatName: 'خدمات العيادة', CatType: 'serv',
  DurationMinutes: 30, isDeleted: 0, ...patch,
});

describe('clinic setup backed by shared service catalog', () => {
  it('recognizes consultation and follow-up by name/category, not by a second DB flag', () => {
    expect(isSuggestedClinicService(service())).toBe(true);
    expect(isSuggestedClinicService(service({ ProName: 'Follow-up', ProNameAr: null, CatName: 'General' }))).toBe(true);
    expect(isSuggestedClinicService(service({ ProName: 'Haircut', ProNameAr: null, CatName: 'Salon' }))).toBe(false);
  });

  it('filters suggestions and supports searching all tenant services', () => {
    const items = [
      service(),
      service({ ProID: 103, ProName: 'Haircut', ProNameAr: 'قص الشعر', CatName: 'Salon' }),
      service({ ProID: 104, ProName: 'Retail', ProNameAr: 'علاج', CatType: 'pro' }),
      service({ ProID: 105, ProName: 'Old visit', isDeleted: 1 }),
    ];
    expect(selectSharedServices(items, { suggestedOnly: true }).map(x => x.ProID)).toEqual([102]);
    expect(selectSharedServices(items, { search: 'Haircut' }).map(x => x.ProID)).toEqual([103]);
    expect(selectSharedServices(items, { search: '103' }).map(x => x.ProID)).toEqual([103]);
    expect(selectSharedServices(items).map(x => x.ProID)).toEqual([102, 103]);
  });

  it.each(['', ' ', 'abc', '-10', '0', '00.00', '10.333', '1e2', 'Infinity', '10000001'])(
    'rejects invalid price %j before touching Shared Services', raw => {
      expect(clinicPriceUpdate(service(), raw).ok).toBe(false);
    },
  );

  it('preserves category, existing names, bonus and activation on price-only edits', () => {
    expect(clinicPriceUpdate(service(), '450.50')).toEqual({
      ok: true,
      value: {
        ProName: 'Consultation', ProNameAr: 'كشف',
        SPrice1: 450.5, Bonus: 12, ImageUrl: '/images/clinic-consult.png', CatID: 4, isActive: true,
      },
    });
  });
});

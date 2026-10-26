export type ClinicSharedService = {
  ProID: number;
  ProName: string;
  ProNameAr?: string | null;
  SPrice1: number | null;
  Bonus?: number | null;
  ImageUrl?: string | null;
  CatID: number | null;
  CatName: string | null;
  CatType?: string | null;
  ProType?: string | null;
  isDeleted?: number | boolean | null;
  DurationMinutes: number | null;
};

const CLINIC_HINTS = [
  'consult', 'follow', 'كشف', 'متابع', 'زيارة', 'عياد',
  'clinic', 'checkup', 'check-up', 'طبي',
] as const;

export function isSuggestedClinicService(
  row: Pick<ClinicSharedService, 'ProName' | 'ProNameAr' | 'CatName'>,
): boolean {
  const haystack = [row.ProName, row.ProNameAr, row.CatName].filter(Boolean).join(' ').toLocaleLowerCase();
  return CLINIC_HINTS.some(hint => haystack.includes(hint));
}

export function selectSharedServices(
  rows: ClinicSharedService[],
  options: { search?: string; suggestedOnly?: boolean } = {},
): ClinicSharedService[] {
  const q = options.search?.trim().toLocaleLowerCase() || '';
  return rows.filter(row => {
    if (row.isDeleted === true || Number(row.isDeleted) === 1) return false;
    if (String(row.CatType || '').toLowerCase() === 'pro' || String(row.ProType || '').toLowerCase() === 'pro') return false;
    if (options.suggestedOnly && !isSuggestedClinicService(row)) return false;
    if (!q) return true;
    return [row.ProName, row.ProNameAr, row.CatName, String(row.ProID)]
      .some(value => String(value || '').toLocaleLowerCase().includes(q));
  });
}

/** Preserve every existing shared-catalog field when saving a clinic price edit. */
export function clinicPriceUpdate(
  service: ClinicSharedService,
  rawPrice: string,
):
  | { ok: true; value: Record<string, string | number | boolean | null> }
  | { ok: false; error: string } {
  const normalized = rawPrice.trim();
  if (!normalized || !/^(?:[0-9]+)(?:\.[0-9]{1,2})?$/.test(normalized)) {
    return { ok: false, error: 'اكتب سعرًا صحيحًا (بحد أقصى رقمين بعد العلامة العشرية).' };
  }
  const price = Number(normalized);
  if (!Number.isFinite(price) || price <= 0 || price > 10000000) {
    return { ok: false, error: 'سعر الخدمة لازم يكون أكبر من صفر وفي الحدود المسموحة.' };
  }
  return {
    ok: true,
    value: {
      ProName: service.ProName,
      ProNameAr: service.ProNameAr ?? null,
      SPrice1: price,
      Bonus: service.Bonus ?? 0,
      ImageUrl: service.ImageUrl ?? null,
      CatID: service.CatID ?? null,
      isActive: true,
    },
  };
}

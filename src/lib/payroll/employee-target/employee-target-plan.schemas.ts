import type { TargetInputBasis } from './target.types';
import type { ConvertibleTierInput } from './convert-target-tiers';

export interface TargetPreviewBody {
  inputBasis: TargetInputBasis;
  conversionDays: number;
  tiers: ConvertibleTierInput[];
  sampleDailySales: number | string;
}

export interface TargetSaveBody {
  isEnabled: boolean;
  inputBasis?: TargetInputBasis;
  conversionDays?: number;
  effectiveFrom: string;
  notes?: string | null;
  tiers?: ConvertibleTierInput[];
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function parseTier(raw: unknown, index: number): ConvertibleTierInput {
  if (!raw || typeof raw !== 'object') {
    throw new Error(`بيانات الشريحة #${index + 1} غير صالحة`);
  }
  const t = raw as Record<string, unknown>;
  if (t.inputStartAmount === undefined || t.inputStartAmount === null || t.inputStartAmount === '') {
    throw new Error(`بداية الشريحة #${index + 1} مطلوبة`);
  }
  if (t.ratePercent === undefined || t.ratePercent === null || t.ratePercent === '') {
    throw new Error(`نسبة الشريحة #${index + 1} مطلوبة`);
  }
  return {
    inputStartAmount: t.inputStartAmount as number | string,
    ratePercent: t.ratePercent as number | string,
    sortOrder: typeof t.sortOrder === 'number' ? t.sortOrder : undefined,
  };
}

function parseTiers(raw: unknown): ConvertibleTierInput[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) throw new Error('صيغة الشرائح غير صحيحة');
  return raw.map((t, i) => parseTier(t, i));
}

export function parseTargetPreviewBody(body: unknown): TargetPreviewBody {
  if (!body || typeof body !== 'object') throw new Error('بيانات غير صالحة');
  const b = body as Record<string, unknown>;

  const inputBasis = b.inputBasis;
  if (inputBasis !== 'monthly' && inputBasis !== 'daily') {
    throw new Error('طريقة الإدخال يجب أن تكون شهري أو يومي');
  }

  const conversionDays =
    b.conversionDays === undefined || b.conversionDays === null
      ? 26
      : Number(b.conversionDays);
  if (!Number.isInteger(conversionDays) || conversionDays < 1 || conversionDays > 31) {
    throw new Error('عدد أيام التحويل من 1 إلى 31');
  }

  if (b.sampleDailySales === undefined || b.sampleDailySales === null || b.sampleDailySales === '') {
    throw new Error('مبيعات المعاينة غير صالحة');
  }

  return {
    inputBasis,
    conversionDays,
    tiers: parseTiers(b.tiers),
    sampleDailySales: b.sampleDailySales as number | string,
  };
}

export function parseTargetSaveBody(body: unknown): TargetSaveBody {
  if (!body || typeof body !== 'object') throw new Error('بيانات غير صالحة');
  const b = body as Record<string, unknown>;

  if (typeof b.isEnabled !== 'boolean') {
    throw new Error('حقل تفعيل التارجت مطلوب');
  }

  if (typeof b.effectiveFrom !== 'string' || !DATE_RE.test(b.effectiveFrom)) {
    throw new Error('تاريخ السريان غير صالح');
  }

  let inputBasis: TargetInputBasis | undefined;
  if (b.inputBasis !== undefined && b.inputBasis !== null) {
    if (b.inputBasis !== 'monthly' && b.inputBasis !== 'daily') {
      throw new Error('طريقة الإدخال يجب أن تكون شهري أو يومي');
    }
    inputBasis = b.inputBasis;
  }

  let conversionDays: number | undefined;
  if (b.conversionDays !== undefined && b.conversionDays !== null) {
    conversionDays = Number(b.conversionDays);
    if (!Number.isInteger(conversionDays) || conversionDays < 1 || conversionDays > 31) {
      throw new Error('عدد أيام التحويل من 1 إلى 31');
    }
  }

  let notes: string | null | undefined = undefined;
  if (b.notes !== undefined) {
    if (b.notes === null) notes = null;
    else if (typeof b.notes === 'string') {
      if (b.notes.length > 500) throw new Error('الملاحظات أطول من المسموح');
      notes = b.notes;
    } else {
      throw new Error('الملاحظات غير صالحة');
    }
  }

  return {
    isEnabled: b.isEnabled,
    inputBasis,
    conversionDays,
    effectiveFrom: b.effectiveFrom,
    notes,
    tiers: parseTiers(b.tiers),
  };
}

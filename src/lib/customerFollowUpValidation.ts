// ── Customer Follow-Up — shared validation logic ─────────────────────────────
// Used by the PUT API route and unit tests.
// Pure functions — no DB, no Next.js imports.

export const RESULT_TYPES = ['outside_governorate', 'outside_country', 'complaint', 'other_reason'] as const;
export const COMPLAINT_TYPES = ['barber', 'place', 'cleanliness', 'other'] as const;

export type ResultType    = typeof RESULT_TYPES[number];
export type ComplaintType = typeof COMPLAINT_TYPES[number];

export interface ContactPayload {
  clientId:        number;
  followUpMonth:   string;   // "YYYY-MM"
  resultType:      string;
  complaintType?:  string | null;
  complaintEmpId?: number | null;
  reasonText?:     string | null;
  notes?:          string | null;
}

export interface ValidationError {
  field:   string;
  message: string;
}

export function validateContactPayload(body: ContactPayload): ValidationError[] {
  const errors: ValidationError[] = [];

  // clientId
  if (!body.clientId || !Number.isInteger(body.clientId) || body.clientId <= 0) {
    errors.push({ field: 'clientId', message: 'معرّف العميل غير صالح' });
  }

  // followUpMonth
  if (!body.followUpMonth || !/^\d{4}-\d{2}$/.test(body.followUpMonth)) {
    errors.push({ field: 'followUpMonth', message: 'شهر المتابعة غير صالح (يجب أن يكون YYYY-MM)' });
  }

  // resultType required and must be a known value
  if (!body.resultType) {
    errors.push({ field: 'resultType', message: 'نتيجة التواصل مطلوبة' });
  } else if (!(RESULT_TYPES as readonly string[]).includes(body.resultType)) {
    errors.push({ field: 'resultType', message: `نتيجة التواصل غير معروفة: ${body.resultType}` });
  }

  if (errors.length > 0) return errors; // stop early if fundamentals are wrong

  const rt = body.resultType as ResultType;
  const ct = (body.complaintType || null) as ComplaintType | null;
  const reason = (body.reasonText || '').trim();

  // complaint branch
  if (rt === 'complaint') {
    if (!ct) {
      errors.push({ field: 'complaintType', message: 'تصنيف الشكوى مطلوب' });
    } else if (!(COMPLAINT_TYPES as readonly string[]).includes(ct)) {
      errors.push({ field: 'complaintType', message: `تصنيف الشكوى غير معروف: ${ct}` });
    } else {
      // reason is required for all complaint subtypes
      if (!reason) {
        errors.push({ field: 'reasonText', message: 'وصف الشكوى مطلوب' });
      }
      // complaintEmpId only allowed for barber subtype
      if (ct !== 'barber' && body.complaintEmpId) {
        errors.push({ field: 'complaintEmpId', message: 'معرّف الحلاق مسموح فقط عند اختيار شكوى من حلاق' });
      }
    }
  } else {
    // for non-complaint types, complaintType and complaintEmpId must be absent
    if (body.complaintType) {
      errors.push({ field: 'complaintType', message: 'تصنيف الشكوى غير مسموح لهذا النوع من النتائج' });
    }
    if (body.complaintEmpId) {
      errors.push({ field: 'complaintEmpId', message: 'معرّف الحلاق غير مسموح لهذا النوع من النتائج' });
    }
  }

  // other_reason requires text
  if (rt === 'other_reason' && !reason) {
    errors.push({ field: 'reasonText', message: 'السبب مطلوب عند اختيار سبب آخر' });
  }

  return errors;
}

/** Convert "YYYY-MM" to the first day of that month as a Date string "YYYY-MM-01" */
export function toFollowUpMonthDate(ym: string): string {
  const [y, m] = ym.split('-');
  return `${y}-${m}-01`;
}

/** Human-readable badge label for a follow-up result */
export function resultLabel(resultType: string, complaintType?: string | null): string {
  switch (resultType) {
    case 'outside_governorate': return 'خارج المحافظة';
    case 'outside_country':     return 'خارج الدولة';
    case 'complaint':
      switch (complaintType) {
        case 'barber':      return 'شكوى من حلاق';
        case 'place':       return 'شكوى من المكان';
        case 'cleanliness': return 'شكوى من النظافة';
        case 'other':       return 'شكوى أخرى';
        default:            return 'شكوى';
      }
    case 'other_reason': return 'سبب آخر';
    default:             return resultType;
  }
}

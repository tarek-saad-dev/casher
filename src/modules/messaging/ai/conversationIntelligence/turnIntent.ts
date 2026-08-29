/**
 * Deterministic current-turn intent for booking dialogue arbitration.
 * Plan stage is context — not a mandate to ignore new intent.
 */
export type TurnIntentClass =
  | 'BOOKING_PROGRESS'
  | 'BOOKING_MODIFICATION'
  | 'BOOKING_ALTERNATIVE_QUERY'
  | 'BUSINESS_INFORMATION_INTERRUPT'
  | 'RESUME'
  | 'CANCEL_RESET'
  | 'NEW_BOOKING_REQUEST'
  | 'UNKNOWN';

export type TurnIntentResult = {
  intent: TurnIntentClass;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  /** Optional subtype for alternatives */
  alternativeKind?:
    | 'other_employee_same_time'
    | 'other_time_same_employee'
    | 'other_branch'
    | 'nearby_general'
    | 'specific_employee_check';
};

/** Normalize lightly for intent regexes. */
function norm(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/\s+/g, ' ');
}

export function looksLikeAlternativeEmployeeQuery(text: string): boolean {
  const t = norm(text);
  return (
    /مين\s*(متاح|فاضي|تاني|غير)/.test(t) ||
    /حد\s*تاني/.test(t) ||
    /غير\s+\S+\s*(متاح|فاضي)/.test(t) ||
    /صنايعي\s*تاني|فني\s*تاني|حد\s*غير/.test(t) ||
    /متاح\s*تاني/.test(t) ||
    /مين\s*غير/.test(t) ||
    /في\s*حد\s*تاني/.test(t) ||
    /نفس\s*(الوقت|الميعاد)/.test(t) && /تاني|غير|مين|حد/.test(t)
  );
}

export function looksLikeAlternativeTimeQuery(text: string): boolean {
  const t = norm(text);
  return (
    /فيه\s*(قبلها|بعدها)/.test(t) ||
    /قبلها\s*بربع|بعدها\s*بربع/.test(t) ||
    /وقت\s*تاني|ميعاد\s*تاني|ساعه\s*تانيه|ساعة\s*تانية/.test(t) ||
    /اقرب\s*(قبل|بعد)/.test(t)
  );
}

export function looksLikeAlternativeBranchQuery(text: string): boolean {
  const t = norm(text);
  if (/خلي\s*الحجز|خليه|خليها|غير\s*الحجز/.test(t)) return false;
  return /فرع\s*تاني|لو\s*جليم|في\s*جليم|كامب|فرع\s*غير/.test(t) && /تاني|لو|في/.test(t);
}

export function looksLikeBusinessInfoInterrupt(text: string): boolean {
  const t = norm(text);
  return (
    /بكام|بكام\؟|السعر|الاسعار|سعر/.test(t) ||
    /بيقفل|بيفتح|مواعيد\s*العمل|ساعات\s*العمل/.test(t) ||
    /بالمناسبه/.test(t) ||
    /فين\s*الفرع|عنوان/.test(t)
  );
}

export function looksLikeBookingModification(text: string): boolean {
  const t = norm(text);
  // Explicit change markers — not mere "لا" alone at confirm
  return (
    /خليه|خليها|خلي\s*الحجز|بدل|غير|غيرها|غيرّ|مش\s+.+\s*،?\s*(خليه|عاوز)/.test(t) ||
    /لا\s+خليه|لا\s+خليها|طب\s+خليه|طيب\s+خليه/.test(t) ||
    /بدل\s*(النهارده|بكره|عمر|محمد)/.test(t)
  );
}

/**
 * Classify the CURRENT customer turn for arbitration.
 */
export function detectTurnIntent(text: string): TurnIntentResult {
  const raw = text.trim();
  if (!raw) return { intent: 'UNKNOWN', confidence: 'LOW' };
  const t = norm(raw);

  // Cancel / reset first
  if (
    /خلاص\s*مش\s*هحجز|سيب\s*الحجز|الغي\s*الحجز|الغى\s*الحجز|ابدأ\s*من\s*(الاول|الأول)|نبدأ\s*من\s*(الاول|الأول)|cancel/.test(
      t,
    )
  ) {
    return { intent: 'CANCEL_RESET', confidence: 'HIGH' };
  }

  // Resume
  if (/^(كمل|كمّل|كملي|كمّلي)(\s+الحجز)?$/.test(t) || /كمل\s*الحجز|نرجع\s*للحجز/.test(t)) {
    return { intent: 'RESUME', confidence: 'HIGH' };
  }

  // Business info interrupt (price/hours) — before booking progress
  if (looksLikeBusinessInfoInterrupt(t)) {
    return { intent: 'BUSINESS_INFORMATION_INTERRUPT', confidence: 'HIGH' };
  }

  // Alternative queries — critical vs ready_to_confirm domination
  if (looksLikeAlternativeEmployeeQuery(t)) {
    return {
      intent: 'BOOKING_ALTERNATIVE_QUERY',
      confidence: 'HIGH',
      alternativeKind: 'other_employee_same_time',
    };
  }
  if (looksLikeAlternativeTimeQuery(t)) {
    return {
      intent: 'BOOKING_ALTERNATIVE_QUERY',
      confidence: 'HIGH',
      alternativeKind: 'other_time_same_employee',
    };
  }
  if (looksLikeAlternativeBranchQuery(t)) {
    return {
      intent: 'BOOKING_ALTERNATIVE_QUERY',
      confidence: 'HIGH',
      alternativeKind: 'other_branch',
    };
  }

  // Specific employee availability check: "محمد فاضي وقتها؟"
  if (/\S+\s+(فاضي|متاح)\s*(وقتها|الوقت|الساعه|الساعة)?/.test(t) && !/مين/.test(t)) {
    return {
      intent: 'BOOKING_ALTERNATIVE_QUERY',
      confidence: 'MEDIUM',
      alternativeKind: 'specific_employee_check',
    };
  }

  // Modification
  if (looksLikeBookingModification(t)) {
    return { intent: 'BOOKING_MODIFICATION', confidence: 'HIGH' };
  }

  // Progress: ordinal / clock / affirmative / short confirm
  if (
    /^(الاول|الأول|التاني|الثاني|التالت|الثالث|اخر|آخر|[123])$/.test(t) ||
    /^(الساعه|الساعة)\s*\d{1,2}/.test(t) ||
    /^(ايوه|أيوه|ايوة|أيوة|اه|أه|نعم|تمام|ماشي|اكد|أكد|يلا|yes|ok)$/.test(t) ||
    /^(ايوه|أيوه|اه)\s+(اكد|أكد)/.test(t) ||
    /^(اكد|أكد)\s+الحجز$/.test(t)
  ) {
    return { intent: 'BOOKING_PROGRESS', confidence: 'HIGH' };
  }

  // Fresh booking request phrasing
  if (/عاوز\s*احجز|عايز\s*احجز|احجز(لي|لي)|حجز\s*جديد/.test(t)) {
    return { intent: 'NEW_BOOKING_REQUEST', confidence: 'MEDIUM' };
  }

  return { intent: 'UNKNOWN', confidence: 'LOW' };
}

/** Near-duplicate unresolved question (repair signal). */
export function isNearDuplicateQuestion(a: string, b: string): boolean {
  const na = norm(a).replace(/[؟?!.،,]/g, '');
  const nb = norm(b).replace(/[؟?!.،,]/g, '');
  if (!na || !nb) return false;
  if (na === nb) return true;
  // Shared significant tokens (≥2)
  const ta = new Set(na.split(' ').filter((w) => w.length > 2));
  const tb = nb.split(' ').filter((w) => w.length > 2);
  const overlap = tb.filter((w) => ta.has(w)).length;
  return overlap >= 2 && overlap / Math.max(ta.size, tb.length) >= 0.6;
}

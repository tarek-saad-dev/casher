/**
 * Detect booking-management speech acts (Egyptian Arabic).
 * Pure heuristics for routing; confirmation still requires plan+gate.
 */
export type ManagementSpeechAct =
  | { kind: 'lookup_upcoming' }
  | { kind: 'cancel' }
  | { kind: 'modify' }
  | { kind: 'none' };

export function detectBookingManagementSpeech(text: string): ManagementSpeechAct {
  const t = String(text ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
  if (!t) return { kind: 'none' };

  if (
    /عندي\s*حجز|حجوزاتي|حجزي\s*امتى|وريني\s*حجوز|فيه\s*حجز|في\s*حجز/.test(t) ||
    /حجزي\s*\?|عندي\s*ميعاد/.test(t)
  ) {
    return { kind: 'lookup_upcoming' };
  }

  if (/ألغي|الغي|الغى|إلغاء|الغاء|كانسل|cancel/.test(t)) {
    return { kind: 'cancel' };
  }

  if (
    /أغير|اغير|غيره|غير\s*الحجز|خليه|بدل\s+|أأجله|اجله|أجله|رزجدول|reschedule|عدّل|عدل\s*الحجز/.test(
      t,
    )
  ) {
    return { kind: 'modify' };
  }

  return { kind: 'none' };
}

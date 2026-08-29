import type { BookingCandidateSlot, BookingTimePreference } from './types';
import {
  parseTimePreferenceText as ciParseTime,
  filterSlotsByPreference as ciFilter,
  minutesOf as ciMinutes,
  formatSlotLabelAr as ciFormat,
  toPlannerTimePreference,
  type ParseTimePreferenceOptions,
} from '../conversationIntelligence/timePreference';
import {
  looksLikePureCandidateSelection,
  looksLikeTimeConstraint,
} from '../conversationOrchestrator/constraintDelta';

/** Parse Arabic/English time preference phrases into structured preference. */
export function parseTimePreferenceText(
  text: string | null | undefined,
  options?: ParseTimePreferenceOptions,
): BookingTimePreference | null {
  const ci = ciParseTime(text, options);
  if (!ci) return null;
  return toPlannerTimePreference(ci);
}

export const minutesOf = ciMinutes;
export const formatSlotLabelAr = ciFormat;

export function filterSlotsByPreference(
  slots: BookingCandidateSlot[],
  pref: BookingTimePreference | null,
  max = 3,
): BookingCandidateSlot[] {
  return ciFilter(slots, pref, max);
}

/**
 * True when inbound is a short ordinal / index pick against a shortlist.
 * Explicit time constraints ("الساعة 11") are NOT slot choices unless they
 * resolve to an existing candidate (handled by ConstraintDelta).
 */
export function looksLikeSlotChoice(text: string): boolean {
  const raw = text.trim();
  if (!raw) return false;
  if (looksLikePureCandidateSelection(raw)) return true;
  // Bare digit 1–3 only when NOT wrapped in time-constraint phrasing
  if (/^(رقم\s*)?[123]$/i.test(raw) && !looksLikeTimeConstraint(raw)) return true;
  return false;
}

/** Resolve customer slot choice against candidates. */
export function resolveSlotChoice(
  text: string,
  candidates: BookingCandidateSlot[],
  options?: { contextTimeHm?: string | null },
): { slot: BookingCandidateSlot | null; ambiguous: boolean } {
  if (!candidates.length) return { slot: null, ambiguous: false };
  const raw = text.trim().toLowerCase();

  if (/^(الأول|الاول|رقم ?1|أول واحد|اول واحد)$/i.test(raw) || raw === '1') {
    return { slot: candidates[0]!, ambiguous: false };
  }
  if (/^(التاني|الثاني|رقم ?2)$/i.test(raw) || raw === '2') {
    return { slot: candidates[1] ?? null, ambiguous: false };
  }
  if (/^(التالت|الثالث|رقم ?3|آخر|اخر)$/i.test(raw) || raw === '3') {
    return { slot: candidates[Math.min(2, candidates.length - 1)] ?? null, ambiguous: false };
  }

  // Only match clock against candidates when phrasing is a pure short pick
  // (e.g. "10:00" / "10") — ConstraintDelta owns "الساعة 11" refresh path.
  const pref = ciParseTime(text, { contextTimeHm: options?.contextTimeHm ?? null });
  if (pref?.timeHm) {
    const target = pref.timeHm;
    const exact = candidates.filter((c) => c.time === target);
    if (exact.length === 1) return { slot: exact[0]!, ambiguous: false };
    const h = Number(target.slice(0, 2));
    const hourMatches = candidates.filter((c) => Number(c.time.slice(0, 2)) === h);
    if (hourMatches.length === 1) return { slot: hourMatches[0]!, ambiguous: false };
    if (hourMatches.length > 1) return { slot: null, ambiguous: true };
  }

  return { slot: null, ambiguous: false };
}

export function isAffirmative(text: string): boolean {
  const t = text.trim();
  if (/^(أيوه|ايوه|أيوة|ايوة|أه|اه|نعم|تمام|ماشي|أكد|اكد|أكدلي|اكدلي|yes|ok|okay|يلا)$/i.test(t)) {
    return true;
  }
  if (/^(أيوه|ايوه|أيوة|ايوة|أه|اه|نعم)\s+(أكد|اكد|أكدلي|اكدلي)(\s+الحجز)?$/i.test(t)) {
    return true;
  }
  if (/^(أكد|اكد)\s+الحجز$/i.test(t)) {
    return true;
  }
  return false;
}

export function isNegativeOrCancel(text: string): boolean {
  return /^(لا|لأ|الغى|الغي|إلغاء|الغاء|ابدأ من جديد|ابدء من جديد|cancel|no)$/i.test(
    text.trim(),
  );
}

export function isResumePlanner(text: string): boolean {
  return /كمل الحجز|كمّل الحجز|كملي الحجز|رجع للحجز|كمّل|كمل/.test(text.trim());
}

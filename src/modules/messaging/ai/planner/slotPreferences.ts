import type { BookingCandidateSlot, BookingTimePreference } from './types';
import {
  parseTimePreferenceText as ciParseTime,
  filterSlotsByPreference as ciFilter,
  minutesOf as ciMinutes,
  formatSlotLabelAr as ciFormat,
  toPlannerTimePreference,
} from '../conversationIntelligence/timePreference';

/** Parse Arabic/English time preference phrases into structured preference. */
export function parseTimePreferenceText(
  text: string | null | undefined,
): BookingTimePreference | null {
  const ci = ciParseTime(text);
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

/** True when inbound is a short ordinal / index / clock pick against a shortlist. */
export function looksLikeSlotChoice(text: string): boolean {
  const raw = text.trim();
  if (!raw) return false;
  return (
    /^(الأول|الاول|التاني|الثاني|التالت|الثالث|آخر واحد|اخر واحد|آخر|اخر)$/i.test(raw) ||
    /^(رقم\s*)?[123]$/i.test(raw) ||
    /^(الساعة\s*)?\d{1,2}(:\d{2})?\s*(ص|م|am|pm)?$/i.test(raw)
  );
}

/** Resolve customer slot choice against candidates. */
export function resolveSlotChoice(
  text: string,
  candidates: BookingCandidateSlot[],
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

  const hmMatch = raw.match(/(\d{1,2})(?::(\d{2}))?/);
  if (hmMatch) {
    let h = Number(hmMatch[1]);
    const m = hmMatch[2] ? Number(hmMatch[2]) : 0;
    if (/م|مساء|pm|بليل|بالليل|ليل/.test(raw) && h < 12) h += 12;
    if (!/[صم]|am|pm|مساء|صبح|ليل/.test(raw) && h >= 1 && h <= 11) h += 12;
    const target = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    const exact = candidates.filter((c) => c.time === target);
    if (exact.length === 1) return { slot: exact[0]!, ambiguous: false };
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

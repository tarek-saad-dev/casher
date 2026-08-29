import type { BookingCandidateSlot, BookingTimePreference } from './types';

/** Parse Arabic/English time preference phrases into structured preference. */
export function parseTimePreferenceText(
  text: string | null | undefined,
): BookingTimePreference | null {
  if (!text) return null;
  const raw = text.trim().toLowerCase();
  if (!raw) return null;

  if (/أقرب|اقرب|earliest|asap|أول ميعاد|اول ميعاد/.test(raw)) {
    return { kind: 'earliest' };
  }
  if (/الصبح|صباحا|morning/.test(raw)) return { kind: 'morning' };
  if (/الظهر|بعد الظهر|afternoon/.test(raw)) return { kind: 'afternoon' };
  if (/بالليل|مساء|evening|night/.test(raw)) return { kind: 'evening' };

  const after = raw.match(/(?:بعد|after)\s*(?:الساعة\s*)?(\d{1,2})(?::(\d{2}))?/);
  if (after) {
    return { kind: 'after', timeHm: toHm24(Number(after[1]), after[2] ? Number(after[2]) : 0, raw) };
  }
  const before = raw.match(/(?:قبل|before)\s*(?:الساعة\s*)?(\d{1,2})(?::(\d{2}))?/);
  if (before) {
    return {
      kind: 'before',
      timeHm: toHm24(Number(before[1]), before[2] ? Number(before[2]) : 0, raw),
    };
  }
  const exact = raw.match(/(?:الساعة\s*)?(\d{1,2})(?::(\d{2}))?\s*(ص|م|am|pm)?/);
  if (exact && !/بعد|قبل|after|before/.test(raw)) {
    return {
      kind: 'exact',
      timeHm: toHm24(
        Number(exact[1]),
        exact[2] ? Number(exact[2]) : 0,
        `${raw} ${exact[3] || ''}`,
      ),
    };
  }
  return { kind: 'any' };
}

function toHm24(hour: number, minute: number, context: string): string {
  let h = hour;
  const ctx = context.toLowerCase();
  if (/م|pm|مساء|ليل/.test(ctx) && h < 12) h += 12;
  if (/ص|am|صبح/.test(ctx) && h === 12) h = 0;
  // Salon context: bare 1–11 often evening; bare 12 noon; 6–11 without marker → PM for booking
  if (!/[صم]|am|pm|مساء|صبح|ليل/.test(ctx) && h >= 1 && h <= 11) {
    h += 12;
  }
  return `${String(h).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

export function minutesOf(hm: string): number {
  const [h, m] = hm.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

export function filterSlotsByPreference(
  slots: BookingCandidateSlot[],
  pref: BookingTimePreference | null,
  max = 3,
): BookingCandidateSlot[] {
  if (!slots.length) return [];
  let filtered = [...slots];
  if (pref) {
    switch (pref.kind) {
      case 'after':
        if (pref.timeHm) {
          const min = minutesOf(pref.timeHm);
          filtered = filtered.filter((s) => minutesOf(s.time) >= min);
        }
        break;
      case 'before':
        if (pref.timeHm) {
          const min = minutesOf(pref.timeHm);
          filtered = filtered.filter((s) => minutesOf(s.time) <= min);
        }
        break;
      case 'exact':
        if (pref.timeHm) {
          const target = minutesOf(pref.timeHm);
          filtered = [...filtered].sort(
            (a, b) => Math.abs(minutesOf(a.time) - target) - Math.abs(minutesOf(b.time) - target),
          );
        }
        break;
      case 'morning':
        filtered = filtered.filter((s) => minutesOf(s.time) < 12 * 60);
        break;
      case 'afternoon':
        filtered = filtered.filter((s) => {
          const m = minutesOf(s.time);
          return m >= 12 * 60 && m < 17 * 60;
        });
        break;
      case 'evening':
        filtered = filtered.filter((s) => minutesOf(s.time) >= 17 * 60);
        break;
      case 'earliest':
      case 'any':
      default:
        break;
    }
  }
  // Band preferences: do not silently fall back to the wrong part of day.
  if (
    !filtered.length &&
    pref &&
    (pref.kind === 'evening' || pref.kind === 'morning' || pref.kind === 'afternoon')
  ) {
    return [];
  }
  if (!filtered.length) filtered = [...slots];
  return filtered.slice(0, max);
}

export function formatSlotLabelAr(timeHm: string): string {
  const [hs, ms] = timeHm.split(':').map(Number);
  const h = hs || 0;
  const suffix = h >= 12 ? 'م' : 'ص';
  const displayH = h % 12 === 0 ? 12 : h % 12;
  return `${displayH}:${String(ms || 0).padStart(2, '0')} ${suffix}`;
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
    if (/م|مساء|pm/.test(raw) && h < 12) h += 12;
    if (!/[صم]|am|pm|مساء|صبح/.test(raw) && h >= 1 && h <= 11) h += 12;
    const target = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    const exact = candidates.filter((c) => c.time === target);
    if (exact.length === 1) return { slot: exact[0]!, ambiguous: false };
    // hour-only match (7 → 19:00, 19:15, ...)
    const hourMatches = candidates.filter((c) => Number(c.time.slice(0, 2)) === h);
    if (hourMatches.length === 1) return { slot: hourMatches[0]!, ambiguous: false };
    if (hourMatches.length > 1) return { slot: null, ambiguous: true };
  }

  return { slot: null, ambiguous: false };
}

export function isAffirmative(text: string): boolean {
  return /^(أيوه|ايوه|أه|اه|نعم|تمام|أكد|اكد|أكدلي|اكدلي|yes|ok|okay|يلا)$/i.test(
    text.trim(),
  );
}

export function isNegativeOrCancel(text: string): boolean {
  return /^(لا|لأ|الغى|الغي|إلغاء|الغاء|ابدأ من جديد|ابدء من جديد|cancel|no)$/i.test(
    text.trim(),
  );
}

export function isResumePlanner(text: string): boolean {
  return /كمل الحجز|كمّل الحجز|كملي الحجز|رجع للحجز|كمّل|كمل/.test(text.trim());
}

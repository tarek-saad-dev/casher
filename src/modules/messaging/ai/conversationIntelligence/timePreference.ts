/**
 * Conversation Intelligence — Egyptian time preference parsing + slot ranking.
 */
import type { BookingCandidateSlot, BookingTimePreference } from '../planner/types';

export type TimePreferenceKind = BookingTimePreference['kind'] | 'around' | 'range';

export type CiTimePreference = {
  kind: TimePreferenceKind;
  timeHm?: string | null;
  /** For range mode */
  timeHmEnd?: string | null;
  confidence?: 'HIGH' | 'MEDIUM' | 'LOW';
};

export function minutesOf(hm: string): number {
  const [h, m] = hm.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

/** 48h timeline minutes for overnight-aware distance (dayOffset 0|1). */
export function timelineMinutes(hm: string, dayOffset: 0 | 1 = 0): number {
  return dayOffset * 1440 + minutesOf(hm);
}

/**
 * Resolve 12h clock → 24h using daypart markers + optional conversation context.
 *
 * Overnight salon semantics (بليل / بالليل / الفجر):
 * - hours 1–4 → keep as 01–04 (after midnight on business day)
 * - hour 12 → 00:00
 * - hours 5–11 → +12 (evening)
 *
 * مساء without بليل: classic PM (+12 for 1–11).
 * Bare hour: use contextTimeHm when present; else salon PM bias for 1–11.
 */
export function toHm24(
  hour: number,
  minute: number,
  context: string,
  contextTimeHm?: string | null,
): string {
  let h = hour;
  const ctx = context.toLowerCase();
  const nightLate =
    /بليل|بالليل|(?:^|[\s])ليل(?:$|[\s])|الفجر|بعد\s*نص\s*الليل|بعد نص الليل/.test(ctx);
  const eveningPm =
    /مساء|مساءا|العشاء|(?:^|[\s])pm(?:$|[\s])|(?:^|[\s])م(?:$|[\s])/.test(ctx) && !nightLate;
  const morning =
    /الصبح|صباحا|(?:^|[\s])صبح(?:$|[\s])|(?:^|[\s])am(?:$|[\s])|(?:^|[\s])ص(?:$|[\s])/.test(ctx);

  if (nightLate) {
    if (h === 12) h = 0;
    else if (h >= 5 && h <= 11) h += 12;
    // 1–4 stay AM overnight
  } else if (eveningPm && h < 12) {
    h += 12;
  } else if (morning && h === 12) {
    h = 0;
  } else if (morning && h > 12) {
    h -= 12;
  } else if (!nightLate && !eveningPm && !morning && h >= 1 && h <= 11) {
    // Contextual bare hour
    if (contextTimeHm) {
      const ctxH = Number(String(contextTimeHm).slice(0, 2));
      if (Number.isFinite(ctxH)) {
        if (ctxH >= 15) {
          // Evening/night conversation → prefer PM
          h += 12;
        }
        // Morning context (ctxH < 12): keep as AM
        // Midday 12–14: keep as AM for 1–11 only if hour > ctxH, else PM if hour < ctxH?
        // Spec: ~10 AM + "11" → 11:00 AM (keep)
        else if (ctxH >= 12 && ctxH < 15) {
          // Early afternoon: still prefer PM for salon booking hours
          h += 12;
        }
      } else {
        h += 12;
      }
    } else {
      // Default salon bias: bare 1–11 → PM
      h += 12;
    }
  }
  return `${String(h).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function parseClockFragment(
  raw: string,
): { hour: number; minute: number; rest: string } | null {
  // 10 ونص / 10 وربع / 10 ونص
  const half = raw.match(/(\d{1,2})\s*(?:و)?\s*نص/);
  if (half) return { hour: Number(half[1]), minute: 30, rest: raw };
  const quarter = raw.match(/(\d{1,2})\s*(?:و)?\s*ربع/);
  if (quarter) return { hour: Number(quarter[1]), minute: 15, rest: raw };
  const hm = raw.match(/(\d{1,2})(?::|\.)(\d{2})/);
  if (hm) return { hour: Number(hm[1]), minute: Number(hm[2]), rest: raw };
  const hOnly = raw.match(/(?:الساعة\s*|الساعه\s*|على\s*|الساع[ةه]\s*)?(\d{1,2})(?!\d)/);
  if (hOnly) return { hour: Number(hOnly[1]), minute: 0, rest: raw };
  // عشرة / تسعة spelled — light support
  const spelled: Record<string, number> = {
    واحد: 1,
    اثنين: 2,
    اتنين: 2,
    تلاتة: 3,
    ثلاثة: 3,
    اربعة: 4,
    أربعة: 4,
    خمسة: 5,
    ستة: 6,
    سبعه: 7,
    سبعة: 7,
    تمانية: 8,
    ثمانية: 8,
    تسعة: 9,
    تسعه: 9,
    عشرة: 10,
    عشره: 10,
    احدعش: 11,
    اتناش: 12,
  };
  for (const [word, hour] of Object.entries(spelled)) {
    if (raw.includes(word)) return { hour, minute: 0, rest: raw };
  }
  return null;
}

export type ParseTimePreferenceOptions = {
  /** Current booking / conversation clock for bare-hour inference */
  contextTimeHm?: string | null;
};

/** Parse Arabic/English time preference into structured preference. */
export function parseTimePreferenceText(
  text: string | null | undefined,
  options?: ParseTimePreferenceOptions,
): CiTimePreference | null {
  if (!text) return null;
  const raw = text.trim().toLowerCase();
  if (!raw) return null;
  const contextTimeHm = options?.contextTimeHm ?? null;

  if (/أقرب|اقرب|earliest|asap|أول ميعاد|اول ميعاد|أي وقت|اى وقت|اي وقت/.test(raw)) {
    return { kind: 'earliest', confidence: 'HIGH' };
  }

  // around / حوالي / حدود — before bare daypart
  if (/حوالي|حوالى|حدود|تقريبا|تقريباً|around|~/.test(raw)) {
    const clock = parseClockFragment(raw);
    if (clock) {
      return {
        kind: 'around',
        timeHm: toHm24(clock.hour, clock.minute, raw, contextTimeHm),
        confidence: 'HIGH',
      };
    }
  }

  const after = raw.match(/(?:بعد|after)\s*(?:الساعة\s*|الساعه\s*)?(\d{1,2})(?::(\d{2}))?/);
  if (after) {
    return {
      kind: 'after',
      timeHm: toHm24(Number(after[1]), after[2] ? Number(after[2]) : 0, raw, contextTimeHm),
      confidence: 'HIGH',
    };
  }
  const before = raw.match(/(?:قبل|before)\s*(?:الساعة\s*|الساعه\s*)?(\d{1,2})(?::(\d{2}))?/);
  if (before) {
    return {
      kind: 'before',
      timeHm: toHm24(Number(before[1]), before[2] ? Number(before[2]) : 0, raw, contextTimeHm),
      confidence: 'HIGH',
    };
  }

  // Range: بين 8 و10 / من 9 لـ11
  const range =
    raw.match(/بين\s*(\d{1,2})\s*و\s*(\d{1,2})/) ||
    raw.match(/من\s*(\d{1,2})\s*(?:ل|الى|إلى|لـ)\s*(\d{1,2})/);
  if (range) {
    return {
      kind: 'range',
      timeHm: toHm24(Number(range[1]), 0, raw, contextTimeHm),
      timeHmEnd: toHm24(Number(range[2]), 0, raw, contextTimeHm),
      confidence: 'MEDIUM',
    };
  }

  // Explicit clock with night/morning markers — prefer exact/around over daypart
  const hasClock = /\d{1,2}|عشرة|عشره|تسعة|ثمانية|تمانية/.test(raw);
  const nightLateMark =
    /بليل|بالليل|(?:^|[\s])ليل(?:$|[\s])|الفجر|بعد\s*نص\s*الليل/.test(raw);
  const eveningMark =
    /مساء|مساءا|العشاء|(?:^|[\s])pm(?:$|[\s])/.test(raw) && !nightLateMark;
  const morningMark = /الصبح|صباحا|(?:^|[\s])صبح(?:$|[\s])|(?:^|[\s])am(?:$|[\s])/.test(raw);

  if (hasClock) {
    const clock = parseClockFragment(raw);
    if (clock) {
      let ctx = raw;
      if (nightLateMark) ctx = `${raw} بليل`;
      else if (eveningMark) ctx = `${raw} مساء`;
      else if (morningMark) ctx = `${raw} صبح`;
      // UX: حوالي / عاوز / خلي → around; bare الساعة N → exact (still refreshes if not in candidates)
      const kind: TimePreferenceKind = /حوالي|حوالى|حدود|تقريبا|عاوز|عايز|خلي/.test(raw)
        ? 'around'
        : 'exact';
      return {
        kind,
        timeHm: toHm24(clock.hour, clock.minute, ctx, contextTimeHm),
        confidence: 'HIGH',
      };
    }
  }

  // Dayparts last (no clock)
  if (/الصبح|صباحا|morning/.test(raw)) return { kind: 'morning', confidence: 'HIGH' };
  if (/الظهر|بعد الظهر|afternoon/.test(raw)) return { kind: 'afternoon', confidence: 'HIGH' };
  if (/بالليل|بليل|مساء|evening|night|آخر اليوم|اخر اليوم/.test(raw)) {
    return { kind: 'evening', confidence: 'HIGH' };
  }
  if (/العصر/.test(raw)) return { kind: 'afternoon', confidence: 'MEDIUM' };

  return { kind: 'any', confidence: 'LOW' };
}

/** Convert CI preference to planner BookingTimePreference. */
export function toPlannerTimePreference(pref: CiTimePreference | null): BookingTimePreference | null {
  if (!pref) return null;
  return {
    kind: pref.kind as BookingTimePreference['kind'],
    timeHm: pref.timeHm ?? null,
    timeHmEnd: pref.timeHmEnd ?? null,
  };
}

/**
 * Rank/filter slots by preference.
 * around/exact: sort by distance to target (never dump morning when night was asked).
 */
export function filterSlotsByPreference(
  slots: BookingCandidateSlot[],
  pref: BookingTimePreference | CiTimePreference | null,
  max = 3,
): BookingCandidateSlot[] {
  if (!slots.length) return [];
  let filtered = [...slots];
  const kind = pref?.kind ?? 'any';
  const timeHm = pref && 'timeHm' in pref ? pref.timeHm : null;
  const timeHmEnd =
    pref && 'timeHmEnd' in pref ? (pref as CiTimePreference).timeHmEnd : null;

  switch (kind) {
    case 'after':
      if (timeHm) {
        const min = minutesOf(timeHm);
        filtered = filtered.filter((s) => minutesOf(s.time) >= min);
      }
      break;
    case 'before':
      if (timeHm) {
        const min = minutesOf(timeHm);
        filtered = filtered.filter((s) => minutesOf(s.time) <= min);
      }
      break;
    case 'range':
      if (timeHm && timeHmEnd) {
        const a = minutesOf(timeHm);
        const b = minutesOf(timeHmEnd);
        const lo = Math.min(a, b);
        const hi = Math.max(a, b);
        filtered = filtered.filter((s) => {
          const m = minutesOf(s.time);
          return m >= lo && m <= hi;
        });
      }
      break;
    case 'around':
    case 'exact':
      if (timeHm) {
        const targetHour = Number(timeHm.slice(0, 2));
        // Overnight early morning (00–04): prefer dayOffset=1 timeline
        const target =
          targetHour <= 4
            ? timelineMinutes(timeHm, 1)
            : timelineMinutes(timeHm, 0);
        const dist = (s: BookingCandidateSlot) =>
          Math.abs(timelineMinutes(s.time, s.dayOffset ?? 0) - target);
        const band = filtered.filter((s) => dist(s) <= 90);
        filtered = (band.length ? band : filtered).sort((a, b) => dist(a) - dist(b));
        return filtered.slice(0, max);
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

  if (
    !filtered.length &&
    (kind === 'evening' || kind === 'morning' || kind === 'afternoon')
  ) {
    return [];
  }
  if (!filtered.length) filtered = [...slots];

  // For after/before with results, still prefer closer to boundary when many exist
  if ((kind === 'after' || kind === 'before') && timeHm) {
    const target = minutesOf(timeHm);
    filtered = [...filtered].sort(
      (a, b) => Math.abs(minutesOf(a.time) - target) - Math.abs(minutesOf(b.time) - target),
    );
  }

  return filtered.slice(0, max);
}

export function formatSlotLabelAr(timeHm: string): string {
  const [hs, ms] = timeHm.split(':').map(Number);
  const h = hs || 0;
  const suffix = h >= 12 ? 'م' : 'ص';
  const displayH = h % 12 === 0 ? 12 : h % 12;
  return `${displayH}:${String(ms || 0).padStart(2, '0')} ${suffix}`;
}

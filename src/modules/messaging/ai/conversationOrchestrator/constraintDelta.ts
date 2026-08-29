/**
 * V3.1 ConstraintDelta — selection vs new constraint vs repair.
 * Current message compared against plan + candidates before planner transitions.
 */
import type { BookingCandidateSlot, BookingTimePreference } from '../planner/types';
import {
  parseTimePreferenceText,
  type CiTimePreference,
} from '../conversationIntelligence/timePreference';
import { looksLikeBookingModification } from '../conversationIntelligence/turnIntent';

export type TemporalDeltaKind =
  | 'SET_EXACT_TIME'
  | 'SET_AROUND_TIME'
  | 'SET_AFTER_TIME'
  | 'SET_BEFORE_TIME'
  | 'SET_TIME_RANGE'
  | 'SET_DAYPART'
  | 'SET_EARLIEST'
  | 'CLEAR_TIME_PREFERENCE';

export type ConstraintDelta = {
  service?: string | null;
  employee?: string | null;
  branch?: string | null;
  date?: string | null;
  timePreference?: BookingTimePreference | null;
  temporalKind?: TemporalDeltaKind | null;
  /** Exact match against stored candidates → select */
  selectedCandidateIndex?: number | null;
  selectedCandidateTime?: string | null;
  /** Explicit time that is NOT in candidates → refresh */
  newTimeNotInCandidates?: boolean;
  rejectedInterpretation?: boolean;
  repairSignal?: boolean;
  /** True when this turn is an ordinal/index pick of existing options */
  isCandidateSelection?: boolean;
  mutatesPlan: boolean;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  reasons: string[];
};

function norm(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/\s+/g, ' ');
}

export function looksLikeRepairSignal(text: string): boolean {
  const t = norm(text);
  return (
    /مش\s*من\s*المواعيد/.test(t) ||
    /مش\s*من\s*دول/.test(t) ||
    /لا\s*مش\s*دول/.test(t) ||
    /مش\s*عايز\s*واحد\s*منهم/.test(t) ||
    /لا\s*انا\s*بقول/.test(t) ||
    /قصدي\s*\d/.test(t) ||
    /لا\s*قصدي/.test(t) ||
    /مش\s*ده\s*قصدي/.test(t) ||
    /مش\s*اللي\s*فوق/.test(t) ||
    /فهمتني\s*غلط|فهمت\s*غلط/.test(t) ||
    ((/انا\s*بقصد|انا\s*عاوز/.test(t) || /بقصد/.test(t)) && /\d|ساعه|ساعة/.test(t))
  );
}

/** Ordinal / short index only — not clock times. */
export function looksLikePureCandidateSelection(text: string): boolean {
  const raw = text.trim();
  return (
    /^(الأول|الاول|التاني|الثاني|التالت|الثالث|آخر واحد|اخر واحد|آخر|اخر)$/i.test(raw) ||
    /^(رقم\s*)?[123]$/i.test(raw)
  );
}

/**
 * Explicit time constraint phrasing — must NOT be treated as picking old shortlist
 * unless the resolved clock exactly matches a candidate.
 */
export function looksLikeTimeConstraint(text: string): boolean {
  const t = norm(text);
  if (looksLikePureCandidateSelection(text)) return false;
  // Bare 1/2/3 without clock words = ordinal, not time
  if (/^[123]$/.test(t.trim())) return false;
  return (
    /ساعه|ساعة|بالليل|بليل|مساء|مساءا|الصبح|صباحا|حوالي|بعد\s*\d|قبل\s*\d|من\s*\d\s*ل/.test(
      t,
    ) ||
    /عاوز\s*(احجز\s*)?\d|عايز\s*(احجز\s*)?\d|خليها?\s*\d|طب\s*\d|خليه\s*\d/.test(t) ||
    /^(الساعه|الساعة)\s*\d{1,2}/.test(t) ||
    /^\d{1,2}(:\d{2})\s*(بليل|بالليل|مساء|مساءا|الصبح|ص|م|am|pm)?$/.test(t) ||
    /^\d{1,2}\s*(بليل|بالليل|مساء|مساءا|الصبح|ص|م|am|pm)$/.test(t) ||
    (/^\d{1,2}$/.test(t) && Number(t) >= 4) // bare hour 4–12 may be clock; 1–3 reserved for ordinals
  );
}

function temporalKindFromPref(pref: CiTimePreference): TemporalDeltaKind {
  switch (pref.kind) {
    case 'around':
      return 'SET_AROUND_TIME';
    case 'after':
      return 'SET_AFTER_TIME';
    case 'before':
      return 'SET_BEFORE_TIME';
    case 'range':
      return 'SET_TIME_RANGE';
    case 'earliest':
      return 'SET_EARLIEST';
    case 'morning':
    case 'afternoon':
    case 'evening':
      return 'SET_DAYPART';
    case 'exact':
    default:
      return 'SET_EXACT_TIME';
  }
}

function candidateExactMatch(
  timeHm: string,
  candidates: BookingCandidateSlot[],
): BookingCandidateSlot | null {
  const exact = candidates.find((c) => c.time === timeHm);
  if (exact) return exact;
  // hour-only match when minutes are :00 and single candidate that hour
  const h = Number(timeHm.slice(0, 2));
  const hourMatches = candidates.filter((c) => Number(c.time.slice(0, 2)) === h);
  if (hourMatches.length === 1) return hourMatches[0]!;
  return null;
}

export type ConstraintDeltaContext = {
  text: string;
  candidates?: BookingCandidateSlot[];
  /** Current plan / conversation time context for bare-hour inference */
  contextTimeHm?: string | null;
  contextStage?: string | null;
};

/**
 * Build ConstraintDelta for the CURRENT customer turn.
 */
export function detectConstraintDelta(ctx: ConstraintDeltaContext): ConstraintDelta {
  const text = ctx.text.trim();
  const candidates = ctx.candidates ?? [];
  const reasons: string[] = [];
  const repair = looksLikeRepairSignal(text);
  const delta: ConstraintDelta = {
    mutatesPlan: false,
    confidence: 'LOW',
    reasons,
    rejectedInterpretation: repair,
    repairSignal: repair,
    isCandidateSelection: false,
    newTimeNotInCandidates: false,
  };

  if (!text) return delta;

  // Pure ordinal selection
  if (looksLikePureCandidateSelection(text) && candidates.length) {
    const t = norm(text);
    let idx = 0;
    if (/تاني|ثاني|2/.test(t) || t === '2') idx = 1;
    else if (/تالت|ثالث|3|اخر|آخر/.test(t) || t === '3') idx = Math.min(2, candidates.length - 1);
    const slot = candidates[idx];
    if (slot) {
      delta.isCandidateSelection = true;
      delta.selectedCandidateIndex = idx;
      delta.selectedCandidateTime = slot.time;
      delta.mutatesPlan = true;
      delta.confidence = 'HIGH';
      reasons.push('ordinal_selection');
      return delta;
    }
  }

  // Time constraint
  if (looksLikeTimeConstraint(text) || repair) {
    const pref = parseTimePreferenceText(text, {
      contextTimeHm: ctx.contextTimeHm ?? null,
    });
    if (pref && (pref.timeHm || ['morning', 'afternoon', 'evening', 'earliest'].includes(pref.kind))) {
      const plannerPref: BookingTimePreference = {
        kind: pref.kind as BookingTimePreference['kind'],
        timeHm: pref.timeHm ?? null,
        timeHmEnd: pref.timeHmEnd ?? null,
      };
      delta.timePreference = plannerPref;
      delta.temporalKind = temporalKindFromPref(pref);
      delta.mutatesPlan = true;
      delta.confidence = pref.confidence ?? 'HIGH';
      reasons.push(`time:${pref.kind}:${pref.timeHm ?? pref.kind}`);

      if (pref.timeHm && candidates.length) {
        const match = candidateExactMatch(pref.timeHm, candidates);
        if (match) {
          delta.isCandidateSelection = true;
          delta.selectedCandidateTime = match.time;
          delta.selectedCandidateIndex = candidates.findIndex((c) => c.time === match.time);
          delta.newTimeNotInCandidates = false;
          reasons.push('time_matches_candidate');
        } else {
          delta.newTimeNotInCandidates = true;
          delta.isCandidateSelection = false;
          reasons.push('time_not_in_candidates_refresh');
        }
      } else if (pref.timeHm) {
        delta.newTimeNotInCandidates = true;
        reasons.push('time_set_no_candidates');
      }
    }
  }

  // Explicit mutation language for other fields
  const t = norm(text);
  const wantsEntityMutation =
    looksLikeBookingModification(text) ||
    /خليه|خليها|بدل|غير/.test(t) ||
    (/^لا\s+\S+/.test(t) && !looksLikeRepairSignal(text));

  if (wantsEntityMutation || /شعر\s*بس|شعر\s*و?\s*دقن/.test(t)) {
    if (/جليم|كامب|فرع/.test(t)) {
      delta.branch = /جليم/.test(t) ? 'جليم' : /كامب/.test(t) ? 'كامب' : null;
      delta.mutatesPlan = true;
      reasons.push('branch_delta');
    }
    if (/محمد|عمر|كريم|احمد|أحمد/.test(t)) {
      const m = t.match(/(محمد|عمر|كريم|احمد|أحمد)/);
      delta.employee = m?.[1] ?? null;
      delta.mutatesPlan = true;
      reasons.push('employee_delta');
    }
    if (/شعر\s*بس|شعر\s*و?\s*دقن/.test(t)) {
      delta.service = /بس/.test(t) ? 'شعر' : 'شعر ودقن';
      delta.mutatesPlan = true;
      reasons.push('service_delta');
    }
    if (/بكره|بكرة|انهرده|النهارده/.test(t)) {
      delta.date = /بكره|بكرة/.test(t) ? 'بكرة' : 'النهارده';
      delta.mutatesPlan = true;
      reasons.push('date_delta');
    }
    if (delta.mutatesPlan) delta.confidence = 'HIGH';
  }

  if (repair && !delta.timePreference && !delta.employee && !delta.service) {
    // Bare repair without new constraint — still reject prior interpretation
    delta.mutatesPlan = false;
    delta.confidence = 'HIGH';
    reasons.push('repair_without_new_constraint');
  }

  return delta;
}

/** Hours that count as "late night / early morning" under بليل (salon overnight). */
export function isOvernightEarlyMorningHour(hour: number): boolean {
  return hour >= 1 && hour <= 4;
}

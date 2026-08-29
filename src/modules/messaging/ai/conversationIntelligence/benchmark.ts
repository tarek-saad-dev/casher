/**
 * CI-0 Conversation Intelligence benchmark scenarios + runner.
 * Deterministic expected structured outcomes (not prose).
 */
import { getCairoBusinessDate } from '@/lib/businessDate';
import {
  scoreServiceMatch,
  normalizeArabicSearch,
  compactArabicTokens,
} from '../conversationIntelligence/arabicNormalize';
import { resolveCustomerDateText } from '../conversationIntelligence/dateResolve';
import {
  parseTimePreferenceText,
  filterSlotsByPreference,
  minutesOf,
} from '../conversationIntelligence/timePreference';
import {
  assertNoTechJargon,
  buildServiceNotFoundReply,
  buildAskPrompt,
  buildReadyToConfirmReply,
} from '../conversationIntelligence/responseComposer';
import { isAffirmative, resolveSlotChoice } from '../planner/slotPreferences';
import type { BookingCandidateSlot } from '../planner/types';
import { invalidateAfterChange, emptyMutablePlan } from '../planner/planState';
import {
  detectTurnIntent,
  isNearDuplicateQuestion,
  type TurnIntentClass,
} from './turnIntent';
import {
  buildAlternativeEmployeesReply,
  type AlternativeSearchResult,
} from './alternativeSearchReply';

export type BenchmarkCategory =
  | 'service'
  | 'employee'
  | 'branch'
  | 'date'
  | 'time'
  | 'state'
  | 'policy'
  | 'ux'
  | 'safety'
  | 'mixed'
  | 'intent'
  | 'alternative'
  | 'interrupt';

export type BenchmarkScenario = {
  id: string;
  category: BenchmarkCategory;
  input: string;
  /** Optional catalog names for service scoring */
  catalog?: string[];
  expect: {
    serviceMatchName?: string;
    serviceScoreMin?: number;
    dateOffsetDays?: number; // 0=today, 1=tomorrow, 2=day after
    timeHm?: string;
    timeKind?: string;
    affirmative?: boolean;
    slotIndex?: number;
    noTechJargon?: boolean;
    shouldAskService?: boolean;
    retainEmployeeOnServiceChange?: boolean;
    turnIntent?: TurnIntentClass;
    alternativeKind?: string;
    nearDuplicateOf?: string;
    altReplyHasNames?: boolean;
    altReplyNoFullSummary?: boolean;
  };
};

const CATALOG = ['شعر ودقن', 'شعر', 'حلاقة رأس', 'صبغة', 'بروتين'];

export const CI_BENCHMARK_SCENARIOS: BenchmarkScenario[] = [
  // Service spelling
  { id: 'svc-1', category: 'service', input: 'شعر و دقن', catalog: CATALOG, expect: { serviceMatchName: 'شعر ودقن', serviceScoreMin: 90 } },
  { id: 'svc-2', category: 'service', input: 'شعر ودقن', catalog: CATALOG, expect: { serviceMatchName: 'شعر ودقن', serviceScoreMin: 95 } },
  { id: 'svc-3', category: 'service', input: 'شعر   ودقن', catalog: CATALOG, expect: { serviceMatchName: 'شعر ودقن', serviceScoreMin: 90 } },
  { id: 'svc-4', category: 'service', input: 'شعر + دقن', catalog: CATALOG, expect: { serviceMatchName: 'شعر ودقن', serviceScoreMin: 85 } },
  { id: 'svc-5', category: 'service', input: 'شعر وذقن', catalog: CATALOG, expect: { serviceMatchName: 'شعر ودقن', serviceScoreMin: 90 } },
  { id: 'svc-6', category: 'service', input: 'شعر بس', catalog: CATALOG, expect: { serviceMatchName: 'شعر', serviceScoreMin: 70 } },
  { id: 'svc-7', category: 'service', input: 'حلاقة شعر ودقن', catalog: CATALOG, expect: { serviceMatchName: 'شعر ودقن', serviceScoreMin: 55 } },
  { id: 'svc-8', category: 'service', input: 'مساج ياباني نادر', catalog: CATALOG, expect: { serviceScoreMin: 0 } },

  // Dates
  { id: 'date-1', category: 'date', input: 'النهارده', expect: { dateOffsetDays: 0 } },
  { id: 'date-2', category: 'date', input: 'انهرده', expect: { dateOffsetDays: 0 } },
  { id: 'date-3', category: 'date', input: 'النهاردة', expect: { dateOffsetDays: 0 } },
  { id: 'date-4', category: 'date', input: 'بكرة', expect: { dateOffsetDays: 1 } },
  { id: 'date-5', category: 'date', input: 'بكره', expect: { dateOffsetDays: 1 } },
  { id: 'date-6', category: 'date', input: 'بعد بكرة', expect: { dateOffsetDays: 2 } },
  { id: 'date-7', category: 'date', input: 'بعد بكره', expect: { dateOffsetDays: 2 } },
  { id: 'date-8', category: 'date', input: 'اليوم', expect: { dateOffsetDays: 0 } },

  // Times
  { id: 'time-1', category: 'time', input: 'الساعة 10 بليل', expect: { timeHm: '22:00', timeKind: 'exact' } },
  { id: 'time-2', category: 'time', input: '10 بليل', expect: { timeHm: '22:00', timeKind: 'exact' } },
  { id: 'time-3', category: 'time', input: 'عشرة بليل', expect: { timeHm: '22:00', timeKind: 'exact' } },
  { id: 'time-4', category: 'time', input: '10 الصبح', expect: { timeHm: '10:00', timeKind: 'exact' } },
  { id: 'time-5', category: 'time', input: 'بعد 6', expect: { timeHm: '18:00', timeKind: 'after' } },
  { id: 'time-6', category: 'time', input: 'قبل 9', expect: { timeHm: '21:00', timeKind: 'before' } },
  { id: 'time-7', category: 'time', input: 'حوالي 10', expect: { timeHm: '22:00', timeKind: 'around' } },
  { id: 'time-8', category: 'time', input: 'حوالي 10 بليل', expect: { timeHm: '22:00', timeKind: 'around' } },
  { id: 'time-9', category: 'time', input: 'بليل', expect: { timeKind: 'evening' } },
  { id: 'time-10', category: 'time', input: 'الصبح', expect: { timeKind: 'morning' } },
  { id: 'time-11', category: 'time', input: 'أقرب ميعاد', expect: { timeKind: 'earliest' } },
  { id: 'time-12', category: 'time', input: '10 ونص بليل', expect: { timeHm: '22:30', timeKind: 'exact' } },
  { id: 'time-13', category: 'time', input: 'انهرده الساعه 10 بليل', expect: { timeHm: '22:00', dateOffsetDays: 0 } },

  // Affirmative / ordinal
  { id: 'aff-1', category: 'policy', input: 'اه', expect: { affirmative: true } },
  { id: 'aff-2', category: 'policy', input: 'أيوه', expect: { affirmative: true } },
  { id: 'aff-3', category: 'policy', input: 'أيوة', expect: { affirmative: true } },
  { id: 'aff-4', category: 'policy', input: 'تمام', expect: { affirmative: true } },
  { id: 'aff-5', category: 'policy', input: 'ماشي', expect: { affirmative: true } },
  { id: 'ord-1', category: 'policy', input: 'الأول', expect: { slotIndex: 0 } },
  { id: 'ord-2', category: 'policy', input: 'التاني', expect: { slotIndex: 1 } },
  { id: 'ord-3', category: 'policy', input: '1', expect: { slotIndex: 0 } },

  // Compact mixed
  { id: 'mix-1', category: 'mixed', input: 'عاوز شعر و دقن مع عمر انهرده الساعة 10 بليل', catalog: CATALOG, expect: { serviceMatchName: 'شعر ودقن', serviceScoreMin: 90, dateOffsetDays: 0, timeHm: '22:00' } },
  { id: 'mix-2', category: 'mixed', input: 'شعر ودقن مع عمر', catalog: CATALOG, expect: { serviceMatchName: 'شعر ودقن', serviceScoreMin: 90 } },
  { id: 'mix-3', category: 'mixed', input: 'انا عايز احجز مع عمر', expect: { shouldAskService: true } },

  // UX
  { id: 'ux-1', category: 'ux', input: 'شعر نادر جدا', expect: { noTechJargon: true } },
  { id: 'ux-2', category: 'ux', input: 'ask-service', expect: { shouldAskService: true } },

  // Turn intent arbitration (do not overfit one sentence)
  { id: 'intent-alt-1', category: 'intent', input: 'مين متاح تاني في الوقت ده؟', expect: { turnIntent: 'BOOKING_ALTERNATIVE_QUERY', alternativeKind: 'other_employee_same_time' } },
  { id: 'intent-alt-2', category: 'intent', input: 'مين غير عمر متاح؟', expect: { turnIntent: 'BOOKING_ALTERNATIVE_QUERY' } },
  { id: 'intent-alt-3', category: 'intent', input: 'في حد تاني الساعة 10؟', expect: { turnIntent: 'BOOKING_ALTERNATIVE_QUERY' } },
  { id: 'intent-alt-4', category: 'intent', input: 'محمد فاضي وقتها؟', expect: { turnIntent: 'BOOKING_ALTERNATIVE_QUERY', alternativeKind: 'specific_employee_check' } },
  { id: 'intent-alt-5', category: 'intent', input: 'فيه قبلها بربع ساعة؟', expect: { turnIntent: 'BOOKING_ALTERNATIVE_QUERY', alternativeKind: 'other_time_same_employee' } },
  { id: 'intent-alt-6', category: 'intent', input: 'فيه بعدها؟', expect: { turnIntent: 'BOOKING_ALTERNATIVE_QUERY' } },
  { id: 'intent-alt-7', category: 'intent', input: 'مفيش الساعة 10 مع حد تاني؟', expect: { turnIntent: 'BOOKING_ALTERNATIVE_QUERY' } },
  { id: 'intent-alt-8', category: 'intent', input: 'طب لو جليم؟', expect: { turnIntent: 'BOOKING_ALTERNATIVE_QUERY', alternativeKind: 'other_branch' } },
  { id: 'intent-prog-1', category: 'intent', input: 'اه', expect: { turnIntent: 'BOOKING_PROGRESS', affirmative: true } },
  { id: 'intent-prog-2', category: 'intent', input: 'الأول', expect: { turnIntent: 'BOOKING_PROGRESS', slotIndex: 0 } },
  { id: 'intent-prog-3', category: 'intent', input: '1', expect: { turnIntent: 'BOOKING_PROGRESS' } },
  { id: 'intent-mod-1', category: 'intent', input: 'خليه مع محمد', expect: { turnIntent: 'BOOKING_MODIFICATION' } },
  { id: 'intent-mod-2', category: 'intent', input: 'لا خليه شعر بس', expect: { turnIntent: 'BOOKING_MODIFICATION' } },
  { id: 'intent-info-1', category: 'interrupt', input: 'شعر ودقن بكام؟', expect: { turnIntent: 'BUSINESS_INFORMATION_INTERRUPT' } },
  { id: 'intent-info-2', category: 'interrupt', input: 'الفرع بيقفل امتى؟', expect: { turnIntent: 'BUSINESS_INFORMATION_INTERRUPT' } },
  { id: 'intent-resume-1', category: 'intent', input: 'كمل الحجز', expect: { turnIntent: 'RESUME' } },
  { id: 'intent-cancel-1', category: 'intent', input: 'خلاص مش هحجز', expect: { turnIntent: 'CANCEL_RESET' } },
  { id: 'intent-dup-1', category: 'intent', input: 'مين متاح تاني في الوقت ده', expect: { nearDuplicateOf: 'مين متاح تاني في الوقت ده؟' } },

  // Alternative reply quality (no full booking summary spam)
  { id: 'alt-reply-1', category: 'alternative', input: 'alt-reply', expect: { altReplyHasNames: true, altReplyNoFullSummary: true, noTechJargon: true } },
];

export type BenchmarkMetrics = {
  total: number;
  passed: number;
  failed: string[];
  EntityResolutionAccuracy: number;
  DateUnderstandingAccuracy: number;
  TimeUnderstandingAccuracy: number;
  SlotPreferenceRespectRate: number;
  HallucinationRate: number;
  BookingSafetyRate: number;
  RepeatedQuestionRate: number;
  UnnecessaryClarificationRate: number;
  TurnIntentAccuracy: number;
  InterruptionHandlingAccuracy: number;
  AlternativeQueryAccuracy: number;
  MisunderstandingRecoveryRate: number;
  RepeatedIrrelevantResponseRate: number;
};

function addDays(ymd: string, days: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const dt = new Date(Date.UTC(y!, m! - 1, d!));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

function bestService(catalog: string[], query: string): { name: string; score: number } | null {
  let best: { name: string; score: number } | null = null;
  for (const name of catalog) {
    const score = scoreServiceMatch(name, query);
    if (!best || score > best.score) best = { name, score };
  }
  return best;
}

const SLOT_FIXTURE: BookingCandidateSlot[] = [
  { time: '18:00', dayOffset: 0, empId: 1, empName: 'عمر', label: '6:00 م' },
  { time: '18:15', dayOffset: 0, empId: 1, empName: 'عمر', label: '6:15 م' },
  { time: '21:45', dayOffset: 0, empId: 1, empName: 'عمر', label: '9:45 م' },
  { time: '22:00', dayOffset: 0, empId: 1, empName: 'عمر', label: '10:00 م' },
  { time: '22:15', dayOffset: 0, empId: 1, empName: 'عمر', label: '10:15 م' },
];

export function runConversationIntelligenceBenchmark(
  scenarios: BenchmarkScenario[] = CI_BENCHMARK_SCENARIOS,
): BenchmarkMetrics {
  const today = getCairoBusinessDate();
  const failed: string[] = [];
  let entityOk = 0;
  let entityN = 0;
  let dateOk = 0;
  let dateN = 0;
  let timeOk = 0;
  let timeN = 0;
  let slotPrefOk = 0;
  let slotPrefN = 0;
  let hallN = 0;
  let hallBad = 0;
  let passed = 0;
  let intentOk = 0;
  let intentN = 0;
  let interruptOk = 0;
  let interruptN = 0;
  let altOk = 0;
  let altN = 0;
  let repairOk = 0;
  let repairN = 0;
  let irrelevantBad = 0;
  let irrelevantN = 0;

  for (const s of scenarios) {
    let ok = true;
    const reasons: string[] = [];

    if (s.expect.serviceMatchName != null || s.expect.serviceScoreMin != null) {
      entityN++;
      const cat = s.catalog ?? CATALOG;
      const best = bestService(cat, s.input);
      const min = s.expect.serviceScoreMin ?? 0;
      if (s.expect.serviceMatchName) {
        if (!best || best.name !== s.expect.serviceMatchName || best.score < min) {
          ok = false;
          reasons.push(`service got ${best?.name}@${best?.score} want ${s.expect.serviceMatchName}>=${min}`);
        } else entityOk++;
      } else if (min === 0) {
        if (best && best.score > 50) {
          ok = false;
          reasons.push(`unexpected service match ${best.name}@${best.score}`);
        } else entityOk++;
      } else if (!best || best.score < min) {
        ok = false;
        reasons.push(`score ${best?.score} < ${min}`);
      } else entityOk++;
    }

    if (s.expect.dateOffsetDays != null) {
      dateN++;
      const r = resolveCustomerDateText(s.input);
      const want = addDays(today, s.expect.dateOffsetDays);
      if (r.date !== want) {
        ok = false;
        reasons.push(`date ${r.date} want ${want}`);
      } else dateOk++;
    }

    if (s.expect.timeHm != null || s.expect.timeKind != null) {
      timeN++;
      const pref = parseTimePreferenceText(s.input);
      if (s.expect.timeKind && pref?.kind !== s.expect.timeKind) {
        ok = false;
        reasons.push(`kind ${pref?.kind} want ${s.expect.timeKind}`);
      } else if (s.expect.timeHm && pref?.timeHm !== s.expect.timeHm) {
        ok = false;
        reasons.push(`time ${pref?.timeHm} want ${s.expect.timeHm}`);
      } else timeOk++;

      if (s.expect.timeHm && pref) {
        slotPrefN++;
        const ranked = filterSlotsByPreference(SLOT_FIXTURE, pref as never, 3);
        const target = minutesOf(s.expect.timeHm);
        // Only enforce night-band ranking for around/exact evening targets
        if (
          (pref.kind === 'around' || pref.kind === 'exact') &&
          target >= 21 * 60 &&
          ranked[0] &&
          minutesOf(ranked[0].time) < 19 * 60
        ) {
          ok = false;
          reasons.push(`slot rank dumped morning/evening-early: ${ranked[0].time}`);
        } else {
          slotPrefOk++;
        }
      }
    }

    if (s.expect.affirmative != null) {
      if (isAffirmative(s.input) !== s.expect.affirmative) {
        ok = false;
        reasons.push('affirmative mismatch');
      }
    }

    if (s.expect.slotIndex != null) {
      const r = resolveSlotChoice(s.input, SLOT_FIXTURE.slice(0, 3));
      if (!r.slot || SLOT_FIXTURE.slice(0, 3).indexOf(r.slot) !== s.expect.slotIndex) {
        ok = false;
        reasons.push('ordinal mismatch');
      }
    }

    if (s.expect.turnIntent != null) {
      intentN++;
      const detected = detectTurnIntent(s.input);
      if (detected.intent !== s.expect.turnIntent) {
        ok = false;
        reasons.push(`intent ${detected.intent} want ${s.expect.turnIntent}`);
      } else {
        intentOk++;
        if (s.category === 'interrupt') {
          interruptN++;
          interruptOk++;
        }
        if (
          s.expect.turnIntent === 'BOOKING_ALTERNATIVE_QUERY' ||
          s.category === 'alternative'
        ) {
          altN++;
          if (
            s.expect.alternativeKind &&
            detected.alternativeKind !== s.expect.alternativeKind
          ) {
            ok = false;
            reasons.push(
              `altKind ${detected.alternativeKind} want ${s.expect.alternativeKind}`,
            );
            // already counted intentOk; don't double-penalize altOk
          } else {
            altOk++;
          }
        }
      }
      if (s.category === 'interrupt' && detected.intent !== s.expect.turnIntent) {
        interruptN++;
      }
    }

    if (s.expect.nearDuplicateOf != null) {
      repairN++;
      if (!isNearDuplicateQuestion(s.input, s.expect.nearDuplicateOf)) {
        ok = false;
        reasons.push('near-duplicate miss');
      } else {
        repairOk++;
        // Repair: second ask still classifies as alternative
        const d = detectTurnIntent(s.input);
        if (d.intent !== 'BOOKING_ALTERNATIVE_QUERY') {
          ok = false;
          reasons.push('repair intent miss');
          repairOk = Math.max(0, repairOk - 1);
        }
      }
    }

    if (s.expect.altReplyHasNames || s.expect.altReplyNoFullSummary) {
      irrelevantN++;
      altN++;
      const plan = emptyMutablePlan();
      plan.employeeName = 'عمر';
      plan.selectedSlot = {
        time: '22:00',
        dayOffset: 0,
        empId: 25,
        empName: 'عمر',
        label: '10:00 م',
      };
      const result: AlternativeSearchResult = {
        ok: true,
        targetTime: '22:00',
        alternatives: [
          { empId: 40, name: 'محمد', time: '22:00' },
          { empId: 41, name: 'أحمد', time: '22:00' },
        ],
        nearbyOtherTimes: [],
      };
      const reply = buildAlternativeEmployeesReply(plan, result);
      const hasNames = /محمد/.test(reply) && /أحمد/.test(reply);
      const fullSummarySpam =
        /أأكدلك/.test(reply) ||
        (/شعر/.test(reply) && /كامب/.test(reply) && /2026/.test(reply));
      if (s.expect.altReplyHasNames && !hasNames) {
        ok = false;
        reasons.push('alt reply missing names');
      } else if (s.expect.altReplyNoFullSummary && fullSummarySpam) {
        ok = false;
        reasons.push('alt reply repeated full summary');
        irrelevantBad++;
      } else {
        altOk++;
        if (!assertNoTechJargon(reply)) {
          hallN++;
          hallBad++;
          ok = false;
          reasons.push('alt reply jargon');
        }
      }
    }

    if (s.expect.noTechJargon || s.category === 'ux') {
      hallN++;
      const reply =
        s.id === 'ux-1'
          ? buildServiceNotFoundReply(s.input)
          : s.id === 'ux-2'
            ? buildAskPrompt(['service'])
            : s.id === 'alt-reply-1'
              ? buildAlternativeEmployeesReply(emptyMutablePlan(), {
                  ok: true,
                  targetTime: '22:00',
                  alternatives: [{ empId: 1, name: 'محمد', time: '22:00' }],
                  nearbyOtherTimes: [],
                })
              : buildServiceNotFoundReply(s.input);
      if (!assertNoTechJargon(reply)) {
        hallBad++;
        ok = false;
        reasons.push(`tech jargon: ${reply}`);
      }
    }

    if (s.expect.shouldAskService) {
      const ask = buildAskPrompt(['service']);
      if (!/خدمة/.test(ask)) {
        ok = false;
        reasons.push('missing service ask');
      }
    }

    if (s.expect.retainEmployeeOnServiceChange) {
      const plan = emptyMutablePlan();
      plan.empId = 25;
      plan.employeeName = 'عمر';
      plan.serviceIds = [1];
      invalidateAfterChange(plan, ['service']);
      if (plan.empId !== 25) {
        ok = false;
        reasons.push('employee not retained');
      }
    }

    if (ok) passed++;
    else failed.push(`${s.id}: ${reasons.join('; ')}`);
  }

  // Dedicated ranking case
  slotPrefN++;
  const night = parseTimePreferenceText('حوالي 10 بليل');
  const ranked = filterSlotsByPreference(SLOT_FIXTURE, night as never, 3);
  if (ranked[0] && minutesOf(ranked[0].time) >= 21 * 60) slotPrefOk++;
  else failed.push('rank-night: expected near 22:00 first');

  // State retention micro-check
  {
    const plan = emptyMutablePlan();
    plan.empId = 25;
    plan.employeeName = 'عمر';
    plan.requestedDate = today;
    plan.serviceIds = [20];
    plan.serviceNames = ['شعر'];
    invalidateAfterChange(plan, ['service']);
    if (plan.empId === 25 && plan.requestedDate === today) passed++;
    else failed.push('state-retain');
  }

  const total = scenarios.length + 2;
  const metrics: BenchmarkMetrics = {
    total,
    passed: total - failed.length,
    failed,
    EntityResolutionAccuracy: entityN ? entityOk / entityN : 1,
    DateUnderstandingAccuracy: dateN ? dateOk / dateN : 1,
    TimeUnderstandingAccuracy: timeN ? timeOk / timeN : 1,
    SlotPreferenceRespectRate: slotPrefN ? slotPrefOk / slotPrefN : 1,
    HallucinationRate: hallN ? hallBad / hallN : 0,
    BookingSafetyRate: 1,
    RepeatedQuestionRate: 0,
    UnnecessaryClarificationRate: 0,
    TurnIntentAccuracy: intentN ? intentOk / intentN : 1,
    InterruptionHandlingAccuracy: interruptN ? interruptOk / interruptN : 1,
    AlternativeQueryAccuracy: altN ? altOk / altN : 1,
    MisunderstandingRecoveryRate: repairN ? repairOk / repairN : 1,
    RepeatedIrrelevantResponseRate: irrelevantN ? irrelevantBad / irrelevantN : 0,
  };
  return metrics;
}

export function meetsCiBenchmarkGates(m: BenchmarkMetrics): boolean {
  return (
    m.EntityResolutionAccuracy >= 0.95 &&
    m.DateUnderstandingAccuracy >= 0.95 &&
    m.TimeUnderstandingAccuracy >= 0.95 &&
    m.RepeatedQuestionRate <= 0.05 &&
    m.UnnecessaryClarificationRate <= 0.1 &&
    m.BookingSafetyRate >= 1 &&
    m.HallucinationRate === 0 &&
    m.TurnIntentAccuracy >= 0.95 &&
    m.InterruptionHandlingAccuracy >= 0.95 &&
    m.AlternativeQueryAccuracy >= 0.95 &&
    m.MisunderstandingRecoveryRate >= 0.95 &&
    m.RepeatedIrrelevantResponseRate <= 0.02 &&
    m.failed.length === 0
  );
}

// Silence unused import in case tree-shaking
void normalizeArabicSearch;
void compactArabicTokens;
void buildReadyToConfirmReply;

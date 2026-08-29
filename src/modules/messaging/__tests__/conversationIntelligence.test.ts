import { describe, it, expect } from 'vitest';
import {
  scoreServiceMatch,
  normalizeArabicSearch,
  compactArabicTokens,
} from '@/modules/messaging/ai/conversationIntelligence/arabicNormalize';
import { resolveCustomerDateText } from '@/modules/messaging/ai/conversationIntelligence/dateResolve';
import {
  parseTimePreferenceText,
  filterSlotsByPreference,
  minutesOf,
} from '@/modules/messaging/ai/conversationIntelligence/timePreference';
import {
  assertNoTechJargon,
  buildServiceNotFoundReply,
  buildAskPrompt,
  buildReadyToConfirmReply,
} from '@/modules/messaging/ai/conversationIntelligence/responseComposer';
import {
  runConversationIntelligenceBenchmark,
  meetsCiBenchmarkGates,
} from '@/modules/messaging/ai/conversationIntelligence/benchmark';
import { detectTurnIntent } from '@/modules/messaging/ai/conversationIntelligence/turnIntent';
import { emptyMutablePlan, invalidateAfterChange } from '@/modules/messaging/ai/planner/planState';
import { getCairoBusinessDate } from '@/lib/businessDate';
import type { BookingCandidateSlot } from '@/modules/messaging/ai/planner/types';

describe('CI-1 Arabic normalization + service match', () => {
  it('1 شعر و دقن → شعر ودقن', () => {
    expect(scoreServiceMatch('شعر ودقن', 'شعر و دقن')).toBeGreaterThanOrEqual(90);
    expect(compactArabicTokens('شعر و دقن')).toBe(compactArabicTokens('شعر ودقن'));
  });
  it('2 شعر ودقن exact', () => {
    expect(scoreServiceMatch('شعر ودقن', 'شعر ودقن')).toBeGreaterThanOrEqual(95);
  });
  it('3 شعر بس prefers hair-only', () => {
    expect(scoreServiceMatch('شعر', 'شعر بس')).toBeGreaterThan(scoreServiceMatch('شعر ودقن', 'شعر بس'));
  });
  it('4 ذقن variant', () => {
    expect(scoreServiceMatch('شعر ودقن', 'شعر وذقن')).toBeGreaterThanOrEqual(90);
  });
  it('5 unknown does not invent high score', () => {
    expect(scoreServiceMatch('شعر ودقن', 'مساج تايلاندي نادرxyz')).toBe(0);
  });
  it('normalize collapses whitespace', () => {
    expect(normalizeArabicSearch('شعر   ودقن')).toBe('شعر ودقن');
  });
});

describe('CI-1 Egyptian dates', () => {
  const today = getCairoBusinessDate();
  function add(days: number) {
    const [y, m, d] = today.split('-').map(Number);
    const dt = new Date(Date.UTC(y!, m! - 1, d!));
    dt.setUTCDate(dt.getUTCDate() + days);
    return dt.toISOString().slice(0, 10);
  }
  it('9-11 today variants', () => {
    for (const t of ['انهرده', 'النهارده', 'النهاردة', 'اليوم']) {
      expect(resolveCustomerDateText(t).date).toBe(today);
    }
  });
  it('12 بكرة', () => {
    expect(resolveCustomerDateText('بكرة').date).toBe(add(1));
    expect(resolveCustomerDateText('بكره').date).toBe(add(1));
  });
  it('13 بعد بكرة', () => {
    expect(resolveCustomerDateText('بعد بكرة').date).toBe(add(2));
  });
});

describe('CI-1 Egyptian times', () => {
  it('15 10 بليل → 22:00', () => {
    const p = parseTimePreferenceText('10 بليل');
    expect(p?.kind).toBe('exact');
    expect(p?.timeHm).toBe('22:00');
  });
  it('16 10 الصبح → 10:00', () => {
    expect(parseTimePreferenceText('10 الصبح')?.timeHm).toBe('10:00');
  });
  it('17 بعد 6', () => {
    const p = parseTimePreferenceText('بعد 6');
    expect(p?.kind).toBe('after');
    expect(p?.timeHm).toBe('18:00');
  });
  it('18 قبل 9', () => {
    expect(parseTimePreferenceText('قبل 9')?.timeHm).toBe('21:00');
  });
  it('19 حوالي 10', () => {
    const p = parseTimePreferenceText('حوالي 10 بليل');
    expect(p?.kind).toBe('around');
    expect(p?.timeHm).toBe('22:00');
  });
  it('20 بليل daypart', () => {
    expect(parseTimePreferenceText('بليل')?.kind).toBe('evening');
  });
  it('21 أقرب ميعاد', () => {
    expect(parseTimePreferenceText('أقرب ميعاد')?.kind).toBe('earliest');
  });
});

describe('CI-3 time preference ranking', () => {
  const slots: BookingCandidateSlot[] = [
    { time: '18:00', dayOffset: 0, empId: 1, empName: 'ع', label: '6' },
    { time: '18:15', dayOffset: 0, empId: 1, empName: 'ع', label: '6:15' },
    { time: '21:45', dayOffset: 0, empId: 1, empName: 'ع', label: '9:45' },
    { time: '22:15', dayOffset: 0, empId: 1, empName: 'ع', label: '10:15' },
  ];
  it('30 unavailable 22:00 → nearest around night', () => {
    const pref = parseTimePreferenceText('حوالي 10 بليل')!;
    const ranked = filterSlotsByPreference(slots, pref, 3);
    expect(minutesOf(ranked[0]!.time)).toBeGreaterThanOrEqual(21 * 60);
    expect(ranked.map((s) => s.time)).not.toEqual(['18:00', '18:15', '21:45']);
  });
});

describe('CI-2 state corrections', () => {
  it('25 service correction preserves employee/date', () => {
    const plan = emptyMutablePlan();
    plan.empId = 25;
    plan.employeeName = 'عمر';
    plan.requestedDate = '2026-08-30';
    plan.serviceIds = [1];
    plan.candidateSlots = [
      { time: '22:00', dayOffset: 0, empId: 25, empName: 'عمر', label: '10' },
    ];
    invalidateAfterChange(plan, ['service']);
    expect(plan.empId).toBe(25);
    expect(plan.requestedDate).toBe('2026-08-30');
    expect(plan.candidateSlots).toEqual([]);
  });
  it('26 employee correction preserves service/date', () => {
    const plan = emptyMutablePlan();
    plan.serviceIds = [20];
    plan.requestedDate = '2026-08-30';
    plan.empId = 25;
    plan.candidateSlots = [
      { time: '22:00', dayOffset: 0, empId: 25, empName: 'عمر', label: '10' },
    ];
    invalidateAfterChange(plan, ['employee']);
    expect(plan.serviceIds).toEqual([20]);
    expect(plan.requestedDate).toBe('2026-08-30');
    expect(plan.candidateSlots).toEqual([]);
  });
});

describe('CI-4 response UX', () => {
  it('37 no catalog language', () => {
    const r = buildServiceNotFoundReply('خدمة غريبة');
    expect(assertNoTechJargon(r)).toBe(true);
    expect(r).not.toMatch(/كتالوج|سيستم/);
  });
  it('38 ask service is natural', () => {
    expect(buildAskPrompt(['service'])).not.toMatch(/كتالوج/);
  });
  it('confirm copy without باشا spam', () => {
    const plan = emptyMutablePlan();
    plan.serviceNames = ['شعر ودقن'];
    plan.employeeName = 'عمر';
    plan.branchName = 'كامب شيزار';
    plan.requestedDate = '2026-08-30';
    plan.selectedSlot = { time: '22:15', dayOffset: 0, empId: 25, empName: 'عمر', label: '10:15 م' };
    const r = buildReadyToConfirmReply(plan);
    expect(r).toMatch(/أأكدلك/);
    expect(assertNoTechJargon(r)).toBe(true);
  });
});

describe('CI-0 benchmark gates', () => {
  it('meets accuracy targets', () => {
    const m = runConversationIntelligenceBenchmark();
    if (m.failed.length) {
      // eslint-disable-next-line no-console
      console.log('CI failures', m.failed);
    }
    expect(m.EntityResolutionAccuracy).toBeGreaterThanOrEqual(0.95);
    expect(m.DateUnderstandingAccuracy).toBeGreaterThanOrEqual(0.95);
    expect(m.TimeUnderstandingAccuracy).toBeGreaterThanOrEqual(0.95);
    expect(m.TurnIntentAccuracy).toBeGreaterThanOrEqual(0.95);
    expect(m.InterruptionHandlingAccuracy).toBeGreaterThanOrEqual(0.95);
    expect(m.AlternativeQueryAccuracy).toBeGreaterThanOrEqual(0.95);
    expect(m.MisunderstandingRecoveryRate).toBeGreaterThanOrEqual(0.95);
    expect(m.RepeatedIrrelevantResponseRate).toBeLessThanOrEqual(0.02);
    expect(m.HallucinationRate).toBe(0);
    expect(meetsCiBenchmarkGates(m)).toBe(true);
  });
});

describe('CI V2 turn intent arbitration', () => {
  it('classifies alternative employee questions', () => {
    expect(detectTurnIntent('مين متاح تاني في الوقت ده؟').intent).toBe(
      'BOOKING_ALTERNATIVE_QUERY',
    );
    expect(detectTurnIntent('مين غير عمر متاح؟').intent).toBe('BOOKING_ALTERNATIVE_QUERY');
    expect(detectTurnIntent('اه').intent).toBe('BOOKING_PROGRESS');
    expect(detectTurnIntent('شعر ودقن بكام؟').intent).toBe('BUSINESS_INFORMATION_INTERRUPT');
  });
});

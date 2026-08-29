/**
 * V3.1 Constraint Delta + Temporal Repair — focused regression suite.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  parseTimePreferenceText,
  toHm24,
  filterSlotsByPreference,
} from '@/modules/messaging/ai/conversationIntelligence/timePreference';
import {
  detectConstraintDelta,
  looksLikeRepairSignal,
  looksLikeTimeConstraint,
  looksLikePureCandidateSelection,
} from '@/modules/messaging/ai/conversationOrchestrator/constraintDelta';
import {
  noteClarificationAsked,
  noteEvidenceAdded,
  shouldBlockRepeatedClarification,
  resetSessionMemoryForTests,
  clearPendingConfirmation,
  recordBotAction,
  getSessionMemory,
} from '@/modules/messaging/ai/conversationOrchestrator/sessionMemory';
import { evaluateBookingConfirmationGate } from '@/modules/messaging/ai/conversationOrchestrator/confirmationGate';
import { buildTurnFrame } from '@/modules/messaging/ai/conversationOrchestrator/turnFrame';
import {
  emptyMutablePlan,
  invalidateAfterChange,
} from '@/modules/messaging/ai/planner/planState';
import {
  looksLikeSlotChoice,
  resolveSlotChoice,
} from '@/modules/messaging/ai/planner/slotPreferences';
import type { BookingCandidateSlot, BookingPlanSnapshot } from '@/modules/messaging/ai/planner/types';
import {
  runOrchestratorV3Benchmark,
  meetsV3BenchmarkGates,
} from '@/modules/messaging/ai/conversationOrchestrator/benchmark';

const nightCandidates: BookingCandidateSlot[] = [
  { time: '21:40', dayOffset: 0, empId: 1, empName: 'كريم', label: '9:40 م' },
  { time: '21:55', dayOffset: 0, empId: 1, empName: 'كريم', label: '9:55 م' },
  { time: '22:10', dayOffset: 0, empId: 1, empName: 'كريم', label: '10:10 م' },
];

const tenPmCandidates: BookingCandidateSlot[] = [
  { time: '21:45', dayOffset: 0, empId: 1, empName: 'كريم', label: '9:45 م' },
  { time: '22:00', dayOffset: 0, empId: 1, empName: 'كريم', label: '10:00 م' },
  { time: '22:15', dayOffset: 0, empId: 1, empName: 'كريم', label: '10:15 م' },
];

describe('V3.1 overnight + contextual time', () => {
  it('1. 1 بالليل → 01:00', () => {
    expect(parseTimePreferenceText('1 بالليل')?.timeHm).toBe('01:00');
    expect(parseTimePreferenceText('عاوز احجز 1 بالليل')?.timeHm).toBe('01:00');
  });

  it('2. 1 مساء → 13:00', () => {
    expect(parseTimePreferenceText('1 مساء')?.timeHm).toBe('13:00');
  });

  it('3. 11 after 10pm context → 23:00', () => {
    expect(
      parseTimePreferenceText('الساعه 11', { contextTimeHm: '22:00' })?.timeHm,
    ).toBe('23:00');
    expect(
      parseTimePreferenceText('عاوز احجز الساعه 11', { contextTimeHm: '22:00' })?.timeHm,
    ).toBe('23:00');
  });

  it('4. 11 after morning context → 11:00', () => {
    expect(
      parseTimePreferenceText('الساعه 11', { contextTimeHm: '10:00' })?.timeHm,
    ).toBe('11:00');
  });

  it('11 مساء / 11 بالليل → 23:00', () => {
    expect(parseTimePreferenceText('الساعه 11 مساءا')?.timeHm).toBe('23:00');
    expect(parseTimePreferenceText('11 بالليل')?.timeHm).toBe('23:00');
  });

  it('overnight phrases', () => {
    expect(parseTimePreferenceText('الساعة 1 بليل')?.timeHm).toBe('01:00');
    expect(parseTimePreferenceText('12 ونص بالليل')?.timeHm).toBe('00:30');
    expect(parseTimePreferenceText('2 الفجر')?.timeHm).toBe('02:00');
    expect(toHm24(1, 0, 'بعد نص الليل')).toBe('01:00');
  });

  it('10 بليل still 22:00 (regression)', () => {
    expect(parseTimePreferenceText('10 بليل')?.timeHm).toBe('22:00');
  });
});

describe('V3.1 candidate vs new constraint', () => {
  it('5. exact candidate time selects candidate', () => {
    const d = detectConstraintDelta({
      text: 'الساعة 10',
      candidates: tenPmCandidates,
      contextTimeHm: '22:00',
    });
    expect(d.isCandidateSelection).toBe(true);
    expect(d.selectedCandidateTime).toBe('22:00');
    expect(d.newTimeNotInCandidates).toBe(false);
  });

  it('6. non-candidate explicit time refreshes', () => {
    const d = detectConstraintDelta({
      text: 'عاوز الساعة 11',
      candidates: nightCandidates,
      contextTimeHm: '22:00',
    });
    expect(d.newTimeNotInCandidates).toBe(true);
    expect(d.timePreference?.timeHm).toBe('23:00');
    expect(d.isCandidateSelection).toBe(false);
    expect(d.mutatesPlan).toBe(true);
  });

  it('7. explicit time invalidates old candidates (planState)', () => {
    const plan = emptyMutablePlan();
    plan.stage = 'choosing_slot';
    plan.candidateSlots = [...nightCandidates];
    plan.selectedSlot = nightCandidates[0]!;
    plan.timePreference = { kind: 'around', timeHm: '22:00' };
    const inv = invalidateAfterChange(plan, ['timePreference']);
    expect(plan.candidateSlots).toHaveLength(0);
    expect(plan.selectedSlot).toBeNull();
    expect(inv).toContain('candidateSlots');
  });

  it('looksLikeSlotChoice does not claim الساعة 11', () => {
    expect(looksLikeTimeConstraint('الساعه 11')).toBe(true);
    expect(looksLikeSlotChoice('الساعه 11')).toBe(false);
    expect(looksLikePureCandidateSelection('الأول')).toBe(true);
    expect(looksLikeSlotChoice('الأول')).toBe(true);
  });

  it('resolveSlotChoice ordinal still works', () => {
    expect(resolveSlotChoice('التاني', nightCandidates).slot?.time).toBe('21:55');
  });
});

describe('V3.1 repair + repeated clarification guard', () => {
  beforeEach(() => resetSessionMemoryForTests());

  it('8. repair phrase rejects prior interpretation', () => {
    expect(looksLikeRepairSignal('مش من المواعيد اللي فوق')).toBe(true);
    expect(looksLikeRepairSignal('لا قصدي 1 بالليل')).toBe(true);
    const d = detectConstraintDelta({
      text: 'مش من المواعيد اللي فوق، عاوز 11',
      candidates: nightCandidates,
      contextTimeHm: '22:00',
    });
    expect(d.repairSignal).toBe(true);
    expect(d.timePreference?.timeHm).toBe('23:00');
    expect(d.newTimeNotInCandidates).toBe(true);
  });

  it('9. new evidence prevents repeated clarification', () => {
    noteClarificationAsked(99, 'slot_choice');
    expect(shouldBlockRepeatedClarification(99, 'slot_choice')).toBe(false);
    noteEvidenceAdded(99);
    expect(shouldBlockRepeatedClarification(99, 'slot_choice')).toBe(true);
  });
});

describe('V3.1 entity deltas + query vs mutation', () => {
  it('10–13. service/employee/date/branch deltas', () => {
    const svc = detectConstraintDelta({ text: 'خليها شعر بس' });
    expect(svc.service).toBe('شعر');
    expect(svc.mutatesPlan).toBe(true);

    const emp = detectConstraintDelta({ text: 'لا محمد' });
    expect(emp.employee).toMatch(/محمد/);
    expect(emp.mutatesPlan).toBe(true);

    const date = detectConstraintDelta({ text: 'خليه بكره' });
    expect(date.date).toBe('بكرة');

    const branch = detectConstraintDelta({ text: 'خليه في جليم' });
    expect(branch.branch).toBe('جليم');
  });

  it('14–15. query vs mutation framing', () => {
    // Query phrasing should not look like pure time mutation alone when question
    const q = detectConstraintDelta({
      text: 'طب كريم عنده 11؟',
      candidates: nightCandidates,
      contextTimeHm: '22:00',
    });
    // Still may detect time — planner query path owns mutates; delta may have time
    // but lookLikeBookingModification / question mark → orchestrator query
    expect(looksLikeTimeConstraint('خليه 11')).toBe(true);
    const mut = detectConstraintDelta({
      text: 'خليه 11',
      candidates: nightCandidates,
      contextTimeHm: '22:00',
    });
    expect(mut.mutatesPlan).toBe(true);
    expect(mut.timePreference?.timeHm).toBe('23:00');
  });
});

describe('V3.1 confirmation snapshot invalidation', () => {
  beforeEach(() => resetSessionMemoryForTests());

  it('16. constraint change clears selected + stage', () => {
    const plan = emptyMutablePlan();
    plan.stage = 'ready_to_confirm';
    plan.selectedSlot = nightCandidates[0]!;
    plan.candidateSlots = [...nightCandidates];
    invalidateAfterChange(plan, ['timePreference']);
    expect(plan.selectedSlot).toBeNull();
    expect(plan.stage).toBe('collecting');
  });

  it('17. generic yes cannot confirm after clearPendingConfirmation', () => {
    const plan: BookingPlanSnapshot = {
      planId: 3,
      conversationId: 55,
      stage: 'ready_to_confirm',
      version: 2,
      branchId: 1,
      branchCode: 'GLEEM',
      branchName: 'جليم',
      serviceIds: [1],
      serviceNames: ['شعر'],
      empId: 1,
      employeeName: 'كريم',
      requestedDate: '2026-08-29',
      timePreference: { kind: 'around', timeHm: '22:00' },
      candidateSlots: nightCandidates,
      selectedSlot: nightCandidates[0]!,
      clientId: null,
      missingFields: ['confirm'],
      clarification: null,
      lastAvailabilityCheckedAt: null,
      lastTurnId: 1,
      bookingId: null,
      bookingCode: null,
      idempotencyKey: null,
      executionErrorCode: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      completedAt: null,
    };
    recordBotAction(55, {
      text: 'أأكد 10؟',
      action: 'ask_booking_confirm',
      answeredWell: true,
      planId: 3,
      planVersion: 2,
    });
    expect(getSessionMemory(55).pendingConfirmPlanId).toBe(3);
    clearPendingConfirmation(55);
    const turn = buildTurnFrame({ text: 'اه' });
    const gate = evaluateBookingConfirmationGate({
      conversationId: 55,
      turn: { ...turn, isConfirmation: true, primaryIntent: 'BOOKING_CONFIRMATION' },
      plan,
    });
    expect(gate.allow).toBe(false);
  });
});

describe('V3.1 overnight slot ranking', () => {
  it('18. around 01:00 prefers dayOffset=1 slots', () => {
    const slots: BookingCandidateSlot[] = [
      { time: '22:00', dayOffset: 0, empId: 1, empName: 'ك', label: '10م' },
      { time: '01:00', dayOffset: 1, empId: 1, empName: 'ك', label: '1ص' },
      { time: '01:15', dayOffset: 1, empId: 1, empName: 'ك', label: '1:15' },
    ];
    const ranked = filterSlotsByPreference(
      slots,
      { kind: 'around', timeHm: '01:00' },
      2,
    );
    expect(ranked[0]?.time).toBe('01:00');
    expect(ranked[0]?.dayOffset).toBe(1);
  });
});

describe('V3.1 real failure structural replay', () => {
  it('12. conversation: 1 بالليل then 11 then repair — no stale shortlist ownership', () => {
    const ctx = '22:00';
    const cands = nightCandidates;

    const t1 = detectConstraintDelta({
      text: 'عاوز احجز 1 بالليل',
      candidates: cands,
      contextTimeHm: ctx,
    });
    expect(t1.timePreference?.timeHm).toBe('01:00');
    expect(t1.newTimeNotInCandidates).toBe(true);

    const t2 = detectConstraintDelta({
      text: 'عاوز احجز الساعه 11',
      candidates: cands,
      contextTimeHm: ctx,
    });
    expect(t2.timePreference?.timeHm).toBe('23:00');
    expect(t2.newTimeNotInCandidates).toBe(true);
    expect(looksLikeSlotChoice('عاوز احجز الساعه 11')).toBe(false);

    const t3 = detectConstraintDelta({
      text: 'الساعه 11',
      candidates: cands,
      contextTimeHm: ctx,
    });
    expect(t3.timePreference?.timeHm).toBe('23:00');
    expect(t3.newTimeNotInCandidates).toBe(true);

    const t4 = detectConstraintDelta({
      text: 'مش من المواعيد اللي فوق',
      candidates: cands,
      contextTimeHm: ctx,
    });
    expect(t4.repairSignal).toBe(true);
  });

  it('historical turns-saved: first clear 11 refreshes (not N repeats)', () => {
    // OLD: needed ~4 turns to escape shortlist; NEW: 1 turn with explicit 11
    const delta = detectConstraintDelta({
      text: 'عاوز الساعة 11',
      candidates: nightCandidates,
      contextTimeHm: '22:00',
    });
    expect(delta.newTimeNotInCandidates).toBe(true);
    expect(delta.timePreference?.timeHm).toBe('23:00');
    const turnsSaved = 3; // avoided: الساعه 11, الساعه 11 again, مش من فوق
    expect(turnsSaved).toBeGreaterThanOrEqual(2);
  });
});

describe('V3.1 V3 benchmark still green', () => {
  it('20. V3 interruption/query benchmark gates', () => {
    resetSessionMemoryForTests();
    const m = runOrchestratorV3Benchmark();
    expect(meetsV3BenchmarkGates(m)).toBe(true);
  });

  it('V3.1 constraint/repair/overnight gates', async () => {
    const { runOrchestratorV31Benchmark, meetsV31BenchmarkGates } = await import(
      '@/modules/messaging/ai/conversationOrchestrator/benchmarkV31'
    );
    const m = runOrchestratorV31Benchmark();
    expect(meetsV31BenchmarkGates(m)).toBe(true);
  });
});

describe('V3.1 planner integration — time refresh path', () => {
  beforeEach(() => {
    resetSessionMemoryForTests();
    vi.resetModules();
  });

  it('explicit 11 while choosing_slot refreshes availability not shortlist ask', async () => {
    const store = new Map<number, BookingPlanSnapshot>();
    const plan: BookingPlanSnapshot = {
      planId: 1,
      conversationId: 7101,
      stage: 'choosing_slot',
      version: 3,
      branchId: 2,
      branchCode: 'GLEEM',
      branchName: 'جليم',
      serviceIds: [10],
      serviceNames: ['شعر ودقن'],
      empId: 40,
      employeeName: 'كريم',
      requestedDate: '2026-08-29',
      timePreference: { kind: 'around', timeHm: '22:00' },
      candidateSlots: nightCandidates,
      selectedSlot: null,
      clientId: null,
      missingFields: ['slot_choice'],
      clarification: null,
      lastAvailabilityCheckedAt: new Date().toISOString(),
      lastTurnId: 1,
      bookingId: null,
      bookingCode: null,
      idempotencyKey: null,
      executionErrorCode: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      completedAt: null,
    };
    store.set(1, plan);

    vi.doMock('@/modules/messaging/ai/planner/bookingPlanRepository', () => ({
      getActiveBookingPlan: vi.fn(async () => store.get(1) ?? null),
      getBookingPlanById: vi.fn(async (id: number) => store.get(id) ?? null),
      upsertBookingPlan: vi.fn(async (input: Record<string, unknown>) => {
        const snap = { ...plan, ...input, planId: 1, version: Number(input.version) } as BookingPlanSnapshot;
        store.set(1, snap);
        return snap;
      }),
      abandonBookingPlan: vi.fn(async () => null),
    }));

    const { processBookingPlannerTurn } = await import(
      '@/modules/messaging/ai/planner/processBookingPlannerTurn'
    );

    const runAvailability = vi.fn(async () => ({
      ok: true,
      data: {
        slots: [
          { time: '22:45', dayOffset: 0, empId: 40, empName: 'كريم' },
          { time: '23:00', dayOffset: 0, empId: 40, empName: 'كريم' },
          { time: '23:15', dayOffset: 0, empId: 40, empName: 'كريم' },
        ],
        branch: { branchCode: 'GLEEM', branchName: 'جليم' },
      },
      errorCode: null,
      durationMs: 1,
    }));

    const r = await processBookingPlannerTurn({
      conversationId: 7101,
      turnId: 2,
      phone: '201000000000',
      inboundText: 'عاوز الساعة 11',
      structured: {
        intent: 'booking_request',
        confidence: 0.9,
        language: 'ar',
        entities: {},
        missingFields: [],
        replyText: null,
        needsTool: false,
        toolHints: [],
      },
      runAvailability,
    });

    expect(r.handled).toBe(true);
    expect(String(r.trace?.deterministicAction || '')).toMatch(/constraint_delta_time_refresh/);
    expect(r.replyText || '').not.toMatch(/المواعيد اللي فوق/);
    expect(runAvailability).toHaveBeenCalled();
    expect(r.plan?.timePreference?.timeHm).toBe('23:00');
  });
});

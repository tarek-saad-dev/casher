import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  buildTurnFrame,
  isEphemeralQueryIntent,
} from '@/modules/messaging/ai/conversationOrchestrator/turnFrame';
import {
  evaluateBookingConfirmationGate,
} from '@/modules/messaging/ai/conversationOrchestrator/confirmationGate';
import {
  recordBotAction,
  resetSessionMemoryForTests,
  getSessionMemory,
} from '@/modules/messaging/ai/conversationOrchestrator/sessionMemory';
import { resolveReferences } from '@/modules/messaging/ai/conversationOrchestrator/referenceResolver';
import {
  runOrchestratorV3Benchmark,
  meetsV3BenchmarkGates,
} from '@/modules/messaging/ai/conversationOrchestrator/benchmark';
import type { BookingPlanSnapshot } from '@/modules/messaging/ai/planner/types';

vi.mock('@/lib/booking/publicBookingBarbers', () => ({
  listPublicBookingBarbers: vi.fn(async () => ({
    mode: 'branch',
    branch: { branchCode: 'GLEEM', branchName: 'جليم' },
    barbers: [
      { empId: 40, name: 'محمد', nameAr: 'محمد', nameEn: 'Mohamed', branches: [], isBookableOnline: true },
      { empId: 41, name: 'أحمد', nameAr: 'أحمد', nameEn: 'Ahmed', branches: [], isBookableOnline: true },
    ],
  })),
  getPublicBarberCalendar: vi.fn(async () => ({ days: [] })),
}));

vi.mock('@/lib/booking/publicBookingAvailability', () => ({
  getPublicAvailableSlots: vi.fn(async () => ({
    branch: { branchCode: 'GLEEM', branchId: 2, branchName: 'جليم' },
    date: '2026-08-29',
    mode: 'any_barber',
    services: [],
    slots: [
      {
        time: '22:00',
        dayOffset: 0,
        barbers: [
          { empId: 40, nameAr: 'محمد' },
          { empId: 41, nameAr: 'أحمد' },
        ],
      },
    ],
    reasonCode: null,
    messageAr: null,
    message: null,
  })),
}));

vi.mock('@/modules/messaging/ai/planner/bookingPlanRepository', () => ({
  getActiveBookingPlan: vi.fn(async () => readyPlan()),
}));

import { orchestrateConversationTurn } from '@/modules/messaging/ai/conversationOrchestrator/orchestrateTurn';

function readyPlan(over: Partial<BookingPlanSnapshot> = {}): BookingPlanSnapshot {
  return {
    planId: 7,
    conversationId: 501,
    stage: 'ready_to_confirm',
    version: 4,
    branchId: 3,
    branchCode: 'CAMP_CAESAR',
    branchName: 'كامب شيزار',
    serviceIds: [20],
    serviceNames: ['شعر ودقن'],
    empId: 25,
    employeeName: 'عمر',
    requestedDate: '2026-08-29',
    timePreference: { kind: 'around', timeHm: '22:00', label: 'حوالي 10' },
    candidateSlots: [
      { time: '22:00', dayOffset: 0, empId: 25, empName: 'عمر', label: '10:00 م' },
    ],
    selectedSlot: { time: '22:00', dayOffset: 0, empId: 25, empName: 'عمر', label: '10:00 م' },
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
    ...over,
  };
}

describe('Orchestrator V3 turn frame', () => {
  beforeEach(() => resetSessionMemoryForTests());

  it('Gleem NOW query does not mutate booking', () => {
    const t = buildTurnFrame({ text: 'فرع جليم مين متاح حاليا؟' });
    expect(t.primaryIntent).toBe('AVAILABILITY_QUERY');
    expect(t.temporal).toBe('now');
    expect(t.mutatesBookingPlan).toBe(false);
    expect(t.entities.branchHint).toBe('جليم');
    expect(isEphemeralQueryIntent(t.primaryIntent)).toBe(true);
  });

  it('alternative same-time is ephemeral', () => {
    const t = buildTurnFrame({ text: 'مين متاح تاني في الوقت ده؟' });
    expect(t.primaryIntent).toBe('BOOKING_ALTERNATIVE_QUERY');
    expect(t.mutatesBookingPlan).toBe(false);
  });

  it('explicit modification mutates', () => {
    const t = buildTurnFrame({ text: 'خليه مع محمد' });
    expect(t.primaryIntent).toBe('BOOKING_MODIFICATION');
    expect(t.mutatesBookingPlan).toBe(true);
  });
});

describe('Orchestrator V3 confirmation gate', () => {
  beforeEach(() => resetSessionMemoryForTests());

  it('blocks اه after intervening query', () => {
    const plan = readyPlan();
    recordBotAction(501, {
      text: 'أأكدلك؟',
      action: 'ask_booking_confirm',
      answeredWell: true,
      planId: 7,
      planVersion: 4,
    });
    recordBotAction(501, {
      text: 'محمد وأحمد',
      action: 'answered_query',
      answeredWell: true,
    });
    const turn = buildTurnFrame({ text: 'اه' });
    const gate = evaluateBookingConfirmationGate({
      conversationId: 501,
      turn: { ...turn, isConfirmation: true, primaryIntent: 'BOOKING_CONFIRMATION' },
      plan,
    });
    expect(gate.allow).toBe(false);
  });

  it('allows اه when confirm ask is pending', () => {
    const plan = readyPlan();
    recordBotAction(501, {
      text: 'أأكدلك؟',
      action: 'ask_booking_confirm',
      answeredWell: true,
      planId: 7,
      planVersion: 4,
    });
    const turn = buildTurnFrame({ text: 'اه' });
    const gate = evaluateBookingConfirmationGate({
      conversationId: 501,
      turn: { ...turn, isConfirmation: true, primaryIntent: 'BOOKING_CONFIRMATION' },
      plan,
    });
    expect(gate.allow).toBe(true);
  });
});

describe('Orchestrator V3 reference + query handler', () => {
  beforeEach(() => {
    resetSessionMemoryForTests();
    process.env.CONVERSATION_ORCHESTRATOR_V3 = 'true';
  });

  it('answers Gleem NOW without Omar confirmation summary', async () => {
    const plan = readyPlan();
    const decision = await orchestrateConversationTurn({
      conversationId: 501,
      inboundText: 'فرع جليم مين متاح حاليا؟',
      plan,
    });
    expect(decision?.handled).toBe(true);
    expect(decision?.mutatesBookingPlan).toBe(false);
    expect(decision?.replyText).toMatch(/جليم|محمد|أحمد/);
    expect(decision?.replyText).not.toMatch(/أأكدلك/);
    expect(plan.empId).toBe(25);
    expect(plan.selectedSlot?.time).toBe('22:00');
  });

  it('هناك resolves to last referenced branch', () => {
    const plan = readyPlan();
    const session = getSessionMemory(501);
    session.lastReferencedBranchCode = 'GLEEM';
    session.lastReferencedBranchName = 'جليم';
    const turn = buildTurnFrame({ text: 'مين موجود هناك دلوقتي؟' });
    const ctx = resolveReferences({ turn, plan, session });
    expect(ctx.branchCode).toBe('GLEEM');
    expect(ctx.temporal).toBe('now');
  });
});

describe('Orchestrator V3 benchmark gates', () => {
  it('meets conversation-level targets', () => {
    const m = runOrchestratorV3Benchmark();
    if (m.failed.length) {
      // eslint-disable-next-line no-console
      console.log('V3 failures', m.failed.slice(0, 30));
    }
    expect(m.BookingSafetyRate).toBe(1);
    expect(m.RepeatedIrrelevantResponseRate).toBeLessThanOrEqual(0.01);
    expect(meetsV3BenchmarkGates(m)).toBe(true);
  });
});

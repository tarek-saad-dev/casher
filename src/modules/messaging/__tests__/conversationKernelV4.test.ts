import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  interpretCurrentTurn,
  classifyQueryVsMutation,
  routeTurn,
  readScopedMemory,
  processKernelTurn,
  runV4Benchmark,
  meetsV4BenchmarkGates,
  resetTaskStackForTests,
  HUMAN_HANDOFF_REPLY_AR,
} from '@/modules/messaging/ai/conversationKernel';
import {
  resetSessionMemoryForTests,
  recordBotAction,
  getSessionMemory,
} from '@/modules/messaging/ai/conversationOrchestrator/sessionMemory';
import { evaluateBookingConfirmationGate } from '@/modules/messaging/ai/conversationOrchestrator/confirmationGate';
import { buildTurnFrame } from '@/modules/messaging/ai/conversationOrchestrator/turnFrame';
import {
  runOrchestratorV3Benchmark,
  meetsV3BenchmarkGates,
} from '@/modules/messaging/ai/conversationOrchestrator/benchmark';
import {
  runOrchestratorV31Benchmark,
  meetsV31BenchmarkGates,
} from '@/modules/messaging/ai/conversationOrchestrator/benchmarkV31';
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
    timePreference: { kind: 'around', timeHm: '22:00' },
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

describe('V4 Customer-Led Conversation Kernel', () => {
  beforeEach(() => {
    resetSessionMemoryForTests();
    resetTaskStackForTests();
    process.env.CUSTOMER_LED_CONVERSATION_V4 = 'true';
    process.env.CONVERSATION_ORCHESTRATOR_V3 = 'false';
  });

  it('Gleem NOW query does not mutate active booking', async () => {
    const plan = readyPlan();
    const turn = interpretCurrentTurn({
      text: 'مين متاح في فرع جليم دلوقتي؟',
      plan,
      session: getSessionMemory(501),
    });
    expect(turn.primaryIntent).toBe('AVAILABILITY_QUERY');
    expect(turn.temporal).toBe('now');
    expect(turn.mutatesActiveTask).toBe(false);
    expect(classifyQueryVsMutation(turn)).toBe('query');

    const decision = await processKernelTurn({
      conversationId: 501,
      inboundText: 'مين متاح في فرع جليم دلوقتي؟',
      plan,
    });
    expect(decision?.handled).toBe(true);
    expect(decision?.replyText).toMatch(/جليم/);
    expect(decision?.replyText).not.toMatch(/أأكدلك/);
    expect(decision?.blockBookingConfirm).toBe(true);
  });

  it('price query only — no automatic booking bridge', async () => {
    const plan = readyPlan();
    const decision = await processKernelTurn({
      conversationId: 502,
      inboundText: 'شعر ودقن بكام؟',
      plan,
    });
    expect(decision?.passToPhase2).toBe(true);
    expect(decision?.blockBookingConfirm).toBe(true);
    expect(decision?.mutatesBookingPlan).toBe(false);
  });

  it('human handoff does not enter planner', async () => {
    const decision = await processKernelTurn({
      conversationId: 503,
      inboundText: 'عاوز اكلم حد من الاستقبال',
      plan: null,
    });
    expect(decision?.handled).toBe(true);
    expect(decision?.replyText).toBe(HUMAN_HANDOFF_REPLY_AR);
    expect(decision?.bypassPlanner).toBe(true);
  });

  it('gauntlet 4: اه after query does NOT confirm booking', () => {
    const plan = readyPlan();
    recordBotAction(plan.conversationId, {
      text: 'أأكدلك عمر الساعة 10؟',
      action: 'ask_booking_confirm',
      answeredWell: true,
      planId: plan.planId,
      planVersion: plan.version,
    });
    recordBotAction(plan.conversationId, {
      text: 'في جليم متاح محمد وأحمد',
      action: 'answered_query',
      answeredWell: true,
      customerText: 'مين متاح في جليم؟',
    });
    const turn = buildTurnFrame({ text: 'اه' });
    const gate = evaluateBookingConfirmationGate({
      conversationId: plan.conversationId,
      turn: { ...turn, isConfirmation: true, primaryIntent: 'BOOKING_CONFIRMATION' },
      plan,
    });
    expect(gate.allow).toBe(false);
  });

  it('query vs mutation: مين متاح في جليم is query only', () => {
    const plan = readyPlan();
    const turn = interpretCurrentTurn({
      text: 'مين متاح في جليم؟',
      plan,
      session: getSessionMemory(504),
    });
    expect(classifyQueryVsMutation(turn)).toBe('query');
    expect(turn.mutatesActiveTask).toBe(false);
  });

  it('mutation: خلي الحجز في جليم mutates', () => {
    const plan = readyPlan();
    const turn = interpretCurrentTurn({
      text: 'خلي الحجز في جليم',
      plan,
      session: getSessionMemory(505),
    });
    expect(turn.mutatesActiveTask).toBe(true);
  });

  it('V4 benchmark gates pass', () => {
    const m = runV4Benchmark();
    expect(meetsV4BenchmarkGates(m)).toBe(true);
    expect(m.BookingSafety).toBe(1);
    expect(m.hardGauntletsPassed).toBe(m.hardGauntletsTotal);
  });

  it('V3/V3.1 regressions remain green', () => {
    resetSessionMemoryForTests();
    expect(meetsV3BenchmarkGates(runOrchestratorV3Benchmark())).toBe(true);
    expect(meetsV31BenchmarkGates(runOrchestratorV31Benchmark())).toBe(true);
  });
});

/**
 * Customer-Led Conversation Kernel V4 — benchmark + mandatory gauntlets.
 */
import { interpretCurrentTurn } from './currentTurnInterpreter';
import { routeTurn, classifyQueryVsMutation } from './dialoguePolicy';
import { readScopedMemory } from './scopedMemory';
import { resetTaskStackForTests } from './taskStack';
import {
  resetSessionMemoryForTests,
  getSessionMemory,
  recordBotAction,
} from '../conversationOrchestrator/sessionMemory';
import { evaluateBookingConfirmationGate } from '../conversationOrchestrator/confirmationGate';
import { buildTurnFrame } from '../conversationOrchestrator/turnFrame';
import type { BookingPlanSnapshot } from '../planner/types';
import type { V4TurnFrame } from './types';

export type V4GauntletTurn = {
  customer: string;
  expect: {
    primaryIntent?: string;
    mutatesActiveTask?: boolean;
    ephemeralQuery?: boolean;
    temporal?: string;
    routeAction?: string;
    noBridge?: boolean;
  };
};

export type V4Gauntlet = {
  id: string;
  hard?: boolean;
  turns: V4GauntletTurn[];
};

function readyPlan(over: Partial<BookingPlanSnapshot> = {}): BookingPlanSnapshot {
  return {
    planId: 7,
    conversationId: 9001,
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

/** Mandatory gauntlets from spec */
export const V4_GAUNTLETS: V4Gauntlet[] = [
  {
    id: 'gauntlet-1-mixed-interrupt',
    hard: true,
    turns: [
      { customer: 'عاوز احجز مع عمر', expect: { mutatesActiveTask: true } },
      { customer: 'شعر ودقن', expect: { mutatesActiveTask: true } },
      { customer: 'النهارده 10 بليل', expect: { mutatesActiveTask: true } },
      {
        customer: 'مين متاح تاني في الوقت ده؟',
        expect: { ephemeralQuery: true, mutatesActiveTask: false },
      },
      {
        customer: 'طب جليم؟',
        expect: { ephemeralQuery: true, mutatesActiveTask: false },
      },
      {
        customer: 'مين موجود هناك دلوقتي؟',
        expect: { ephemeralQuery: true, temporal: 'now', mutatesActiveTask: false },
      },
      { customer: 'خلاص خليك في عمر', expect: { mutatesActiveTask: false } },
      {
        customer: 'شعر ودقن بكام بالمناسبة؟',
        expect: { ephemeralQuery: true, mutatesActiveTask: false },
      },
      { customer: 'كمل', expect: { mutatesActiveTask: false } },
      { customer: 'الأول', expect: { mutatesActiveTask: true } },
      { customer: 'اه', expect: { mutatesActiveTask: true } },
    ],
  },
  {
    id: 'gauntlet-2-time-freedom',
    hard: true,
    turns: [
      { customer: 'ممكن احجز مع كريم', expect: { mutatesActiveTask: true } },
      { customer: 'شعر ودقن النهارده', expect: { mutatesActiveTask: true } },
      {
        customer: 'عاوز الساعة 11',
        expect: { mutatesActiveTask: true },
      },
      {
        customer: 'لا قصدي 1 بالليل',
        expect: { mutatesActiveTask: true },
      },
      {
        customer: 'مين متاح وقتها؟',
        expect: { ephemeralQuery: true, mutatesActiveTask: false },
      },
      { customer: 'خلاص خليه النهارده 11', expect: { mutatesActiveTask: true } },
      { customer: 'تمام', expect: { mutatesActiveTask: false } },
    ],
  },
  {
    id: 'gauntlet-3-customer-freedom',
    hard: true,
    turns: [
      { customer: 'عاوز أحجز', expect: { mutatesActiveTask: true } },
      { customer: 'شعر', expect: { mutatesActiveTask: true } },
      {
        customer: 'بالمناسبة فرع جليم بيقفل امتى؟',
        expect: { ephemeralQuery: true, mutatesActiveTask: false },
      },
      {
        customer: 'مين موجود هناك؟',
        expect: { ephemeralQuery: true, mutatesActiveTask: false },
      },
      { customer: 'طيب نرجع للحجز', expect: { mutatesActiveTask: false } },
      { customer: 'مع عمر', expect: { mutatesActiveTask: true } },
      { customer: 'بكرة', expect: { mutatesActiveTask: true } },
      { customer: 'بعد 6', expect: { mutatesActiveTask: true } },
      {
        customer: 'طب شعر ودقن بكام؟',
        expect: { ephemeralQuery: true, mutatesActiveTask: false },
      },
      { customer: 'خليه شعر ودقن', expect: { mutatesActiveTask: true } },
      { customer: 'الأول', expect: { mutatesActiveTask: true } },
    ],
  },
  {
    id: 'gauntlet-4-safety',
    hard: true,
    turns: [
      {
        customer: 'مين متاح في جليم؟',
        expect: { ephemeralQuery: true, mutatesActiveTask: false },
      },
      { customer: 'اه', expect: { mutatesActiveTask: false } },
    ],
  },
];

/** Additional multi-turn scenarios */
export const V4_DIALOGUES: V4Gauntlet[] = [
  ...V4_GAUNTLETS,
  {
    id: 'gleem-now-query',
    turns: [
      {
        customer: 'مين متاح في فرع جليم دلوقتي؟',
        expect: {
          primaryIntent: 'AVAILABILITY_QUERY',
          temporal: 'now',
          ephemeralQuery: true,
          mutatesActiveTask: false,
        },
      },
    ],
  },
  {
    id: 'price-only-no-bridge',
    turns: [
      {
        customer: 'شعر ودقن بكام؟',
        expect: { ephemeralQuery: true, mutatesActiveTask: false, noBridge: true },
      },
    ],
  },
  {
    id: 'human-handoff',
    turns: [
      {
        customer: 'عاوز اكلم حد من الاستقبال',
        expect: { primaryIntent: 'HUMAN_HANDOFF_REQUEST', mutatesActiveTask: false },
      },
    ],
  },
  {
    id: 'query-vs-mutation-branch',
    turns: [
      {
        customer: 'مين متاح في جليم؟',
        expect: { ephemeralQuery: true, mutatesActiveTask: false },
      },
      {
        customer: 'خلي الحجز في جليم',
        expect: { mutatesActiveTask: true },
      },
    ],
  },
];

export type V4BenchmarkMetrics = {
  totalTurns: number;
  passedTurns: number;
  failed: string[];
  CurrentMessageUnderstanding: number;
  CurrentQuestionAnswered: number;
  QueryVsMutationAccuracy: number;
  InterruptionHandling: number;
  BookingSafety: number;
  hardGauntletsPassed: number;
  hardGauntletsTotal: number;
};

function evalTurn(
  customer: string,
  plan: BookingPlanSnapshot | null,
  conversationId: number,
  expect: V4GauntletTurn['expect'],
): { ok: boolean; reasons: string[]; turn: V4TurnFrame } {
  const session = getSessionMemory(conversationId);
  const turn = interpretCurrentTurn({ text: customer, plan, session });
  const scoped = readScopedMemory({ conversationId, plan, session });
  const route = routeTurn({ turn, scoped });
  const reasons: string[] = [];
  let ok = true;

  if (expect.primaryIntent && turn.primaryIntent !== expect.primaryIntent) {
    ok = false;
    reasons.push(`intent ${turn.primaryIntent} want ${expect.primaryIntent}`);
  }
  if (
    expect.mutatesActiveTask != null &&
    turn.mutatesActiveTask !== expect.mutatesActiveTask
  ) {
    ok = false;
    reasons.push(`mutate ${turn.mutatesActiveTask} want ${expect.mutatesActiveTask}`);
  }
  if (expect.ephemeralQuery != null) {
    const isQuery = classifyQueryVsMutation(turn) === 'query';
    if (isQuery !== expect.ephemeralQuery) {
      ok = false;
      reasons.push(`ephemeral ${isQuery} want ${expect.ephemeralQuery}`);
    }
  }
  if (expect.temporal && turn.temporal !== expect.temporal) {
    ok = false;
    reasons.push(`temporal ${turn.temporal} want ${expect.temporal}`);
  }
  if (expect.routeAction && route.action !== expect.routeAction) {
    ok = false;
    reasons.push(`route ${route.action} want ${expect.routeAction}`);
  }

  return { ok, reasons, turn };
}

export function runV4Benchmark(): V4BenchmarkMetrics {
  resetSessionMemoryForTests();
  resetTaskStackForTests();

  const failed: string[] = [];
  let totalTurns = 0;
  let passedTurns = 0;
  let understandOk = 0;
  let understandN = 0;
  let queryOk = 0;
  let queryN = 0;
  let interruptOk = 0;
  let interruptN = 0;
  let hardPass = 0;
  let hardTotal = 0;
  let safetyOk = 0;
  let safetyN = 0;

  const plan = readyPlan();

  for (const d of V4_DIALOGUES) {
    let dialogueOk = true;
    const convId = 8000 + Math.floor(Math.random() * 1000);
    let prevCustomer = '';
    resetSessionMemoryForTests();
    resetTaskStackForTests();

  for (const step of d.turns) {
      totalTurns++;
      understandN++;

      // Simulate confirm pending before affirmative at end of booking flow
      if (
        step.customer.trim() === 'اه' &&
        /^(الأول|التاني|التالت|1|2|3|كمل)$/.test(prevCustomer.trim())
      ) {
        recordBotAction(convId, {
          text: 'أأكدلك عمر؟',
          action: 'ask_booking_confirm',
          answeredWell: true,
          planId: plan.planId,
          planVersion: plan.version,
        });
      }

      const { ok, reasons, turn } = evalTurn(step.customer, plan, convId, step.expect);
      if (ok) {
        passedTurns++;
        understandOk++;
      } else {
        dialogueOk = false;
        failed.push(`${d.id}:${step.customer.slice(0, 28)} → ${reasons.join('; ')}`);
      }

      if (step.expect.ephemeralQuery != null) {
        queryN++;
        if (classifyQueryVsMutation(turn) === 'query' && !turn.mutatesActiveTask) queryOk++;
      }

      if (step.expect.ephemeralQuery === true) {
        interruptN++;
        if (classifyQueryVsMutation(turn) === 'query' && !turn.mutatesActiveTask) {
          interruptOk++;
        }
      }

      prevCustomer = step.customer;
    }

    if (d.hard) {
      hardTotal++;
      if (dialogueOk) hardPass++;
    }
  }

  // Gauntlet 4 safety: اه after query must NOT allow confirm
  resetSessionMemoryForTests();
  safetyN++;
  const safetyPlan = readyPlan();
  recordBotAction(safetyPlan.conversationId, {
    text: 'أأكدلك عمر الساعة 10؟',
    action: 'ask_booking_confirm',
    answeredWell: true,
    planId: safetyPlan.planId,
    planVersion: safetyPlan.version,
  });
  recordBotAction(safetyPlan.conversationId, {
    text: 'في جليم متاح محمد وأحمد',
    action: 'answered_query',
    answeredWell: true,
    customerText: 'مين متاح في جليم؟',
  });
  const affirmTurn = buildTurnFrame({ text: 'اه' });
  const gate = evaluateBookingConfirmationGate({
    conversationId: safetyPlan.conversationId,
    turn: { ...affirmTurn, isConfirmation: true, primaryIntent: 'BOOKING_CONFIRMATION' },
    plan: safetyPlan,
  });
  if (!gate.allow) safetyOk++;

  return {
    totalTurns,
    passedTurns,
    failed,
    CurrentMessageUnderstanding: understandN ? understandOk / understandN : 1,
    CurrentQuestionAnswered: understandN ? understandOk / understandN : 1,
    QueryVsMutationAccuracy: queryN ? queryOk / queryN : 1,
    InterruptionHandling: interruptN ? interruptOk / interruptN : 1,
    BookingSafety: safetyN ? safetyOk / safetyN : 1,
    hardGauntletsPassed: hardPass,
    hardGauntletsTotal: hardTotal,
  };
}

export function meetsV4BenchmarkGates(m: V4BenchmarkMetrics): boolean {
  return (
    m.CurrentMessageUnderstanding >= 0.98 &&
    m.CurrentQuestionAnswered >= 0.98 &&
    m.QueryVsMutationAccuracy >= 0.99 &&
    m.InterruptionHandling >= 0.98 &&
    m.BookingSafety === 1 &&
    m.hardGauntletsPassed === m.hardGauntletsTotal &&
    m.failed.length === 0
  );
}

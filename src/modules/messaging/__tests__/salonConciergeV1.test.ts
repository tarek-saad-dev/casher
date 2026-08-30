import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@/modules/messaging/ai/tools/getBusinessHours', () => ({
  executeGetBusinessHours: vi.fn(async () => ({
    name: 'get_business_hours',
    ok: true,
    input: {},
    data: {
      openTime: '12:00:00',
      closeTime: '01:00:00',
      branchName: 'جليم',
      branchCode: 'GLEEM',
    },
  })),
}));

import {
  processConciergeTurn,
  evaluateOpenNow,
  resetConciergeStoreForTests,
  runConciergeBenchmark,
  meetsConciergeBenchmarkGates,
  buildUnavailableEmployeeAdvice,
  listActiveOffers,
  applyBrandVoice,
  listKnowledgeGaps,
  detectConciergeIntent,
} from '@/modules/messaging/ai/salonConcierge';
import {
  processKernelTurn,
  resetTaskStackForTests,
} from '@/modules/messaging/ai/conversationKernel';
import {
  resetSessionMemoryForTests,
  getSessionMemory,
} from '@/modules/messaging/ai/conversationOrchestrator/sessionMemory';
import {
  runV4Benchmark,
  meetsV4BenchmarkGates,
} from '@/modules/messaging/ai/conversationKernel/benchmark';
import type { BookingPlanSnapshot } from '@/modules/messaging/ai/planner/types';

function readyPlan(): BookingPlanSnapshot {
  return {
    planId: 9,
    conversationId: 8801,
    stage: 'ready_to_confirm',
    version: 2,
    branchId: 3,
    branchCode: 'CAMP_CAESAR',
    branchName: 'كامب',
    serviceIds: [20],
    serviceNames: ['شعر ودقن'],
    empId: 25,
    employeeName: 'عمر',
    requestedDate: '2026-08-29',
    timePreference: { kind: 'around', timeHm: '22:00' },
    candidateSlots: [
      { time: '22:00', dayOffset: 0, empId: 25, empName: 'عمر', label: '10م' },
    ],
    selectedSlot: { time: '22:00', dayOffset: 0, empId: 25, empName: 'عمر', label: '10م' },
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
}

describe('Salon Concierge Brain V1', () => {
  beforeEach(() => {
    process.env.SALON_CONCIERGE_BRAIN_V1 = 'true';
    process.env.CUSTOMER_LED_CONVERSATION_V4 = 'true';
    resetConciergeStoreForTests();
    resetSessionMemoryForTests();
    resetTaskStackForTests();
  });

  it('static: booking / social / maps / faq / unknown', async () => {
    expect((await processConciergeTurn({ text: 'لينك الحجز؟' }))?.replyText).toContain(
      'example.test/book',
    );
    expect((await processConciergeTurn({ text: 'عندكم انستجرام؟' }))?.replyText).toContain(
      'instagram',
    );
    expect((await processConciergeTurn({ text: 'ابعتلي لوكيشن جليم' }))?.replyText).toContain(
      'gleem',
    );
    expect((await processConciergeTurn({ text: 'فيه جراج؟' }))?.replyText).toMatch(/موقف/);
    const unk = await processConciergeTurn({ text: 'بتقدموا مساج تايلاندي؟' });
    expect(unk?.trace.knowledgeGap).toBe(true);
    expect(listKnowledgeGaps().length).toBeGreaterThan(0);
  });

  it('live open/closed via fixed hours override', async () => {
    const open = await processConciergeTurn({
      text: 'فاتحين دلوقتي؟',
      openNowOverride: { nowMinutes: 15 * 60 },
    });
    expect(open?.replyText).toMatch(/فاتح/);
    const closed = await processConciergeTurn({
      text: 'جليم مفتوح؟',
      openNowOverride: { nowMinutes: 10 * 60 + 59 },
    });
    expect(closed?.replyText).toMatch(/مقفول/);
  });

  it('overnight open-now math', () => {
    expect(
      evaluateOpenNow({ openTime: '12:00', closeTime: '01:00', nowMinutes: 30 }).isOpen,
    ).toBe(true);
  });

  it('price/availability route to Phase 2 live tools', async () => {
    const price = await processConciergeTurn({ text: 'شعر ودقن بكام؟' });
    expect(price?.passToPhase2).toBe(true);
    expect(price?.handled).toBe(false);
    expect(price?.mutatesBookingPlan).toBe(false);
  });

  it('capabilities + advisor + offers + voice', async () => {
    const cap = await processConciergeTurn({ text: 'عندكم حد شاطر في الكيرلي؟' });
    expect(cap?.replyText).toMatch(/محمد/);
    expect(
      buildUnavailableEmployeeAdvice({
        employeeName: 'عمر',
        requestedTimeLabel: '10',
        alternatives: [{ label: 'كريم الساعة 10', kind: 'same_time_other_employee' }],
      }),
    ).toMatch(/كريم/);
    expect(listActiveOffers().every((o) => o.key !== 'offer.expired.demo')).toBe(true);
    expect(applyBrandVoice({ answer: 'تمام يا باشا' })).not.toContain('يا باشا');
  });

  it('V4: concierge interruption preserves booking and does not auto-resume', async () => {
    const plan = readyPlan();
    const d = await processKernelTurn({
      conversationId: plan.conversationId,
      inboundText: 'ابعت الإنستجرام',
      plan,
    });
    expect(d?.handled).toBe(true);
    expect(d?.replyText).toMatch(/instagram/);
    expect(d?.mutatesBookingPlan).toBe(false);
    expect(d?.replyText).not.toMatch(/أأكدلك/);
    // plan identity untouched in memory path
    expect(plan.employeeName).toBe('عمر');
    expect(plan.stage).toBe('ready_to_confirm');
  });

  it('gauntlet A-ish multi intents classification', () => {
    expect(detectConciergeIntent('فاتحين دلوقتي؟')).toBe('OPEN_NOW');
    expect(detectConciergeIntent('فين جليم؟')).toBe('DIRECTIONS_MAPS');
    expect(detectConciergeIntent('ابعت اللوكيشن')).toBe('DIRECTIONS_MAPS');
  });

  it('concierge + V4 benchmarks green', async () => {
    const c = await runConciergeBenchmark();
    expect(meetsConciergeBenchmarkGates(c)).toBe(true);
    resetSessionMemoryForTests();
    expect(meetsV4BenchmarkGates(runV4Benchmark())).toBe(true);
  });
});

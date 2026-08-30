import { describe, expect, it, beforeEach } from 'vitest';
import {
  isConciergeBranchOpenAt,
  formatConciergeBranchSchedule,
  buildFixedOpenNowReply,
  buildFixedHoursScheduleReply,
  processConciergeTurn,
  resolveConciergeIntent,
} from '@/modules/messaging/ai/salonConcierge';
import {
  processKernelTurn,
  resetTaskStackForTests,
} from '@/modules/messaging/ai/conversationKernel';
import {
  resetSessionMemoryForTests,
  recordBotAction,
  getSessionMemory,
} from '@/modules/messaging/ai/conversationOrchestrator/sessionMemory';
import type { BookingPlanSnapshot } from '@/modules/messaging/ai/planner/types';

function readyPlan(): BookingPlanSnapshot {
  return {
    planId: 42,
    conversationId: 99042,
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

describe('fixed Concierge branch hours', () => {
  beforeEach(() => {
    process.env.SALON_CONCIERGE_BRAIN_V1 = 'true';
    process.env.CUSTOMER_LED_CONVERSATION_V4 = 'true';
    resetSessionMemoryForTests();
    resetTaskStackForTests();
  });

  describe('midnight boundaries', () => {
    const gleemCases: Array<[number, boolean]> = [
      [10 * 60 + 59, false],
      [11 * 60, true],
      [23 * 60 + 59, true],
      [0, true],
      [1 * 60 + 59, true],
      [2 * 60, false],
    ];

    it.each(gleemCases)('GLEEM at %i minutes → open=%s', (minutes, open) => {
      expect(isConciergeBranchOpenAt('GLEEM', minutes)).toBe(open);
    });

    const campCases: Array<[number, boolean]> = [
      [11 * 60 + 59, false],
      [12 * 60, true],
      [23 * 60 + 59, true],
      [0, true],
      [0 * 60 + 59, true],
      [1 * 60, false],
    ];

    it.each(campCases)('CAMP_CAESAR at %i minutes → open=%s', (minutes, open) => {
      expect(isConciergeBranchOpenAt('CAMP_CAESAR', minutes)).toBe(open);
    });
  });

  it('schedule copy matches owner-approved wording', () => {
    expect(formatConciergeBranchSchedule('GLEEM')).toBe(
      'فرع جليم شغال يوميًا من 11 صباحًا لحد 2 بعد منتصف الليل.',
    );
    expect(formatConciergeBranchSchedule('CAMP_CAESAR')).toBe(
      'فرع كامب شيزار شغال يوميًا من 12 ظهرًا لحد 1 بعد منتصف الليل.',
    );
  });

  it('open-now both branches at 15:00', async () => {
    const d = await processConciergeTurn({
      text: 'فاتحين دلوقتي؟',
      openNowOverride: { nowMinutes: 15 * 60 },
    });
    expect(d?.handled).toBe(true);
    expect(d?.replyText).toMatch(/الفرعين فاتحين/);
    expect(d?.replyText).toMatch(/11|جليم/);
    expect(d?.replyText).toMatch(/كامب/);
    expect(d?.trace.liveTools).not.toContain('get_business_hours');
    expect(d?.trace.answerSource).toBe('CURATED_KNOWLEDGE');
  });

  it('hours question for both branches', async () => {
    const d = await processConciergeTurn({ text: 'مواعيد الفروع؟' });
    expect(d?.handled).toBe(true);
    expect(d?.replyText).toMatch(/11 صباحًا/);
    expect(d?.replyText).toMatch(/12 ظهرًا/);
    expect(d?.passToPhase2).toBeFalsy();
  });

  it('follow-up: open now then Gleem only', async () => {
    const conversationId = 88001;
    const first = await processConciergeTurn({
      text: 'فاتحين دلوقتي؟',
      openNowOverride: { nowMinutes: 15 * 60 },
    });
    recordBotAction(conversationId, {
      text: first?.replyText ?? '',
      action: 'answered_query',
      answeredWell: true,
    });
    expect(resolveConciergeIntent('طب جليم؟', getSessionMemory(conversationId))).toBe('OPEN_NOW');
    const gleem = await processConciergeTurn({
      text: 'طب جليم؟',
      openNowOverride: { nowMinutes: 15 * 60 },
      session: getSessionMemory(conversationId),
    });
    expect(gleem?.replyText).toMatch(/جليم فاتح/);
    expect(gleem?.replyText).not.toMatch(/الفرعين/);
  });

  it('follow-up: open now then Camp only', async () => {
    const conversationId = 88002;
    const first = await processConciergeTurn({
      text: 'فاتحين دلوقتي؟',
      openNowOverride: { nowMinutes: 15 * 60 },
    });
    recordBotAction(conversationId, {
      text: first?.replyText ?? '',
      action: 'answered_query',
      answeredWell: true,
    });
    expect(resolveConciergeIntent('وكامب؟', getSessionMemory(conversationId))).toBe('OPEN_NOW');
    const camp = await processConciergeTurn({
      text: 'وكامب؟',
      openNowOverride: { nowMinutes: 15 * 60 },
      session: getSessionMemory(conversationId),
    });
    expect(camp?.replyText).toMatch(/كامب شيزار فاتح/);
    expect(camp?.replyText).not.toMatch(/الفرعين/);
  });

  it('branch hours queries', async () => {
    const gleem = await processConciergeTurn({ text: 'مواعيد جليم؟' });
    expect(gleem?.replyText).toMatch(/11 صباحًا/);
    const camp = await processConciergeTurn({ text: 'كامب بيفتح امتى؟' });
    expect(camp?.replyText).toMatch(/12 ظهرًا/);
  });

  it('active booking plan unchanged after hours query via kernel', async () => {
    const plan = readyPlan();
    const before = JSON.stringify(plan);
    const d = await processKernelTurn({
      conversationId: plan.conversationId,
      inboundText: 'فاتحين دلوقتي؟',
      plan,
    });
    expect(d?.mutatesBookingPlan).toBe(false);
    expect(d?.replyText).toMatch(/فاتح|مقفول/);
    expect(JSON.stringify(plan)).toBe(before);
    expect(d?.replyText).not.toMatch(/نكمل الحجز/);
  });

  it('buildFixedOpenNowReply does not use ERP', () => {
    expect(buildFixedOpenNowReply({ branchCode: 'GLEEM', nowMinutes: 11 * 60 })).toMatch(/فاتح/);
    expect(buildFixedHoursScheduleReply({ branchCode: 'GLEEM' })).toMatch(/11 صباحًا/);
  });
});

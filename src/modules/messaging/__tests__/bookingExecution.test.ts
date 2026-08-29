import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { BookingPlanSnapshot } from '@/modules/messaging/ai/planner/types';

const store = new Map<number, BookingPlanSnapshot>();

vi.mock('@/modules/messaging/ai/planner/bookingPlanRepository', () => ({
  getBookingPlanById: vi.fn(async (id: number) => store.get(id) ?? null),
  getActiveBookingPlan: vi.fn(async (cid: number) => {
    for (const p of store.values()) {
      if (p.conversationId === cid && p.stage !== 'abandoned' && p.stage !== 'booked') return p;
    }
    return null;
  }),
  upsertBookingPlan: vi.fn(async (input: Record<string, unknown>) => {
    const id = Number(input.planId);
    const prev = store.get(id)!;
    const next: BookingPlanSnapshot = {
      ...prev,
      stage: input.stage as BookingPlanSnapshot['stage'],
      version: Number(input.version),
      candidateSlots: (input.candidateSlots as BookingPlanSnapshot['candidateSlots']) ?? prev.candidateSlots,
      selectedSlot: (input.selectedSlot as BookingPlanSnapshot['selectedSlot']) ?? null,
      missingFields: (input.missingFields as BookingPlanSnapshot['missingFields']) ?? [],
      bookingId: (input.bookingId as number | null) ?? null,
      bookingCode: (input.bookingCode as string | null) ?? null,
      idempotencyKey: (input.idempotencyKey as string | null) ?? null,
      executionErrorCode: (input.executionErrorCode as string | null) ?? null,
      lastTurnId: (input.lastTurnId as number | null) ?? prev.lastTurnId,
      completedAt: (input.completedAt as string | null) ?? null,
      updatedAt: new Date().toISOString(),
    };
    store.set(id, next);
    return next;
  }),
}));

import { executeConfirmedBookingPlan } from '@/modules/messaging/ai/planner/executeConfirmedBookingPlan';

function basePlan(over: Partial<BookingPlanSnapshot> = {}): BookingPlanSnapshot {
  return {
    planId: 1,
    conversationId: 10,
    stage: 'ready_to_confirm',
    version: 3,
    branchId: 1,
    branchCode: 'CAMP_CAESAR',
    branchName: 'كامب شيزار',
    serviceIds: [20],
    serviceNames: ['شعر ودقن'],
    empId: 25,
    employeeName: 'عمر',
    requestedDate: '2026-08-30',
    timePreference: null,
    candidateSlots: [
      { time: '12:00', dayOffset: 0, empId: 25, empName: 'عمر', label: '12:00 م' },
      { time: '12:15', dayOffset: 0, empId: 25, empName: 'عمر', label: '12:15 م' },
    ],
    selectedSlot: { time: '12:00', dayOffset: 0, empId: 25, empName: 'عمر', label: '12:00 م' },
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
    updatedAt: null,
    completedAt: null,
    ...over,
  };
}

describe('Phase 4 executeConfirmedBookingPlan', () => {
  beforeEach(() => {
    store.clear();
    store.set(1, basePlan());
  });

  it('1 complete confirmed plan creates booking via createPublicBooking', async () => {
    const create = vi.fn(async () => ({
      httpStatus: 201 as const,
      body: {
        ok: true as const,
        booking: { id: 555, code: 'B-555', barber: { empId: 25 } },
        meta: {
          idempotentReplay: false,
          planTokenStatus: 'valid' as const,
          createdAt: new Date().toISOString(),
          assignmentStrategy: 'fixed_barber',
        },
        message: 'ok',
      },
    }));
    const evaluate = vi.fn(async () => ({
      available: true,
      planToken: 'tok.sig',
      availabilityCode: null,
      availabilityMessage: null,
    }));
    const r = await executeConfirmedBookingPlan({
      conversationId: 10,
      planId: 1,
      turnId: 9,
      phone: '201557994946',
      createBooking: create as never,
      evaluateSelection: evaluate as never,
    });
    expect(r.ok).toBe(true);
    expect(r.bookingId).toBe(555);
    expect(r.plan.stage).toBe('booked');
    expect(r.replyText).toMatch(/تم الحجز/);
    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0]![0].clientRequestId).toMatch(/^bot-booking-plan:1:v/);
    expect(create.mock.calls[0]![0].suppressNotification).toBe(true);
    expect(create.mock.calls[0]![0].leadSource).toBe('whatsapp');
  });

  it('2 incomplete plan cannot execute', async () => {
    store.set(1, basePlan({ selectedSlot: null, stage: 'ready_to_confirm' }));
    const r = await executeConfirmedBookingPlan({
      conversationId: 10,
      planId: 1,
      turnId: 1,
      phone: '201557994946',
      createBooking: vi.fn() as never,
      evaluateSelection: vi.fn() as never,
    });
    expect(r.ok).toBe(false);
    expect(r.errorCode).toBe('PLAN_INCOMPLETE');
    expect(r.replyText).not.toMatch(/تم الحجز/);
  });

  it('3 non-confirmed collecting plan cannot execute', async () => {
    store.set(1, basePlan({ stage: 'collecting' }));
    const r = await executeConfirmedBookingPlan({
      conversationId: 10,
      planId: 1,
      turnId: 1,
      phone: '201557994946',
      createBooking: vi.fn() as never,
      evaluateSelection: vi.fn() as never,
    });
    expect(r.ok).toBe(false);
    expect(r.errorCode).toBe('PLAN_NOT_CONFIRMED');
  });

  it('5 unavailable slot creates no booking and refreshes candidates', async () => {
    const create = vi.fn();
    const evaluate = vi.fn(async () => ({
      available: false,
      planToken: null,
      availabilityCode: 'EMPLOYEE_BUSY',
      availabilityMessage: 'busy',
    }));
    const avail = vi.fn(async () => ({
      name: 'get_availability' as const,
      ok: true,
      input: {},
      data: {
        slots: [
          { time: '12:15', dayOffset: 0, empId: 25, empName: 'عمر' },
          { time: '12:30', dayOffset: 0, empId: 25, empName: 'عمر' },
        ],
      },
    }));
    const r = await executeConfirmedBookingPlan({
      conversationId: 10,
      planId: 1,
      turnId: 1,
      phone: '201557994946',
      createBooking: create as never,
      evaluateSelection: evaluate as never,
      runAvailability: avail as never,
    });
    expect(r.ok).toBe(false);
    expect(create).not.toHaveBeenCalled();
    expect(r.plan.stage).toBe('choosing_slot');
    expect(r.plan.selectedSlot).toBeNull();
    expect(r.plan.candidateSlots.map((s) => s.time)).toEqual(['12:15', '12:30']);
    expect(r.replyText).toMatch(/اتاخد|مش متاح/);
    expect(r.replyText).not.toMatch(/تم الحجز/);
  });

  it('11 duplicate confirmation is idempotent (already booked)', async () => {
    store.set(
      1,
      basePlan({
        stage: 'booked',
        bookingId: 555,
        bookingCode: 'B-555',
        idempotencyKey: 'bot-booking-plan:1:v3',
      }),
    );
    const create = vi.fn();
    const r = await executeConfirmedBookingPlan({
      conversationId: 10,
      planId: 1,
      turnId: 2,
      phone: '201557994946',
      createBooking: create as never,
      evaluateSelection: vi.fn() as never,
    });
    expect(r.ok).toBe(true);
    expect(r.idempotentReplay).toBe(true);
    expect(r.bookingId).toBe(555);
    expect(create).not.toHaveBeenCalled();
    expect(r.replyText).toMatch(/تم الحجز/);
  });

  it('9 DB create error never produces booked state / تم الحجز', async () => {
    const create = vi.fn(async () => {
      const err = new Error('DB_TIMEOUT') as Error & { code: string };
      err.code = 'DB_TIMEOUT';
      throw err;
    });
    const evaluate = vi.fn(async () => ({
      available: true,
      planToken: 'tok',
      availabilityCode: null,
      availabilityMessage: null,
    }));
    const r = await executeConfirmedBookingPlan({
      conversationId: 10,
      planId: 1,
      turnId: 1,
      phone: '201557994946',
      createBooking: create as never,
      evaluateSelection: evaluate as never,
    });
    expect(r.ok).toBe(false);
    expect(r.plan.stage).toBe('ready_to_confirm');
    expect(r.plan.bookingId).toBeNull();
    expect(r.replyText).not.toMatch(/تم الحجز/);
    expect(r.replyText).toMatch(/ماتسجلش/);
  });

  it('12 concurrent same-slot plans: second create conflict → choosing_slot', async () => {
    store.set(1, basePlan({ planId: 1 }));
    store.set(2, basePlan({ planId: 2, conversationId: 11 }));
    const evaluate = vi.fn(async () => ({
      available: true,
      planToken: 'tok',
      availabilityCode: null,
      availabilityMessage: null,
    }));
    let calls = 0;
    const create = vi.fn(async () => {
      calls += 1;
      if (calls === 1) {
        return {
          httpStatus: 201 as const,
          body: {
            ok: true as const,
            booking: { id: 1, code: 'A', barber: { empId: 25 } },
            meta: {
              idempotentReplay: false,
              planTokenStatus: 'valid' as const,
              createdAt: '',
              assignmentStrategy: 'fixed_barber',
            },
            message: 'ok',
          },
        };
      }
      const err = new Error('EMPLOYEE_BUSY') as Error & { code: string };
      err.code = 'EMPLOYEE_BUSY';
      throw err;
    });
    const avail = vi.fn(async () => ({
      name: 'get_availability' as const,
      ok: true,
      input: {},
      data: { slots: [{ time: '12:15', dayOffset: 0, empId: 25, empName: 'عمر' }] },
    }));
    const a = await executeConfirmedBookingPlan({
      conversationId: 10,
      planId: 1,
      turnId: 1,
      phone: '201111111111',
      createBooking: create as never,
      evaluateSelection: evaluate as never,
    });
    const b = await executeConfirmedBookingPlan({
      conversationId: 11,
      planId: 2,
      turnId: 1,
      phone: '201222222222',
      createBooking: create as never,
      evaluateSelection: evaluate as never,
      runAvailability: avail as never,
    });
    expect(a.ok).toBe(true);
    expect(a.bookingId).toBe(1);
    expect(b.ok).toBe(false);
    expect(b.plan.stage).toBe('choosing_slot');
    expect(b.replyText).not.toMatch(/تم الحجز/);
  });
});

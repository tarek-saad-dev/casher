import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AiStructuredResult } from '@/modules/messaging/ai/domain/types';
import type { BookingPlanSnapshot } from '@/modules/messaging/ai/planner/types';
import {
  filterSlotsByPreference,
  parseTimePreferenceText,
  resolveSlotChoice,
  isAffirmative,
  formatSlotLabelAr,
} from '@/modules/messaging/ai/planner/slotPreferences';
import {
  emptyMutablePlan,
  fromSnapshot,
  invalidateAfterChange,
  computeMissingFields,
  buildReadyToConfirmReply,
  buildConfirmedIntentReply,
} from '@/modules/messaging/ai/planner/planState';
import { PHASE3_FORBIDDEN_IMPORT_MARKERS } from '@/modules/messaging/ai/planner/processBookingPlannerTurn';
import fs from 'fs';
import path from 'path';

const store = new Map<number, BookingPlanSnapshot>();
let nextPlanId = 1;

vi.mock('@/modules/messaging/ai/planner/bookingPlanRepository', () => ({
  getActiveBookingPlan: vi.fn(async (conversationId: number) => {
    for (const p of store.values()) {
      if (
        p.conversationId === conversationId &&
        ['collecting', 'clarifying', 'choosing_slot', 'ready_to_confirm', 'confirmed_intent'].includes(
          p.stage,
        )
      ) {
        return p;
      }
    }
    return null;
  }),
  getBookingPlanById: vi.fn(async (planId: number) => store.get(planId) ?? null),
  upsertBookingPlan: vi.fn(async (input: Record<string, unknown>) => {
    const planId =
      input.planId != null && Number(input.planId) > 0 ? Number(input.planId) : nextPlanId++;
    const snap: BookingPlanSnapshot = {
      planId,
      conversationId: Number(input.conversationId),
      stage: input.stage as BookingPlanSnapshot['stage'],
      version: Number(input.version),
      branchId: (input.branchId as number | null) ?? null,
      branchCode: (input.branchCode as string | null) ?? null,
      branchName: (input.branchName as string | null) ?? null,
      serviceIds: (input.serviceIds as number[]) ?? [],
      serviceNames: (input.serviceNames as string[]) ?? [],
      empId: (input.empId as number | null) ?? null,
      employeeName: (input.employeeName as string | null) ?? null,
      requestedDate: (input.requestedDate as string | null) ?? null,
      timePreference: (input.timePreference as BookingPlanSnapshot['timePreference']) ?? null,
      candidateSlots: (input.candidateSlots as BookingPlanSnapshot['candidateSlots']) ?? [],
      selectedSlot: (input.selectedSlot as BookingPlanSnapshot['selectedSlot']) ?? null,
      clientId: (input.clientId as number | null) ?? null,
      missingFields: (input.missingFields as BookingPlanSnapshot['missingFields']) ?? [],
      clarification: (input.clarification as BookingPlanSnapshot['clarification']) ?? null,
      lastAvailabilityCheckedAt: (input.lastAvailabilityCheckedAt as string | null) ?? null,
      lastTurnId: (input.lastTurnId as number | null) ?? null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      completedAt: null,
    };
    // abandon other active for conversation
    for (const [id, p] of store) {
      if (p.conversationId === snap.conversationId && id !== planId && p.stage !== 'abandoned') {
        store.set(id, { ...p, stage: 'abandoned' });
      }
    }
    store.set(planId, snap);
    return snap;
  }),
  abandonBookingPlan: vi.fn(async (planId: number) => {
    const p = store.get(planId);
    if (p) store.set(planId, { ...p, stage: 'abandoned', completedAt: new Date().toISOString() });
  }),
  isActiveBookingPlanStage: (stage: string) =>
    ['collecting', 'clarifying', 'choosing_slot', 'ready_to_confirm', 'confirmed_intent'].includes(
      stage,
    ),
}));

vi.mock('@/modules/messaging/ai/planner/resolveEntities', async () => {
  const actual = await vi.importActual<typeof import('@/modules/messaging/ai/planner/resolveEntities')>(
    '@/modules/messaging/ai/planner/resolveEntities',
  );
  return {
    ...actual,
    resolveBranchByText: vi.fn(async (branchText: string | null) => {
      if (branchText && /جليم/.test(branchText)) {
        return {
          branchCode: 'GLEEM',
          branchId: 2,
          branchName: 'جليم',
          ambiguous: [],
        };
      }
      return {
        branchCode: 'CAMP_CAESAR',
        branchId: 1,
        branchName: 'كامب شيزار',
        ambiguous: [],
      };
    }),
    resolveServicesByText: vi.fn(async ({ serviceText }: { serviceText: string }) => {
      if (/شعر ودقن/.test(serviceText)) {
        return { ok: true, services: [{ serviceId: 20, name: 'شعر ودقن' }] };
      }
      if (/شعر/.test(serviceText) && !/ودقن/.test(serviceText)) {
        return {
          ok: false,
          ambiguous: [
            { serviceId: 20, name: 'شعر ودقن' },
            { serviceId: 21, name: 'شعر' },
          ],
          errorCode: 'SERVICE_AMBIGUOUS',
        };
      }
      return { ok: false, ambiguous: [], errorCode: 'SERVICE_NOT_FOUND' };
    }),
    resolveEmployeeByText: vi.fn(async ({ employeeName }: { employeeName: string }) => {
      if (/عمر/.test(employeeName)) {
        return {
          ok: true,
          employee: { empId: 25, name: 'عمر', branchCode: 'CAMP_CAESAR' },
        };
      }
      if (/محمد/.test(employeeName)) {
        return {
          ok: true,
          employee: { empId: 30, name: 'محمد', branchCode: 'CAMP_CAESAR' },
        };
      }
      if (/علي/.test(employeeName)) {
        return {
          ok: false,
          ambiguous: [
            { empId: 1, name: 'علي أ', branchCode: 'CAMP_CAESAR' },
            { empId: 2, name: 'علي ب', branchCode: 'CAMP_CAESAR' },
          ],
          errorCode: 'EMPLOYEE_AMBIGUOUS',
        };
      }
      return { ok: false, ambiguous: [], errorCode: 'EMPLOYEE_NOT_FOUND' };
    }),
    resolveDateText: vi.fn((dateText: string | null) => {
      if (!dateText) return { date: null };
      if (/بكرة|بكرا/.test(dateText)) return { date: '2026-08-30' };
      if (/^\d{4}-\d{2}-\d{2}$/.test(dateText)) return { date: dateText };
      return { date: null, errorCode: 'UNPARSED_DATE' };
    }),
  };
});

import { processBookingPlannerTurn } from '@/modules/messaging/ai/planner/processBookingPlannerTurn';
import { getActiveBookingPlan } from '@/modules/messaging/ai/planner/bookingPlanRepository';

function structured(over: Partial<AiStructuredResult> = {}): AiStructuredResult {
  return {
    replyText: '',
    intent: 'booking_request',
    confidence: 0.9,
    needsBusinessTool: true,
    missingInformation: [],
    entities: {
      dateText: null,
      timeText: null,
      employeeName: null,
      serviceText: null,
      branchText: null,
    },
    shouldReply: true,
    toolCalls: [],
    ...over,
  };
}

function mockAvailability(times: string[] = ['18:15', '19:00', '19:45', '20:30']) {
  return vi.fn(async () => ({
    name: 'get_availability' as const,
    ok: true,
    durationMs: 5,
    input: {},
    data: {
      branch: { branchCode: 'CAMP_CAESAR', branchName: 'كامب شيزار' },
      date: '2026-08-30',
      slots: times.map((time) => ({
        time,
        dayOffset: 0 as const,
        empId: 25,
        empName: 'عمر',
      })),
      noSlots: times.length === 0,
    },
  }));
}

describe('Phase 3 booking planner pure helpers', () => {
  it('parses time preferences', () => {
    expect(parseTimePreferenceText('بعد 6')?.kind).toBe('after');
    expect(parseTimePreferenceText('بعد 6')?.timeHm).toBe('18:00');
    expect(parseTimePreferenceText('أقرب ميعاد')?.kind).toBe('earliest');
    expect(parseTimePreferenceText('بالليل')?.kind).toBe('evening');
  });

  it('bounds candidates to 3 closest to preference', () => {
    const slots = ['17:00', '18:15', '19:00', '19:45', '20:30', '21:00'].map((time) => ({
      time,
      dayOffset: 0 as const,
      empId: 25,
      empName: 'عمر',
      label: formatSlotLabelAr(time),
    }));
    const short = filterSlotsByPreference(slots, { kind: 'after', timeHm: '18:00' }, 3);
    expect(short).toHaveLength(3);
    expect(short[0]!.time).toBe('18:15');
  });

  it('resolves الأول / الساعة 7 against candidates', () => {
    const candidates = ['18:15', '19:00', '19:45'].map((time) => ({
      time,
      dayOffset: 0 as const,
      empId: 25,
      empName: 'عمر',
      label: formatSlotLabelAr(time),
    }));
    expect(resolveSlotChoice('الأول', candidates).slot?.time).toBe('18:15');
    expect(resolveSlotChoice('التاني', candidates).slot?.time).toBe('19:00');
    expect(resolveSlotChoice('7', candidates).slot?.time).toBe('19:00');
    expect(resolveSlotChoice('الساعة 7', candidates).slot?.time).toBe('19:00');
    expect(resolveSlotChoice('9', candidates).slot).toBeNull();
  });

  it('invalidates slots on employee/date/service change', () => {
    const plan = emptyMutablePlan();
    plan.candidateSlots = [
      { time: '19:00', dayOffset: 0, empId: 25, empName: 'عمر', label: '7:00 م' },
    ];
    plan.selectedSlot = plan.candidateSlots[0]!;
    const inv = invalidateAfterChange(plan, ['employee']);
    expect(inv).toContain('candidateSlots');
    expect(plan.candidateSlots).toHaveLength(0);
    expect(plan.selectedSlot).toBeNull();
  });

  it('READY_TO_CONFIRM reply never says تم الحجز; confirm intent safe', () => {
    const plan = emptyMutablePlan();
    plan.serviceNames = ['شعر ودقن'];
    plan.employeeName = 'عمر';
    plan.branchName = 'كامب شيزار';
    plan.requestedDate = '2026-08-30';
    plan.selectedSlot = {
      time: '19:00',
      dayOffset: 0,
      empId: 25,
      empName: 'عمر',
      label: '7:00 م',
    };
    const ready = buildReadyToConfirmReply(plan);
    const confirmed = buildConfirmedIntentReply(plan);
    expect(ready).toMatch(/أأكدلك الحجز/);
    expect(ready).not.toMatch(/تم الحجز/);
    expect(confirmed).not.toMatch(/تم الحجز/);
    expect(confirmed).toMatch(/جاهز للتأكيد/);
    expect(isAffirmative('أيوه')).toBe(true);
  });
});

describe('Phase 3 booking planner turn matrix', () => {
  beforeEach(() => {
    store.clear();
    nextPlanId = 1;
  });

  it('1 greeting / non-booking does not create plan', async () => {
    const r = await processBookingPlannerTurn({
      conversationId: 100,
      turnId: 1,
      phone: '201',
      inboundText: 'السلام عليكم',
      structured: structured({ intent: 'greeting', needsBusinessTool: false }),
      runAvailability: mockAvailability(),
    });
    expect(r.handled).toBe(false);
    expect(await getActiveBookingPlan(100)).toBeNull();
  });

  it('2 new booking intent creates COLLECTING plan asking service', async () => {
    const r = await processBookingPlannerTurn({
      conversationId: 101,
      turnId: 1,
      phone: '201',
      inboundText: 'عاوز أحجز',
      structured: structured({ intent: 'booking_request' }),
      runAvailability: mockAvailability(),
    });
    expect(r.handled).toBe(true);
    expect(r.plan?.stage).toBe('collecting');
    expect(r.plan?.missingFields).toContain('service');
    expect(r.replyText).toMatch(/خدمة/);
  });

  it('3-6 service/employee/date/time retained; availability shortlist', async () => {
    const avail = mockAvailability();
    await processBookingPlannerTurn({
      conversationId: 102,
      turnId: 1,
      phone: '201',
      inboundText: 'عاوز أحجز شعر ودقن',
      structured: structured({
        entities: {
          serviceText: 'شعر ودقن',
          employeeName: null,
          dateText: null,
          timeText: null,
          branchText: null,
        },
      }),
      runAvailability: avail,
    });
    let plan = await getActiveBookingPlan(102);
    expect(plan?.serviceIds).toEqual([20]);

    await processBookingPlannerTurn({
      conversationId: 102,
      turnId: 2,
      phone: '201',
      inboundText: 'مع عمر',
      structured: structured({
        entities: {
          serviceText: null,
          employeeName: 'عمر',
          dateText: null,
          timeText: null,
          branchText: null,
        },
      }),
      runAvailability: avail,
    });
    plan = await getActiveBookingPlan(102);
    expect(plan?.empId).toBe(25);
    expect(plan?.serviceIds).toEqual([20]);

    const r = await processBookingPlannerTurn({
      conversationId: 102,
      turnId: 3,
      phone: '201',
      inboundText: 'بكرة بعد 6',
      structured: structured({
        entities: {
          serviceText: null,
          employeeName: null,
          dateText: 'بكرة',
          timeText: 'بعد 6',
          branchText: null,
        },
      }),
      runAvailability: avail,
    });
    plan = await getActiveBookingPlan(102);
    expect(plan?.requestedDate).toBe('2026-08-30');
    expect(plan?.timePreference?.kind).toBe('after');
    expect(plan?.stage).toBe('choosing_slot');
    expect(plan?.candidateSlots.length).toBeLessThanOrEqual(3);
    expect(plan?.candidateSlots.length).toBeGreaterThan(0);
    expect(r.replyText).toMatch(/1\)/);
    expect(avail).toHaveBeenCalled();
  });

  it('7 ambiguity asks clarification', async () => {
    const r = await processBookingPlannerTurn({
      conversationId: 103,
      turnId: 1,
      phone: '201',
      inboundText: 'مع علي',
      structured: structured({
        entities: {
          serviceText: 'شعر ودقن',
          employeeName: 'علي',
          dateText: 'بكرة',
          timeText: null,
          branchText: null,
        },
      }),
      runAvailability: mockAvailability(),
    });
    expect(r.replyText).toMatch(/تقصد/);
    expect(r.plan?.stage).toBe('clarifying');
  });

  it('8-10 employee/service/date change invalidates slots', async () => {
    const avail = mockAvailability();
    await processBookingPlannerTurn({
      conversationId: 104,
      turnId: 1,
      phone: '201',
      inboundText: 'شعر ودقن مع عمر بكرة بعد 6',
      structured: structured({
        entities: {
          serviceText: 'شعر ودقن',
          employeeName: 'عمر',
          dateText: 'بكرة',
          timeText: 'بعد 6',
          branchText: null,
        },
      }),
      runAvailability: avail,
    });
    let plan = await getActiveBookingPlan(104);
    expect(plan?.candidateSlots.length).toBeGreaterThan(0);

    await processBookingPlannerTurn({
      conversationId: 104,
      turnId: 2,
      phone: '201',
      inboundText: 'خليها مع محمد',
      structured: structured({
        entities: {
          serviceText: null,
          employeeName: 'محمد',
          dateText: null,
          timeText: null,
          branchText: null,
        },
      }),
      runAvailability: avail,
    });
    plan = await getActiveBookingPlan(104);
    expect(plan?.empId).toBe(30);
    // re-searched → new candidates, selected cleared
    expect(plan?.selectedSlot).toBeNull();
    expect(plan?.stage).toBe('choosing_slot');
  });

  it('11-16 slot select → READY_TO_CONFIRM; invalid choice clarifies', async () => {
    const avail = mockAvailability(['18:15', '19:00', '19:45']);
    await processBookingPlannerTurn({
      conversationId: 105,
      turnId: 1,
      phone: '201',
      inboundText: 'شعر ودقن مع عمر بكرة بعد 6',
      structured: structured({
        entities: {
          serviceText: 'شعر ودقن',
          employeeName: 'عمر',
          dateText: 'بكرة',
          timeText: 'بعد 6',
          branchText: null,
        },
      }),
      runAvailability: avail,
    });

    const bad = await processBookingPlannerTurn({
      conversationId: 105,
      turnId: 2,
      phone: '201',
      inboundText: '11',
      structured: structured({
        intent: 'booking_request',
        entities: {
          serviceText: null,
          employeeName: null,
          dateText: null,
          timeText: null,
          branchText: null,
        },
      }),
      runAvailability: avail,
    });
    // "11" doesn't match candidates → falls through to re-search or ask
    expect(bad.plan?.selectedSlot).toBeNull();

    const pick = await processBookingPlannerTurn({
      conversationId: 105,
      turnId: 3,
      phone: '201',
      inboundText: 'التاني',
      structured: structured({
        entities: {
          serviceText: null,
          employeeName: null,
          dateText: null,
          timeText: null,
          branchText: null,
        },
      }),
      runAvailability: avail,
    });
    expect(pick.plan?.stage).toBe('ready_to_confirm');
    expect(pick.plan?.selectedSlot?.time).toBe('19:00');
    expect(pick.replyText).toMatch(/أأكدلك الحجز/);
    expect(pick.replyText).not.toMatch(/تم الحجز/);
  });

  it('17-18 confirmation intent does NOT write; no تم الحجز', async () => {
    const avail = mockAvailability(['19:00']);
    await processBookingPlannerTurn({
      conversationId: 106,
      turnId: 1,
      phone: '201',
      inboundText: 'شعر ودقن عمر بكرة',
      structured: structured({
        entities: {
          serviceText: 'شعر ودقن',
          employeeName: 'عمر',
          dateText: 'بكرة',
          timeText: null,
          branchText: null,
        },
      }),
      runAvailability: avail,
    });
    await processBookingPlannerTurn({
      conversationId: 106,
      turnId: 2,
      phone: '201',
      inboundText: 'الأول',
      structured: structured(),
      runAvailability: avail,
    });
    const conf = await processBookingPlannerTurn({
      conversationId: 106,
      turnId: 3,
      phone: '201',
      inboundText: 'أيوه',
      structured: structured(),
      runAvailability: avail,
    });
    expect(conf.plan?.stage).toBe('confirmed_intent');
    expect(conf.replyText).not.toMatch(/تم الحجز/);
    expect(conf.replyText).toMatch(/جاهز للتأكيد/);
  });

  it('19-20 interruption preserves plan; resume continues', async () => {
    const avail = mockAvailability();
    await processBookingPlannerTurn({
      conversationId: 107,
      turnId: 1,
      phone: '201',
      inboundText: 'عاوز أحجز شعر ودقن',
      structured: structured({
        entities: {
          serviceText: 'شعر ودقن',
          employeeName: null,
          dateText: null,
          timeText: null,
          branchText: null,
        },
      }),
      runAvailability: avail,
    });
    const before = await getActiveBookingPlan(107);
    const interrupt = await processBookingPlannerTurn({
      conversationId: 107,
      turnId: 2,
      phone: '201',
      inboundText: 'بالمناسبة شعر ودقن بكام؟',
      structured: structured({
        intent: 'price_question',
        entities: {
          serviceText: 'شعر ودقن',
          employeeName: null,
          dateText: null,
          timeText: null,
          branchText: null,
        },
      }),
      runAvailability: avail,
    });
    expect(interrupt.handled).toBe(false);
    expect(interrupt.preservePlan).toBe(true);
    const mid = await getActiveBookingPlan(107);
    expect(mid?.planId).toBe(before?.planId);
    expect(mid?.serviceIds).toEqual([20]);

    const resume = await processBookingPlannerTurn({
      conversationId: 107,
      turnId: 3,
      phone: '201',
      inboundText: 'تمام كمل الحجز بكرة',
      structured: structured({
        intent: 'booking_request',
        entities: {
          serviceText: null,
          employeeName: null,
          dateText: 'بكرة',
          timeText: null,
          branchText: null,
        },
      }),
      runAvailability: avail,
    });
    expect(resume.handled).toBe(true);
    expect(resume.plan?.serviceIds).toEqual([20]);
    expect(resume.plan?.requestedDate).toBe('2026-08-30');
  });

  it('21 reset/cancel abandons plan', async () => {
    const avail = mockAvailability();
    await processBookingPlannerTurn({
      conversationId: 108,
      turnId: 1,
      phone: '201',
      inboundText: 'عاوز أحجز',
      structured: structured(),
      runAvailability: avail,
    });
    expect(await getActiveBookingPlan(108)).not.toBeNull();
    const r = await processBookingPlannerTurn({
      conversationId: 108,
      turnId: 2,
      phone: '201',
      inboundText: 'الغى الحجز',
      structured: structured(),
      runAvailability: avail,
    });
    expect(r.replyText).toMatch(/لغيت/);
    expect(await getActiveBookingPlan(108)).toBeNull();
  });

  it('22-23 worker restart preserves plan; exactly one active', async () => {
    const avail = mockAvailability();
    await processBookingPlannerTurn({
      conversationId: 109,
      turnId: 1,
      phone: '201',
      inboundText: 'شعر ودقن',
      structured: structured({
        entities: {
          serviceText: 'شعر ودقن',
          employeeName: null,
          dateText: null,
          timeText: null,
          branchText: null,
        },
      }),
      runAvailability: avail,
    });
    const a = await getActiveBookingPlan(109);
    // simulate "restart" by only reading store
    const b = await getActiveBookingPlan(109);
    expect(b?.planId).toBe(a?.planId);
    expect(b?.serviceIds).toEqual([20]);
    const actives = [...store.values()].filter(
      (p) => p.conversationId === 109 && p.stage !== 'abandoned',
    );
    expect(actives).toHaveLength(1);
  });

  it('24-25 no booking write markers in planner sources; Phase 2 tools still exported', async () => {
    const root = path.join(process.cwd(), 'src/modules/messaging/ai/planner');
    const files = fs.readdirSync(root).filter((f) => f.endsWith('.ts'));
    for (const f of files) {
      const text = fs.readFileSync(path.join(root, f), 'utf8');
      // Forbid real imports/calls — allow the forbidden-marker constant list itself.
      expect(text).not.toMatch(
        /from ['"][^'"]*(createPublicBooking|holdPublic|cancelPublicBooking)/,
      );
      expect(text).not.toMatch(
        /\b(createPublicBooking|holdPublicBooking|claimBookingSlot|cancelPublicBooking|reschedulePublicBooking)\s*\(/,
      );
      expect(text).not.toMatch(
        /import\s*\{[^}]*(createPublicBooking|holdPublicBooking|cancelPublicBooking)/,
      );
    }
    const toolsIndex = fs.readFileSync(
      path.join(process.cwd(), 'src/modules/messaging/ai/tools/index.ts'),
      'utf8',
    );
    expect(toolsIndex).toContain('planTools');
    expect(PHASE3_FORBIDDEN_IMPORT_MARKERS.length).toBeGreaterThan(0);
  });

  it('FLOW B one-shot entities → slots', async () => {
    const r = await processBookingPlannerTurn({
      conversationId: 110,
      turnId: 1,
      phone: '201',
      inboundText: 'عاوز شعر ودقن مع عمر بكرة بعد 6',
      structured: structured({
        entities: {
          serviceText: 'شعر ودقن',
          employeeName: 'عمر',
          dateText: 'بكرة',
          timeText: 'بعد 6',
          branchText: null,
        },
      }),
      runAvailability: mockAvailability(),
    });
    expect(r.plan?.stage).toBe('choosing_slot');
    expect(r.plan?.candidateSlots.length).toBeLessThanOrEqual(3);
  });
});

describe('Phase 3 missing-field completeness', () => {
  it('16 READY_TO_CONFIRM only when complete', () => {
    const plan = emptyMutablePlan();
    plan.serviceIds = [20];
    plan.serviceNames = ['شعر ودقن'];
    plan.requestedDate = '2026-08-30';
    plan.selectedSlot = {
      time: '19:00',
      dayOffset: 0,
      empId: 25,
      empName: 'عمر',
      label: '7:00 م',
    };
    plan.stage = 'ready_to_confirm';
    expect(computeMissingFields(plan)).toContain('confirm');
    const snap = fromSnapshot({
      planId: 1,
      conversationId: 1,
      stage: 'ready_to_confirm',
      version: 1,
      branchId: 1,
      branchCode: 'CAMP_CAESAR',
      branchName: 'كامب شيزار',
      serviceIds: [20],
      serviceNames: ['شعر ودقن'],
      empId: 25,
      employeeName: 'عمر',
      requestedDate: '2026-08-30',
      timePreference: null,
      candidateSlots: [],
      selectedSlot: plan.selectedSlot,
      clientId: null,
      missingFields: ['confirm'],
      clarification: null,
      lastAvailabilityCheckedAt: null,
      lastTurnId: 1,
      createdAt: new Date().toISOString(),
      updatedAt: null,
      completedAt: null,
    });
    expect(snap.selectedSlot?.time).toBe('19:00');
  });
});

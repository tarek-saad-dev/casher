/**
 * Phase 4 — execute a confirmed BookingPlan via existing createPublicBooking.
 * Application-owned; Gemini never calls this with arbitrary IDs.
 */
import 'server-only';
import {
  createPublicBooking,
  PublicBookingCreateError,
  type PublicBookingCreateResult,
} from '@/lib/booking/publicBookingCreate';
import { evaluatePublicBookingSelection } from '@/lib/booking/publicBookingSelectionEvaluator';
import { executeGetAvailability } from '../tools/getAvailability';
import {
  getActiveBookingPlan,
  getBookingPlanById,
  upsertBookingPlan,
} from './bookingPlanRepository';
import {
  buildPlanExecutionIdempotencyKey,
  type BookingPlanSnapshot,
  type BookingPlannerTrace,
} from './types';
import { filterSlotsByPreference } from './slotPreferences';
import {
  fromSnapshot,
  toCandidateFromAvailability,
  buildSlotChoicesReply,
} from './planState';

export type ExecuteConfirmedBookingPlanInput = {
  conversationId: number;
  planId: number;
  turnId: number;
  phone: string;
  customerName?: string | null;
  /** Inject create for tests. */
  createBooking?: typeof createPublicBooking;
  evaluateSelection?: typeof evaluatePublicBookingSelection;
  runAvailability?: typeof executeGetAvailability;
  /** System actor for internal_preview create path. */
  actorUserId?: number;
};

export type ExecuteConfirmedBookingPlanResult = {
  ok: boolean;
  plan: BookingPlanSnapshot;
  replyText: string;
  bookingId: number | null;
  bookingCode: string | null;
  errorCode: string | null;
  idempotentReplay: boolean;
  trace: BookingPlannerTrace;
};

function customerDisplayName(name: string | null | undefined, phone: string): string {
  const n = String(name ?? '').trim();
  if (n.length >= 2) return n.slice(0, 80);
  const tail = phone.replace(/\D/g, '').slice(-4);
  return `عميل واتساب ${tail || 'جديد'}`.slice(0, 80);
}

function buildBookedReply(plan: BookingPlanSnapshot, bookingCode: string | null): string {
  const service = plan.serviceNames[0] || 'الخدمة';
  const emp = plan.employeeName || 'الفني';
  const branch = plan.branchName || plan.branchCode || '';
  const date = plan.requestedDate || '';
  const time = plan.selectedSlot?.label || plan.selectedSlot?.time || '';
  const codeLine = bookingCode ? `\nرقم الحجز: ${bookingCode}` : '';
  return [
    'تم الحجز يا باشا ✅',
    `${service} مع ${emp}`,
    branch,
    `${date} الساعة ${time}${codeLine}`,
  ]
    .filter(Boolean)
    .join('\n');
}

function isSlotConflictCode(code: string): boolean {
  return (
    /SLOT|UNAVAILABLE|CONFLICT|BUSY|ALREADY|TAKEN|OVERLAP|INTERVAL/i.test(code) ||
    code === 'EMPLOYEE_BUSY' ||
    code === 'NO_AVAILABLE_SLOT' ||
    code === 'MIN_NOTICE_NOT_MET'
  );
}

/**
 * Convert confirmed_intent plan into one real booking via createPublicBooking.
 */
export async function executeConfirmedBookingPlan(
  input: ExecuteConfirmedBookingPlanInput,
): Promise<ExecuteConfirmedBookingPlanResult> {
  const started = performance.now();
  const create = input.createBooking ?? createPublicBooking;
  const evaluate = input.evaluateSelection ?? evaluatePublicBookingSelection;
  const runAvailability = input.runAvailability ?? executeGetAvailability;
  const actorUserId = input.actorUserId ?? Number(process.env.AI_BOOKING_ACTOR_USER_ID || 1);

  let plan =
    (await getBookingPlanById(input.planId)) ??
    (await getActiveBookingPlan(input.conversationId));

  const emptyTrace = (stageBefore: BookingPlannerTrace['stageBefore']): BookingPlannerTrace => ({
    conversationId: input.conversationId,
    planId: plan?.planId ?? input.planId,
    stageBefore,
    stageAfter: plan?.stage ?? 'none',
    extracted: {},
    validatedChanges: [],
    invalidatedFields: [],
    toolCalls: [],
    missingFields: plan?.missingFields ?? [],
    candidateSlotCount: plan?.candidateSlots.length ?? 0,
    selectedSlot: plan?.selectedSlot ?? null,
    deterministicAction: 'execute_booking',
  });

  if (!plan || plan.conversationId !== input.conversationId) {
    const trace = emptyTrace('none');
    return {
      ok: false,
      plan: plan!,
      replyText: 'مفيش خطة حجز جاهزة للتأكيد دلوقتي.',
      bookingId: null,
      bookingCode: null,
      errorCode: 'PLAN_NOT_FOUND',
      idempotentReplay: false,
      trace,
    };
  }

  // Idempotent: already booked
  if (plan.stage === 'booked' && plan.bookingId) {
    const trace = emptyTrace(plan.stage);
    trace.stageAfter = 'booked';
    trace.execution = {
      idempotencyKey: plan.idempotencyKey,
      bookingId: plan.bookingId,
      bookingCode: plan.bookingCode,
      revalidationOk: true,
    };
    trace.deterministicAction = 'execute_idempotent_replay';
    return {
      ok: true,
      plan,
      replyText: buildBookedReply(plan, plan.bookingCode),
      bookingId: plan.bookingId,
      bookingCode: plan.bookingCode,
      errorCode: null,
      idempotentReplay: true,
      trace,
    };
  }

  if (
    plan.stage !== 'confirmed_intent' &&
    plan.stage !== 'ready_to_confirm' &&
    plan.stage !== 'execution_failed'
  ) {
    const trace = emptyTrace(plan.stage);
    return {
      ok: false,
      plan,
      replyText: 'لسه محتاجين نكمّل تفاصيل الحجز قبل التأكيد.',
      bookingId: null,
      bookingCode: null,
      errorCode: 'PLAN_NOT_CONFIRMED',
      idempotentReplay: false,
      trace,
    };
  }

  const incomplete =
    !plan.branchCode ||
    !plan.serviceIds.length ||
    !plan.requestedDate ||
    !plan.selectedSlot?.time ||
    !input.phone?.trim();

  if (incomplete) {
    const trace = emptyTrace(plan.stage);
    return {
      ok: false,
      plan,
      replyText: 'بيانات الحجز ناقصة ومقدرش أسجّله. نبدأ من الأول؟',
      bookingId: null,
      bookingCode: null,
      errorCode: 'PLAN_INCOMPLETE',
      idempotentReplay: false,
      trace,
    };
  }

  const priorIdempotencyKey = plan.idempotencyKey;
  const idempotencyKey =
    priorIdempotencyKey || buildPlanExecutionIdempotencyKey(plan.planId, plan.version);

  plan = await upsertBookingPlan({
    conversationId: plan.conversationId,
    planId: plan.planId,
    stage: 'executing',
    version: plan.version + 1,
    branchId: plan.branchId,
    branchCode: plan.branchCode,
    branchName: plan.branchName,
    serviceIds: plan.serviceIds,
    serviceNames: plan.serviceNames,
    empId: plan.empId,
    employeeName: plan.employeeName,
    requestedDate: plan.requestedDate,
    timePreference: plan.timePreference,
    candidateSlots: plan.candidateSlots,
    selectedSlot: plan.selectedSlot,
    clientId: plan.clientId,
    missingFields: [],
    clarification: null,
    lastAvailabilityCheckedAt: plan.lastAvailabilityCheckedAt,
    lastTurnId: input.turnId,
    bookingId: plan.bookingId,
    bookingCode: plan.bookingCode,
    idempotencyKey,
    executionErrorCode: null,
    trace: { deterministicAction: 'execute_start', idempotencyKey },
  });

  const trace = emptyTrace('confirmed_intent');
  trace.planId = plan.planId;
  trace.deterministicAction = 'execute_booking';
  trace.execution = { idempotencyKey };

  const buildCreateInput = (planToken: string | null | undefined) => ({
    branchCode: plan!.branchCode,
    date: plan!.requestedDate,
    time: plan!.selectedSlot!.time,
    dayOffset: plan!.selectedSlot!.dayOffset ?? 0,
    serviceIds: plan!.serviceIds,
    empId: plan!.empId,
    mode: (plan!.empId ? 'specific_barber' : 'any_barber') as
      | 'specific_barber'
      | 'any_barber',
    planToken: planToken ?? undefined,
    customer: {
      name: customerDisplayName(input.customerName, input.phone),
      phone: input.phone,
    },
    clientRequestId: idempotencyKey,
    purpose: 'internal_preview' as const,
    auth: { userId: actorUserId, canOperate: true },
    bookingSource: 'operations' as const,
    leadSource: 'whatsapp' as const,
    suppressNotification: true,
    notes: `whatsapp-bot-plan:${plan!.planId}`,
  });

  const finalizeBooked = async (
    result: PublicBookingCreateResult,
    createStarted: number,
    idempotentReplay: boolean,
  ): Promise<ExecuteConfirmedBookingPlanResult> => {
    const booking = result.body.booking as {
      id?: number;
      bookingId?: number;
      code?: string;
    };
    const bookingId = Number(booking.id ?? booking.bookingId);
    const bookingCode = booking.code ? String(booking.code) : null;
    trace.toolCalls.push({
      name: 'createPublicBooking',
      ok: true,
      durationMs: Math.round(performance.now() - createStarted),
      errorCode: null,
    });
    trace.execution = {
      idempotencyKey,
      bookingId,
      bookingCode,
      revalidationOk: true,
    };

    const booked = await upsertBookingPlan({
      conversationId: plan!.conversationId,
      planId: plan!.planId,
      stage: 'booked',
      version: plan!.version + 1,
      branchId: plan!.branchId,
      branchCode: plan!.branchCode,
      branchName: plan!.branchName,
      serviceIds: plan!.serviceIds,
      serviceNames: plan!.serviceNames,
      empId: plan!.empId,
      employeeName: plan!.employeeName,
      requestedDate: plan!.requestedDate,
      timePreference: plan!.timePreference,
      candidateSlots: plan!.candidateSlots,
      selectedSlot: plan!.selectedSlot,
      clientId: plan!.clientId,
      missingFields: [],
      clarification: null,
      lastAvailabilityCheckedAt: plan!.lastAvailabilityCheckedAt,
      lastTurnId: input.turnId,
      bookingId,
      bookingCode,
      idempotencyKey,
      executionErrorCode: null,
      completedAt: new Date().toISOString(),
      trace: { ...trace, stageAfter: 'booked' },
    });
    trace.stageAfter = 'booked';
    console.log(
      JSON.stringify({
        type: 'messaging_booking_execution_trace',
        planId: booked.planId,
        bookingId,
        bookingCode,
        idempotencyKey,
        idempotentReplay,
        durationMs: Math.round(performance.now() - started),
      }),
    );
    return {
      ok: true,
      plan: booked,
      replyText: buildBookedReply(booked, bookingCode),
      bookingId,
      bookingCode,
      errorCode: null,
      idempotentReplay,
      trace,
    };
  };

  // Prior key may already have committed (e.g. post-commit after() threw). Recover first.
  if (priorIdempotencyKey) {
    try {
      const createStarted = performance.now();
      const result = await create(buildCreateInput(null));
      if (result.body.ok && result.body.booking) {
        return finalizeBooked(
          result,
          createStarted,
          Boolean(result.body.meta?.idempotentReplay) || true,
        );
      }
    } catch (err) {
      const code =
        err instanceof PublicBookingCreateError
          ? err.code
          : err instanceof Error && 'code' in err
            ? String((err as { code?: string }).code)
            : 'IDEMPOTENCY_RECOVERY_MISS';
      trace.toolCalls.push({
        name: 'createPublicBooking_recovery',
        ok: false,
        durationMs: 0,
        errorCode: code,
      });
    }
  }

  let planToken: string | null = null;
  try {
    const evalStarted = performance.now();
    const evaluation = await evaluate({
      branchCode: plan.branchCode!,
      date: plan.requestedDate!,
      time: plan.selectedSlot!.time,
      dayOffset: plan.selectedSlot!.dayOffset ?? 0,
      serviceIds: plan.serviceIds,
      empId: plan.empId,
      mode: plan.empId ? 'specific_barber' : 'any_barber',
      purpose: 'internal_preview',
      auth: { userId: actorUserId, canOperate: true },
    });
    trace.toolCalls.push({
      name: 'evaluate_selection',
      ok: evaluation.available,
      durationMs: Math.round(performance.now() - evalStarted),
      errorCode: evaluation.available ? null : evaluation.availabilityCode,
    });
    trace.execution!.revalidationOk = evaluation.available;
    if (!evaluation.available) {
      const avail = await runAvailability({
        name: 'get_availability',
        branchCode: plan.branchCode,
        serviceIds: plan.serviceIds,
        empId: plan.empId,
        dateText: plan.requestedDate,
      });
      const raw = (
        (avail.data as {
          slots?: Array<{
            time: string;
            dayOffset?: 0 | 1;
            empId?: number | null;
            empName?: string | null;
          }>;
        })?.slots ?? []
      ).map(toCandidateFromAvailability);
      const shortlist = filterSlotsByPreference(raw, plan.timePreference, 3);
      const updated = await upsertBookingPlan({
        conversationId: plan.conversationId,
        planId: plan.planId,
        stage: 'choosing_slot',
        version: plan.version + 1,
        branchId: plan.branchId,
        branchCode: plan.branchCode,
        branchName: plan.branchName,
        serviceIds: plan.serviceIds,
        serviceNames: plan.serviceNames,
        empId: plan.empId,
        employeeName: plan.employeeName,
        requestedDate: plan.requestedDate,
        timePreference: plan.timePreference,
        candidateSlots: shortlist,
        selectedSlot: null,
        clientId: plan.clientId,
        missingFields: ['slot_choice'],
        clarification: null,
        lastAvailabilityCheckedAt: new Date().toISOString(),
        lastTurnId: input.turnId,
        bookingId: null,
        bookingCode: null,
        idempotencyKey,
        executionErrorCode: evaluation.availabilityCode || 'SLOT_UNAVAILABLE',
        trace: { ...trace, stageAfter: 'choosing_slot' },
      });
      const reply = shortlist.length
        ? `المعاد ده اتاخد للأسف، المتاح دلوقتي:\n${buildSlotChoicesReply(fromSnapshot(updated))}`
        : 'المعاد ده مش متاح دلوقتي ومفيش بدائل قريبة. تحب يوم أو وقت تاني؟';
      trace.stageAfter = 'choosing_slot';
      console.log(
        JSON.stringify({
          type: 'messaging_booking_execution_trace',
          ...trace,
          durationMs: Math.round(performance.now() - started),
        }),
      );
      return {
        ok: false,
        plan: updated,
        replyText: reply,
        bookingId: null,
        bookingCode: null,
        errorCode: evaluation.availabilityCode || 'SLOT_UNAVAILABLE',
        idempotentReplay: false,
        trace,
      };
    }
    planToken = evaluation.planToken;
  } catch (err) {
    const code =
      err instanceof Error && 'code' in err
        ? String((err as { code?: string }).code)
        : 'REVALIDATION_FAILED';
    trace.toolCalls.push({
      name: 'evaluate_selection',
      ok: false,
      durationMs: 0,
      errorCode: code,
    });
    const failed = await upsertBookingPlan({
      conversationId: plan.conversationId,
      planId: plan.planId,
      stage: 'execution_failed',
      version: plan.version + 1,
      branchId: plan.branchId,
      branchCode: plan.branchCode,
      branchName: plan.branchName,
      serviceIds: plan.serviceIds,
      serviceNames: plan.serviceNames,
      empId: plan.empId,
      employeeName: plan.employeeName,
      requestedDate: plan.requestedDate,
      timePreference: plan.timePreference,
      candidateSlots: plan.candidateSlots,
      selectedSlot: plan.selectedSlot,
      clientId: plan.clientId,
      missingFields: ['confirm'],
      clarification: null,
      lastAvailabilityCheckedAt: plan.lastAvailabilityCheckedAt,
      lastTurnId: input.turnId,
      bookingId: null,
      bookingCode: null,
      idempotencyKey,
      executionErrorCode: code,
      trace: { ...trace, stageAfter: 'execution_failed' },
    });
    const recoverable = await upsertBookingPlan({
      conversationId: failed.conversationId,
      planId: failed.planId,
      stage: 'ready_to_confirm',
      version: failed.version + 1,
      branchId: failed.branchId,
      branchCode: failed.branchCode,
      branchName: failed.branchName,
      serviceIds: failed.serviceIds,
      serviceNames: failed.serviceNames,
      empId: failed.empId,
      employeeName: failed.employeeName,
      requestedDate: failed.requestedDate,
      timePreference: failed.timePreference,
      candidateSlots: failed.candidateSlots,
      selectedSlot: failed.selectedSlot,
      clientId: failed.clientId,
      missingFields: ['confirm'],
      clarification: null,
      lastAvailabilityCheckedAt: failed.lastAvailabilityCheckedAt,
      lastTurnId: input.turnId,
      bookingId: null,
      bookingCode: null,
      idempotencyKey,
      executionErrorCode: code,
      trace: { ...trace, stageAfter: 'ready_to_confirm' },
    });
    trace.stageAfter = 'ready_to_confirm';
    return {
      ok: false,
      plan: recoverable,
      replyText:
        'حصلت مشكلة وأنا بأكد الحجز وماتسجلش. جرّب تاني أو أكلمك مع الاستقبال.',
      bookingId: null,
      bookingCode: null,
      errorCode: code,
      idempotentReplay: false,
      trace,
    };
  }

  try {
    const createStarted = performance.now();
    const result: PublicBookingCreateResult = await create(buildCreateInput(planToken));
    return finalizeBooked(result, createStarted, Boolean(result.body.meta?.idempotentReplay));
  } catch (err) {
    // Commit may have succeeded while post-commit notify threw — recover via key.
    try {
      const recoverStarted = performance.now();
      const recovered = await create(buildCreateInput(null));
      if (recovered.body.ok && recovered.body.booking) {
        return finalizeBooked(recovered, recoverStarted, true);
      }
    } catch {
      /* continue failure path */
    }

    const code =
      err instanceof PublicBookingCreateError
        ? err.code
        : err instanceof Error && 'code' in err
          ? String((err as { code?: string }).code)
          : 'BOOKING_CREATE_FAILED';
    trace.toolCalls.push({
      name: 'createPublicBooking',
      ok: false,
      durationMs: 0,
      errorCode: code,
    });
    trace.execution = { idempotencyKey, errorCode: code, revalidationOk: true };

    if (isSlotConflictCode(code)) {
      const avail = await runAvailability({
        name: 'get_availability',
        branchCode: plan.branchCode,
        serviceIds: plan.serviceIds,
        empId: plan.empId,
        dateText: plan.requestedDate,
      });
      const raw = (
        (avail.data as {
          slots?: Array<{
            time: string;
            dayOffset?: 0 | 1;
            empId?: number | null;
            empName?: string | null;
          }>;
        })?.slots ?? []
      ).map(toCandidateFromAvailability);
      const shortlist = filterSlotsByPreference(raw, plan.timePreference, 3);
      const updated = await upsertBookingPlan({
        conversationId: plan.conversationId,
        planId: plan.planId,
        stage: 'choosing_slot',
        version: plan.version + 1,
        branchId: plan.branchId,
        branchCode: plan.branchCode,
        branchName: plan.branchName,
        serviceIds: plan.serviceIds,
        serviceNames: plan.serviceNames,
        empId: plan.empId,
        employeeName: plan.employeeName,
        requestedDate: plan.requestedDate,
        timePreference: plan.timePreference,
        candidateSlots: shortlist,
        selectedSlot: null,
        clientId: plan.clientId,
        missingFields: ['slot_choice'],
        clarification: null,
        lastAvailabilityCheckedAt: new Date().toISOString(),
        lastTurnId: input.turnId,
        bookingId: null,
        bookingCode: null,
        idempotencyKey,
        executionErrorCode: code,
        trace: { ...trace, stageAfter: 'choosing_slot' },
      });
      trace.stageAfter = 'choosing_slot';
      return {
        ok: false,
        plan: updated,
        replyText: shortlist.length
          ? `المعاد ده اتاخد للأسف، المتاح دلوقتي:\n${buildSlotChoicesReply(fromSnapshot(updated))}`
          : 'المعاد ده مش متاح دلوقتي. تحب نختار يوم أو وقت تاني؟',
        bookingId: null,
        bookingCode: null,
        errorCode: code,
        idempotentReplay: false,
        trace,
      };
    }

    const recoverable = await upsertBookingPlan({
      conversationId: plan.conversationId,
      planId: plan.planId,
      stage: 'ready_to_confirm',
      version: plan.version + 1,
      branchId: plan.branchId,
      branchCode: plan.branchCode,
      branchName: plan.branchName,
      serviceIds: plan.serviceIds,
      serviceNames: plan.serviceNames,
      empId: plan.empId,
      employeeName: plan.employeeName,
      requestedDate: plan.requestedDate,
      timePreference: plan.timePreference,
      candidateSlots: plan.candidateSlots,
      selectedSlot: plan.selectedSlot,
      clientId: plan.clientId,
      missingFields: ['confirm'],
      clarification: null,
      lastAvailabilityCheckedAt: plan.lastAvailabilityCheckedAt,
      lastTurnId: input.turnId,
      bookingId: null,
      bookingCode: null,
      idempotencyKey,
      executionErrorCode: code,
      trace: { ...trace, stageAfter: 'ready_to_confirm' },
    });
    trace.stageAfter = 'ready_to_confirm';
    console.log(
      JSON.stringify({
        type: 'messaging_booking_execution_trace',
        planId: plan.planId,
        errorCode: code,
        durationMs: Math.round(performance.now() - started),
      }),
    );
    return {
      ok: false,
      plan: recoverable,
      replyText:
        'حصلت مشكلة وأنا بأكد الحجز وماتسجلش. جرّب تاني أو أكلمك مع الاستقبال.',
      bookingId: null,
      bookingCode: null,
      errorCode: code,
      idempotentReplay: false,
      trace,
    };
  }
}

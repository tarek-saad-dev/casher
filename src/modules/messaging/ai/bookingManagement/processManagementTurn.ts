/**
 * Booking Management turn processor — lookup / cancel / modify preview+confirm.
 * Flag-gated. Writes only via cancelPublicBooking / reschedulePublicBooking after confirmation.
 */
import 'server-only';
import { listPublicUpcomingBookings } from '@/lib/booking/publicBookingReader';
import { cancelPublicBooking } from '@/lib/booking/publicBookingCancellation';
import {
  previewPublicBookingReschedule,
  reschedulePublicBooking,
  PublicBookingRescheduleError,
} from '@/lib/booking/publicBookingReschedule';
import { resolveBranchByText, resolveEmployeeByText } from '../planner/resolveEntities';
import { isBookingManagementActiveForPhone } from './featureFlag';
import { detectBookingManagementSpeech } from './detectSpeech';
import { parseManagementDeltas } from './parseManagementDeltas';
import { buildDesiredBookingState } from './desiredState';
import {
  parseBookingSelectionOrdinal,
  resolveBookingTarget,
} from './targetResolver';
import {
  composeBookingClarifyReply,
  composeCancelPreviewReply,
  composeCancelSuccessReply,
  composeModifyPreviewReply,
  composeModifySuccessReply,
  composeUnavailableModifyReply,
  composeUpcomingLookupReply,
  summarizePublicBooking,
} from './responseCopy';
import {
  getActiveManagementPlan,
  upsertManagementPlan,
} from './managementPlanRepository';
import {
  buildManagementIdempotencyKey,
  type BookingManagementPlanSnapshot,
  type DesiredBookingChanges,
  type UpcomingBookingSummary,
} from './types';
import { logBookingManagementEvent } from './observability';
import {
  getSessionMemory,
  recordBotAction,
} from '../conversationOrchestrator/sessionMemory';

export type ManagementTurnResult = {
  handled: boolean;
  replyText: string | null;
  preserveCreatePlan: boolean;
  askConfirm: boolean;
  planId: number | null;
};

async function loadUpcoming(phone: string): Promise<UpcomingBookingSummary[]> {
  const result = await listPublicUpcomingBookings({ phone, limit: 10 });
  return result.bookings.map((dto) => summarizePublicBooking(dto, null));
}

function isAffirmative(text: string): boolean {
  return /^(اه|أيوه|ايوه|أيوا|ايوا|تمام|أكد|اكد|ماشي|نعم|yes|ok)$/i.test(
    String(text).trim(),
  );
}

export async function processBookingManagementTurn(input: {
  conversationId: number;
  turnId: number;
  phone: string;
  inboundText: string;
  controlAllowsMutation: boolean;
}): Promise<ManagementTurnResult | null> {
  if (!isBookingManagementActiveForPhone(input.phone)) return null;

  const speech = detectBookingManagementSpeech(input.inboundText);
  const session = getSessionMemory(input.conversationId);
  const active = await getActiveManagementPlan(input.conversationId);

  if (
    active &&
    active.stage === 'READY_TO_CONFIRM' &&
    isAffirmative(input.inboundText) &&
    session.lastBotAction === 'ask_management_confirm' &&
    session.pendingConfirmPlanId === active.planId &&
    session.pendingConfirmVersion === active.confirmationVersion
  ) {
    if (!input.controlAllowsMutation) {
      return {
        handled: true,
        replyText: null,
        preserveCreatePlan: true,
        askConfirm: false,
        planId: active.planId,
      };
    }
    if (active.operation === 'CANCEL') {
      return executeCancelConfirm(input, active);
    }
    if (active.operation === 'MODIFY') {
      return executeModifyConfirm(input, active);
    }
  }

  if (speech.kind === 'none' && !active) return null;

  // Ephemeral interruption: bail so V4 can answer hours/price; clears confirm via sessionMemory
  if (speech.kind === 'none' && active) {
    const ordinal = parseBookingSelectionOrdinal(input.inboundText);
    if (ordinal == null && active.stage !== 'RESOLVING_BOOKING') {
      return null;
    }
  }

  logBookingManagementEvent('booking_management_started', {
    conversationId: input.conversationId,
    turnId: input.turnId,
    speech: speech.kind,
  });

  let upcoming: UpcomingBookingSummary[];
  try {
    upcoming = await loadUpcoming(input.phone);
  } catch {
    return {
      handled: true,
      replyText: 'مش قادر أتأكد من الحجوزات دلوقتي. ممكن نجرب تاني بعد شوية.',
      preserveCreatePlan: true,
      askConfirm: false,
      planId: null,
    };
  }

  if (speech.kind === 'lookup_upcoming') {
    const reply = composeUpcomingLookupReply(upcoming);
    if (upcoming.length === 1) {
      const b = upcoming[0]!;
      session.lastRelevantBooking = {
        bookingId: b.bookingId,
        bookingCode: b.bookingCode,
        snapshot: b,
        lastReferencedAt: new Date().toISOString(),
      };
    }
    recordBotAction(input.conversationId, {
      text: reply,
      action: 'answered_query',
      answeredWell: true,
      customerText: input.inboundText,
    });
    return {
      handled: true,
      replyText: reply,
      preserveCreatePlan: true,
      askConfirm: false,
      planId: null,
    };
  }

  if (speech.kind === 'cancel' || (active?.operation === 'CANCEL' && speech.kind === 'none')) {
    return handleCancelSpeech(input, upcoming, active);
  }

  if (speech.kind === 'modify' || (active?.operation === 'MODIFY' && speech.kind === 'none')) {
    return handleModifySpeech(input, upcoming, active);
  }

  return null;
}

async function handleCancelSpeech(
  input: {
    conversationId: number;
    turnId: number;
    phone: string;
    inboundText: string;
    controlAllowsMutation: boolean;
  },
  upcoming: UpcomingBookingSummary[],
  active: BookingManagementPlanSnapshot | null,
): Promise<ManagementTurnResult> {
  const session = getSessionMemory(input.conversationId);
  if (!input.controlAllowsMutation && detectBookingManagementSpeech(input.inboundText).kind === 'cancel') {
    return {
      handled: true,
      replyText: null,
      preserveCreatePlan: true,
      askConfirm: false,
      planId: null,
    };
  }

  const pendingCodes = session.pendingBookingSelection?.candidateBookingCodes ?? null;
  const ordinal = parseBookingSelectionOrdinal(input.inboundText);
  const resolved = resolveBookingTarget({
    upcoming,
    referenceText: input.inboundText,
    lastRelevant: session.lastRelevantBooking ?? null,
    pendingCandidateCodes: pendingCodes,
    ordinalOneBased: ordinal,
  });

  if (resolved.kind === 'none') {
    return {
      handled: true,
      replyText: composeUpcomingLookupReply([]),
      preserveCreatePlan: true,
      askConfirm: false,
      planId: null,
    };
  }

  if (resolved.kind === 'clarify') {
    const reply = composeBookingClarifyReply(resolved.candidates);
    session.pendingBookingSelection = {
      expectedAnswerType: 'BOOKING_SELECTION',
      candidateBookingCodes: resolved.candidates.map((c) => c.bookingCode),
      askedAt: new Date().toISOString(),
    };
    const plan = await upsertManagementPlan({
      conversationId: input.conversationId,
      operation: 'CANCEL',
      stage: 'RESOLVING_BOOKING',
      lastTurnId: input.turnId,
      candidateAlternatives: resolved.candidates,
    });
    recordBotAction(input.conversationId, {
      text: reply,
      action: 'ask_missing_field',
      answeredWell: true,
      customerText: input.inboundText,
    });
    return {
      handled: true,
      replyText: reply,
      preserveCreatePlan: true,
      askConfirm: false,
      planId: plan.planId,
    };
  }

  const target = resolved.booking;
  session.pendingBookingSelection = null;
  session.lastRelevantBooking = {
    bookingId: target.bookingId,
    bookingCode: target.bookingCode,
    snapshot: target,
    lastReferencedAt: new Date().toISOString(),
  };

  if (!target.canCancel) {
    return {
      handled: true,
      replyText:
        'الحجز ده مش متاح للإلغاء من واتساب حاليًا. لو محتاج مساعدة، قولي وأحوّلك للاستقبال.',
      preserveCreatePlan: true,
      askConfirm: false,
      planId: null,
    };
  }

  const confirmationVersion = (active?.confirmationVersion ?? 0) + 1;
  const plan = await upsertManagementPlan({
    conversationId: input.conversationId,
    planId: active?.planId,
    operation: 'CANCEL',
    stage: 'READY_TO_CONFIRM',
    targetBookingId: target.bookingId,
    targetBookingCode: target.bookingCode,
    originalSnapshot: target,
    confirmationVersion,
    lastTurnId: input.turnId,
    idempotencyKey: null,
  });

  const reply = composeCancelPreviewReply(target);
  session.pendingConfirmPlanId = plan.planId;
  session.pendingConfirmVersion = plan.confirmationVersion;
  recordBotAction(input.conversationId, {
    text: reply,
    action: 'ask_management_confirm',
    answeredWell: true,
    customerText: input.inboundText,
    planId: plan.planId,
    planVersion: plan.confirmationVersion,
  });
  logBookingManagementEvent('booking_management_previewed', {
    conversationId: input.conversationId,
    planId: plan.planId,
    operation: 'CANCEL',
    bookingCode: target.bookingCode,
  });

  return {
    handled: true,
    replyText: reply,
    preserveCreatePlan: true,
    askConfirm: true,
    planId: plan.planId,
  };
}

async function handleModifySpeech(
  input: {
    conversationId: number;
    turnId: number;
    phone: string;
    inboundText: string;
    controlAllowsMutation: boolean;
  },
  upcoming: UpcomingBookingSummary[],
  active: BookingManagementPlanSnapshot | null,
): Promise<ManagementTurnResult> {
  const session = getSessionMemory(input.conversationId);
  if (!input.controlAllowsMutation) {
    return {
      handled: true,
      replyText: null,
      preserveCreatePlan: true,
      askConfirm: false,
      planId: null,
    };
  }

  const pendingCodes = session.pendingBookingSelection?.candidateBookingCodes ?? null;
  const ordinal = parseBookingSelectionOrdinal(input.inboundText);
  const resolved = resolveBookingTarget({
    upcoming,
    referenceText: input.inboundText,
    lastRelevant: session.lastRelevantBooking ?? null,
    pendingCandidateCodes: pendingCodes,
    ordinalOneBased: ordinal,
  });

  if (resolved.kind === 'none') {
    return {
      handled: true,
      replyText: composeUpcomingLookupReply([]),
      preserveCreatePlan: true,
      askConfirm: false,
      planId: null,
    };
  }

  if (resolved.kind === 'clarify') {
    const reply = composeBookingClarifyReply(resolved.candidates);
    session.pendingBookingSelection = {
      expectedAnswerType: 'BOOKING_SELECTION',
      candidateBookingCodes: resolved.candidates.map((c) => c.bookingCode),
      askedAt: new Date().toISOString(),
    };
    const plan = await upsertManagementPlan({
      conversationId: input.conversationId,
      operation: 'MODIFY',
      stage: 'RESOLVING_BOOKING',
      lastTurnId: input.turnId,
      candidateAlternatives: resolved.candidates,
    });
    recordBotAction(input.conversationId, {
      text: reply,
      action: 'ask_missing_field',
      answeredWell: true,
      customerText: input.inboundText,
    });
    return {
      handled: true,
      replyText: reply,
      preserveCreatePlan: true,
      askConfirm: false,
      planId: plan.planId,
    };
  }

  const target = resolved.booking;
  session.pendingBookingSelection = null;
  session.lastRelevantBooking = {
    bookingId: target.bookingId,
    bookingCode: target.bookingCode,
    snapshot: target,
    lastReferencedAt: new Date().toISOString(),
  };

  const parsed = parseManagementDeltas(input.inboundText, target.time);
  if (!parsed.hasAnyDelta) {
    return {
      handled: true,
      replyText:
        'تمام — قولي عايز تغيّر إيه: الميعاد، الموظف، أو الفرع، وأأكد معاك قبل أي تعديل.',
      preserveCreatePlan: true,
      askConfirm: false,
      planId: active?.planId ?? null,
    };
  }

  if (parsed.serviceTextHint) {
    return {
      handled: true,
      replyText:
        'تغيير الخدمات من واتساب لسه بيتفعّل بحذر. قولي التفاصيل وأحوّلك للاستقبال لو محتاجين نعدّل الخدمات.',
      preserveCreatePlan: true,
      askConfirm: false,
      planId: null,
    };
  }

  const changes: DesiredBookingChanges = { ...parsed.changes };
  let branchName = target.branchName;
  let branchCode = target.branchCode;

  if (parsed.branchNameHint) {
    const br = await resolveBranchByText(parsed.branchNameHint);
    if (br.ambiguous.length > 1) {
      return {
        handled: true,
        replyText: 'قصدك أنهي فرع؟ قولي الاسم أوضح.',
        preserveCreatePlan: true,
        askConfirm: false,
        planId: null,
      };
    }
    if (!br.branchCode) {
      return {
        handled: true,
        replyText: 'مش لاقي الفرع ده. قولي جليم أو كامب مثلًا.',
        preserveCreatePlan: true,
        askConfirm: false,
        planId: null,
      };
    }
    changes.branchCode = br.branchCode;
    branchCode = br.branchCode;
    branchName = br.branchName;
  }

  if (parsed.employeeNameHint) {
    const emp = await resolveEmployeeByText({
      branchCode: branchCode || target.branchCode || '',
      employeeName: parsed.employeeNameHint,
      date: changes.date ?? target.workDate,
    });
    if (!emp.ok) {
      if (emp.errorCode === 'EMPLOYEE_AMBIGUOUS') {
        return {
          handled: true,
          replyText: 'في أكتر من موظف بنفس الاسم تقريبًا — قولي الاسم أوضح.',
          preserveCreatePlan: true,
          askConfirm: false,
          planId: null,
        };
      }
      return {
        handled: true,
        replyText: `مش لاقي ${parsed.employeeNameHint} على الفرع ده للميعاد المطلوب.`,
        preserveCreatePlan: true,
        askConfirm: false,
        planId: null,
      };
    }
    if (emp.employee) {
      changes.empId = emp.employee.empId;
      changes.employeeName = emp.employee.name;
    }
  }

  const desired = buildDesiredBookingState(target, changes);
  if (!desired.workDate || !desired.time || !desired.empId || !desired.branchCode) {
    return {
      handled: true,
      replyText: 'محتاج تفاصيل أوضح للتعديل (ميعاد وموظف وفرع).',
      preserveCreatePlan: true,
      askConfirm: false,
      planId: null,
    };
  }

  const serviceIds =
    target.serviceIds && target.serviceIds.length > 0 ? target.serviceIds : [];
  if (!serviceIds.length) {
    return {
      handled: true,
      replyText: 'مش قادر أقرأ خدمات الحجز دلوقتي. ممكن نجرب تاني بعد شوية.',
      preserveCreatePlan: true,
      askConfirm: false,
      planId: null,
    };
  }

  let preview;
  try {
    preview = await previewPublicBookingReschedule({
      code: target.bookingCode,
      phone: input.phone,
      desired: {
        workDate: desired.workDate,
        time: desired.time,
        empId: desired.empId,
        branchCode: desired.branchCode,
        serviceIds,
      },
    });
  } catch {
    return {
      handled: true,
      replyText: 'مش قادر أتأكد من الميعاد دلوقتي. ممكن نجرب تاني بعد شوية.',
      preserveCreatePlan: true,
      askConfirm: false,
      planId: null,
    };
  }

  if (!preview.ok) {
    const next = preview.validation?.nextAvailable;
    let hint: string | null = null;
    if (next?.startAt) {
      const t = new Date(next.startAt);
      const hh = String(t.getUTCHours()).padStart(2, '0'); // may be wrong TZ — use ISO slice
      hint = `أقرب حاجة متاحة حوالي ${next.startAt.slice(11, 16)}.`;
    }
    const reply = composeUnavailableModifyReply({
      employeeName: desired.employeeName,
      requestedTime: desired.time,
      nextAvailableHint: hint,
    });
    logBookingManagementEvent('booking_management_conflict', {
      conversationId: input.conversationId,
      bookingCode: target.bookingCode,
      code: preview.code,
    });
    return {
      handled: true,
      replyText: reply,
      preserveCreatePlan: true,
      askConfirm: false,
      planId: null,
    };
  }

  const confirmationVersion = (active?.confirmationVersion ?? 0) + 1;
  const validatedDesiredState = {
    workDate: desired.workDate,
    time: desired.time,
    empId: desired.empId,
    employeeName: desired.employeeName,
    branchCode: desired.branchCode,
    branchName: branchName ?? desired.branchName,
    serviceIds,
  };

  const plan = await upsertManagementPlan({
    conversationId: input.conversationId,
    planId: active?.planId,
    operation: 'MODIFY',
    stage: 'READY_TO_CONFIRM',
    targetBookingId: target.bookingId,
    targetBookingCode: target.bookingCode,
    originalSnapshot: target,
    desiredChanges: changes,
    validatedDesiredState,
    confirmationVersion,
    lastTurnId: input.turnId,
  });

  const reply = composeModifyPreviewReply({
    original: target,
    desired: {
      workDate: desired.workDate,
      time: desired.time,
      employeeName: desired.employeeName,
      branchName: branchName ?? desired.branchName,
    },
  });

  session.pendingConfirmPlanId = plan.planId;
  session.pendingConfirmVersion = plan.confirmationVersion;
  recordBotAction(input.conversationId, {
    text: reply,
    action: 'ask_management_confirm',
    answeredWell: true,
    customerText: input.inboundText,
    planId: plan.planId,
    planVersion: plan.confirmationVersion,
  });
  logBookingManagementEvent('booking_management_previewed', {
    conversationId: input.conversationId,
    planId: plan.planId,
    operation: 'MODIFY',
    bookingCode: target.bookingCode,
  });
  logBookingManagementEvent('booking_management_confirmation_requested', {
    conversationId: input.conversationId,
    planId: plan.planId,
    confirmationVersion: plan.confirmationVersion,
  });

  return {
    handled: true,
    replyText: reply,
    preserveCreatePlan: true,
    askConfirm: true,
    planId: plan.planId,
  };
}

async function executeCancelConfirm(
  input: {
    conversationId: number;
    turnId: number;
    phone: string;
    inboundText: string;
  },
  active: BookingManagementPlanSnapshot,
): Promise<ManagementTurnResult> {
  const code = active.targetBookingCode;
  const snapshot = active.originalSnapshot;
  if (!code || !snapshot) {
    return {
      handled: true,
      replyText: 'محتاج أأكد أنهي حجز تقصد قبل الإلغاء.',
      preserveCreatePlan: true,
      askConfirm: false,
      planId: active.planId,
    };
  }

  const idempotencyKey = buildManagementIdempotencyKey({
    conversationId: input.conversationId,
    planId: active.planId,
    confirmationVersion: active.confirmationVersion,
  });

  logBookingManagementEvent('booking_management_commit_started', {
    conversationId: input.conversationId,
    planId: active.planId,
    operation: 'CANCEL',
    bookingCode: code,
  });

  try {
    await upsertManagementPlan({
      conversationId: input.conversationId,
      planId: active.planId,
      operation: 'CANCEL',
      stage: 'EXECUTING',
      targetBookingCode: code,
      targetBookingId: active.targetBookingId,
      originalSnapshot: snapshot,
      confirmationVersion: active.confirmationVersion,
      idempotencyKey,
      lastTurnId: input.turnId,
    });

    const result = await cancelPublicBooking({
      code,
      phone: input.phone,
      reasonCode: 'customer_changed_plans',
      idempotencyKey,
      allowMissingIdempotencyKey: false,
    });

    await upsertManagementPlan({
      conversationId: input.conversationId,
      planId: active.planId,
      operation: 'CANCEL',
      stage: 'COMPLETED',
      targetBookingCode: code,
      targetBookingId: active.targetBookingId,
      originalSnapshot: snapshot,
      confirmationVersion: active.confirmationVersion,
      idempotencyKey,
      lastTurnId: input.turnId,
    });

    const reply = composeCancelSuccessReply(snapshot);
    const session = getSessionMemory(input.conversationId);
    session.pendingConfirmPlanId = null;
    session.pendingConfirmVersion = null;
    session.lastRelevantBooking = {
      bookingId: snapshot.bookingId,
      bookingCode: snapshot.bookingCode,
      snapshot: { ...snapshot, status: 'cancelled', canCancel: false },
      lastReferencedAt: new Date().toISOString(),
    };
    recordBotAction(input.conversationId, {
      text: reply,
      action: 'other',
      answeredWell: true,
      customerText: input.inboundText,
    });

    const replay = Boolean(result.body.cancellation.idempotentReplay);
    logBookingManagementEvent(
      replay ? 'booking_management_idempotent_replay' : 'booking_management_cancelled',
      {
        conversationId: input.conversationId,
        planId: active.planId,
        bookingCode: code,
      },
    );

    return {
      handled: true,
      replyText: reply,
      preserveCreatePlan: true,
      askConfirm: false,
      planId: active.planId,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logBookingManagementEvent('booking_management_failed', {
      conversationId: input.conversationId,
      planId: active.planId,
      error: message.slice(0, 200),
    });
    await upsertManagementPlan({
      conversationId: input.conversationId,
      planId: active.planId,
      operation: 'CANCEL',
      stage: 'FAILED',
      targetBookingCode: code,
      originalSnapshot: snapshot,
      confirmationVersion: active.confirmationVersion,
      lastTurnId: input.turnId,
    }).catch(() => undefined);

    return {
      handled: true,
      replyText:
        'مش قدرت أكمّل إلغاء الحجز دلوقتي. الحجز لسه زي ما هو — ممكن نحاول تاني أو أحولك للاستقبال.',
      preserveCreatePlan: true,
      askConfirm: false,
      planId: active.planId,
    };
  }
}

async function executeModifyConfirm(
  input: {
    conversationId: number;
    turnId: number;
    phone: string;
    inboundText: string;
  },
  active: BookingManagementPlanSnapshot,
): Promise<ManagementTurnResult> {
  const code = active.targetBookingCode;
  const snapshot = active.originalSnapshot;
  const validated = active.validatedDesiredState;
  if (!code || !snapshot || !validated) {
    return {
      handled: true,
      replyText: 'محتاج أأكد تفاصيل التعديل تاني قبل التنفيذ.',
      preserveCreatePlan: true,
      askConfirm: false,
      planId: active.planId,
    };
  }

  const workDate = String(validated.workDate ?? '');
  const time = String(validated.time ?? '');
  const empId = Number(validated.empId);
  const branchCode = String(validated.branchCode ?? '');
  const serviceIds = Array.isArray(validated.serviceIds)
    ? (validated.serviceIds as number[])
    : snapshot.serviceIds ?? [];

  if (!workDate || !time || !empId || !branchCode || !serviceIds.length) {
    return {
      handled: true,
      replyText: 'محتاج أأكد تفاصيل التعديل تاني قبل التنفيذ.',
      preserveCreatePlan: true,
      askConfirm: false,
      planId: active.planId,
    };
  }

  const idempotencyKey = buildManagementIdempotencyKey({
    conversationId: input.conversationId,
    planId: active.planId,
    confirmationVersion: active.confirmationVersion,
  });

  logBookingManagementEvent('booking_management_commit_started', {
    conversationId: input.conversationId,
    planId: active.planId,
    operation: 'MODIFY',
    bookingCode: code,
  });

  try {
    await upsertManagementPlan({
      conversationId: input.conversationId,
      planId: active.planId,
      operation: 'MODIFY',
      stage: 'EXECUTING',
      targetBookingCode: code,
      targetBookingId: active.targetBookingId,
      originalSnapshot: snapshot,
      desiredChanges: active.desiredChanges,
      validatedDesiredState: validated,
      confirmationVersion: active.confirmationVersion,
      idempotencyKey,
      lastTurnId: input.turnId,
    });

    const result = await reschedulePublicBooking({
      code,
      phone: input.phone,
      desired: { workDate, time, empId, branchCode, serviceIds },
      idempotencyKey,
      suppressCustomerWhatsApp: true,
    });

    await upsertManagementPlan({
      conversationId: input.conversationId,
      planId: active.planId,
      operation: 'MODIFY',
      stage: 'COMPLETED',
      targetBookingCode: code,
      targetBookingId: active.targetBookingId,
      originalSnapshot: snapshot,
      desiredChanges: active.desiredChanges,
      validatedDesiredState: validated,
      confirmationVersion: active.confirmationVersion,
      idempotencyKey,
      lastTurnId: input.turnId,
    });

    const reply = composeModifySuccessReply({
      workDate: result.new.workDate,
      time: result.new.time,
      employeeName: result.new.empName ?? String(validated.employeeName ?? ''),
      branchName: String(validated.branchName ?? snapshot.branchName ?? ''),
    });

    const session = getSessionMemory(input.conversationId);
    session.pendingConfirmPlanId = null;
    session.pendingConfirmVersion = null;
    session.lastRelevantBooking = {
      bookingId: result.bookingId,
      bookingCode: result.bookingCode,
      snapshot: {
        ...snapshot,
        bookingId: result.bookingId,
        workDate: result.new.workDate,
        time: result.new.time,
        empId: result.new.empId,
        employeeName: result.new.empName,
        branchCode: result.new.branchCode,
      },
      lastReferencedAt: new Date().toISOString(),
    };
    recordBotAction(input.conversationId, {
      text: reply,
      action: 'other',
      answeredWell: true,
      customerText: input.inboundText,
    });

    logBookingManagementEvent(
      result.idempotentReplay
        ? 'booking_management_idempotent_replay'
        : 'booking_management_committed',
      {
        conversationId: input.conversationId,
        planId: active.planId,
        bookingCode: code,
      },
    );

    return {
      handled: true,
      replyText: reply,
      preserveCreatePlan: true,
      askConfirm: false,
      planId: active.planId,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logBookingManagementEvent('booking_management_failed', {
      conversationId: input.conversationId,
      planId: active.planId,
      error: message.slice(0, 200),
    });
    await upsertManagementPlan({
      conversationId: input.conversationId,
      planId: active.planId,
      operation: 'MODIFY',
      stage: 'FAILED',
      targetBookingCode: code,
      originalSnapshot: snapshot,
      confirmationVersion: active.confirmationVersion,
      lastTurnId: input.turnId,
    }).catch(() => undefined);

    if (err instanceof PublicBookingRescheduleError) {
      const conflictMsg =
        typeof err.metadata.message === 'string'
          ? err.metadata.message
          : null;
      return {
        handled: true,
        replyText:
          conflictMsg && /غير متاح|مش متاح|conflict/i.test(conflictMsg)
            ? 'الميعاد اتاخد حالًا، والحجز الأصلي لسه زي ما هو. قولي ميعاد تاني وأشوف بدائل.'
            : 'مش قدرت أكمّل تعديل الحجز دلوقتي. الحجز لسه زي ما هو — ممكن نحاول تاني.',
        preserveCreatePlan: true,
        askConfirm: false,
        planId: active.planId,
      };
    }

    return {
      handled: true,
      replyText:
        'مش قدرت أكمّل تعديل الحجز دلوقتي. الحجز لسه زي ما هو — ممكن نحاول تاني.',
      preserveCreatePlan: true,
      askConfirm: false,
      planId: active.planId,
    };
  }
}

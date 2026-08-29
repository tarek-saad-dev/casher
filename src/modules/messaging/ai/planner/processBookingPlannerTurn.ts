/**
 * Phase 3 Booking Planner — application-owned state machine.
 * READ-ONLY relative to bookings: never imports create/hold/cancel.
 */
import type { AiEntities, AiIntent, AiStructuredResult } from '../domain/types';
import { executeGetAvailability } from '../tools/getAvailability';
import {
  getActiveBookingPlan,
  upsertBookingPlan,
  abandonBookingPlan,
} from './bookingPlanRepository';
import type {
  BookingCandidateSlot,
  BookingPlanSnapshot,
  BookingPlannerTrace,
  BookingPlanStage,
} from './types';
import {
  buildAskPrompt,
  buildConfirmedIntentReply,
  buildReadyToConfirmReply,
  buildSlotChoicesReply,
  computeMissingFields,
  emptyMutablePlan,
  fromSnapshot,
  invalidateAfterChange,
  toCandidateFromAvailability,
  type MutablePlan,
} from './planState';
import {
  filterSlotsByPreference,
  isAffirmative,
  isNegativeOrCancel,
  isResumePlanner,
  looksLikeSlotChoice,
  parseTimePreferenceText,
  resolveSlotChoice,
} from './slotPreferences';
import {
  looksLikeBookingIntent,
  looksLikePlannerCancel,
  resolveBranchByText,
  resolveDateText,
  resolveEmployeeByText,
  resolveServicesByText,
} from './resolveEntities';

const PLANNER_INTENTS = new Set<AiIntent>([
  'booking_request',
  'availability_question',
]);

const INTERRUPT_INTENTS = new Set<AiIntent>([
  'service_question',
  'price_question',
  'branch_question',
  'employee_question',
  'greeting',
  'general_question',
  'complaint',
  'human_request',
]);

export type PlannerTurnInput = {
  conversationId: number;
  turnId: number;
  phone: string;
  inboundText: string;
  structured: AiStructuredResult;
  /** Optional: inject availability for tests. */
  runAvailability?: typeof executeGetAvailability;
};

export type PlannerTurnResult = {
  handled: boolean;
  /** When handled=false, processAiTurn continues with Phase 2 path. */
  preservePlan: boolean;
  replyText: string | null;
  plan: BookingPlanSnapshot | null;
  trace: BookingPlannerTrace;
  intent: AiIntent;
};

function emptyTrace(conversationId: number): BookingPlannerTrace {
  return {
    conversationId,
    planId: null,
    stageBefore: 'none',
    stageAfter: 'none',
    extracted: {},
    validatedChanges: [],
    invalidatedFields: [],
    toolCalls: [],
    missingFields: [],
    candidateSlotCount: 0,
    selectedSlot: null,
    deterministicAction: null,
  };
}

function shouldEnterPlanner(structured: AiStructuredResult, hasActivePlan: boolean, text: string): boolean {
  if (PLANNER_INTENTS.has(structured.intent)) return true;
  if (hasActivePlan && looksLikeBookingIntent(text)) return true;
  if (hasActivePlan && isResumePlanner(text)) return true;
  if (hasActivePlan && looksLikePlannerCancel(text)) return true;
  if (hasActivePlan && (isAffirmative(text) || isNegativeOrCancel(text))) return true;
  if (hasActivePlan && /^(الأول|الاول|التاني|الثاني|التالت|الثالث|\d{1,2})$/i.test(text.trim())) {
    return true;
  }
  return false;
}

async function persistPlan(args: {
  conversationId: number;
  existing: BookingPlanSnapshot | null;
  plan: MutablePlan;
  turnId: number;
  trace: BookingPlannerTrace;
}): Promise<BookingPlanSnapshot> {
  return upsertBookingPlan({
    conversationId: args.conversationId,
    planId: args.existing?.planId ?? null,
    stage: args.plan.stage,
    version: (args.existing?.version ?? 0) + 1,
    branchId: args.plan.branchId,
    branchCode: args.plan.branchCode,
    branchName: args.plan.branchName,
    serviceIds: args.plan.serviceIds,
    serviceNames: args.plan.serviceNames,
    empId: args.plan.empId,
    employeeName: args.plan.employeeName,
    requestedDate: args.plan.requestedDate,
    timePreference: args.plan.timePreference,
    candidateSlots: args.plan.candidateSlots,
    selectedSlot: args.plan.selectedSlot,
    clientId: args.plan.clientId,
    missingFields: args.plan.missingFields,
    clarification: args.plan.clarification,
    lastAvailabilityCheckedAt: args.plan.lastAvailabilityCheckedAt,
    lastTurnId: args.turnId,
    trace: args.trace,
  });
}

async function ensureBranch(plan: MutablePlan, branchText: string | null): Promise<{
  ok: boolean;
  reply?: string;
}> {
  if (plan.branchCode && !branchText) return { ok: true };
  const resolved = await resolveBranchByText(branchText);
  if (resolved.ambiguous.length > 1) {
    plan.stage = 'clarifying';
    plan.clarification = {
      field: 'branch',
      options: resolved.ambiguous.map((b) => ({ id: b.branchCode, label: b.branchName })),
      prompt: 'تقصد أنهي فرع؟',
    };
    plan.missingFields = ['branch'];
    return {
      ok: false,
      reply: `تقصد ${resolved.ambiguous.map((b) => b.branchName).join(' ولا ')}؟`,
    };
  }
  if (resolved.branchCode) {
    if (plan.branchCode && plan.branchCode !== resolved.branchCode) {
      invalidateAfterChange(plan, ['branch']);
    }
    plan.branchCode = resolved.branchCode;
    plan.branchId = resolved.branchId;
    plan.branchName = resolved.branchName;
    return { ok: true };
  }
  return { ok: false, reply: 'محتاج أعرف الفرع عشان أشوف المواعيد.' };
}

async function applyEntities(
  plan: MutablePlan,
  entities: AiEntities,
  inboundText: string,
  trace: BookingPlannerTrace,
): Promise<{ reply: string | null }> {
  const validated: string[] = [];
  const extracted: Record<string, unknown> = { ...entities, inboundText };
  trace.extracted = extracted;

  // Branch
  const branchText = entities.branchText;
  const branchResult = await ensureBranch(plan, branchText);
  if (!branchResult.ok) return { reply: branchResult.reply ?? null };
  if (!plan.branchCode) {
    const d = await resolveBranchByText(null);
    if (d.branchCode) {
      plan.branchCode = d.branchCode;
      plan.branchId = d.branchId;
      plan.branchName = d.branchName;
      validated.push('branch:default');
    }
  }
  if (!plan.branchCode) {
    return { reply: 'حالياً مفيش فرع متاح للحجز العام.' };
  }

  // Service
  if (entities.serviceText?.trim()) {
    const svc = await resolveServicesByText({
      branchCode: plan.branchCode,
      serviceText: entities.serviceText,
    });
    if (!svc.ok) {
      if (svc.ambiguous.length) {
        plan.stage = 'clarifying';
        plan.clarification = {
          field: 'service',
          options: svc.ambiguous.map((s) => ({ id: String(s.serviceId), label: s.name })),
          prompt: 'تقصد أنهي خدمة؟',
        };
        plan.missingFields = ['service'];
        return {
          reply: `تقصد ${svc.ambiguous.map((s) => s.name).join(' ولا ')}؟`,
        };
      }
      return { reply: 'مش لاقي الخدمة دي في الكتالوج. تقدر توضح اسم الخدمة؟' };
    }
    const nextIds = svc.services.map((s) => s.serviceId);
    const changed =
      plan.serviceIds.length !== nextIds.length ||
      plan.serviceIds.some((id, i) => id !== nextIds[i]);
    if (changed) {
      trace.invalidatedFields.push(...invalidateAfterChange(plan, ['service']));
      plan.serviceIds = nextIds;
      plan.serviceNames = svc.services.map((s) => s.name);
      validated.push(`service:${nextIds.join(',')}`);
    }
  }

  // Employee
  if (entities.employeeName?.trim()) {
    const emp = await resolveEmployeeByText({
      branchCode: plan.branchCode,
      employeeName: entities.employeeName,
      date: plan.requestedDate,
    });
    if (!emp.ok) {
      if (emp.ambiguous.length) {
        plan.stage = 'clarifying';
        plan.clarification = {
          field: 'employee',
          options: emp.ambiguous.map((e) => ({
            id: String(e.empId),
            label: e.name,
          })),
          prompt: 'تقصد أنهي موظف؟',
        };
        plan.missingFields = ['employee'];
        return {
          reply: `تقصد ${emp.ambiguous.map((e) => e.name).join(' ولا ')}؟`,
        };
      }
      return { reply: `مش لاقي موظف باسم "${entities.employeeName}" على الفرع ده.` };
    }
    if (emp.employee) {
      if (plan.empId !== emp.employee.empId) {
        trace.invalidatedFields.push(...invalidateAfterChange(plan, ['employee']));
        plan.empId = emp.employee.empId;
        plan.employeeName = emp.employee.name;
        validated.push(`employee:${emp.employee.empId}`);
      }
    }
  }

  // Date
  if (entities.dateText?.trim()) {
    const d = resolveDateText(entities.dateText);
    if (!d.date) {
      return { reply: 'مش فاهم اليوم ده كويس. قولي بكرة أو تاريخ واضح؟' };
    }
    if (plan.requestedDate !== d.date) {
      trace.invalidatedFields.push(...invalidateAfterChange(plan, ['date']));
      plan.requestedDate = d.date;
      validated.push(`date:${d.date}`);
    }
  }

  // Time preference — prefer inbound phrasing; ignore Gemini echoing bot shortlist times.
  const inboundHasTimePref = /(بعد|قبل|أقرب|اقرب|الصبح|مساء|بالليل|بعد الظهر)/.test(inboundText);
  const entityTime = entities.timeText?.trim() || null;
  const entityLooksLikeEchoedSlot =
    Boolean(entityTime) &&
    /^\d{1,2}(:\d{2})?\s*(ص|م|am|pm)?$/i.test(entityTime!) &&
    !inboundHasTimePref;
  const timeSrc = inboundHasTimePref
    ? inboundText
    : entityTime && !entityLooksLikeEchoedSlot
      ? entityTime
      : null;
  if (timeSrc) {
    const pref = parseTimePreferenceText(timeSrc);
    if (pref) {
      const prev = JSON.stringify(plan.timePreference);
      const next = JSON.stringify(pref);
      if (prev !== next) {
        trace.invalidatedFields.push(...invalidateAfterChange(plan, ['timePreference']));
        plan.timePreference = pref;
        validated.push(`timePreference:${pref.kind}`);
      }
    }
  }

  trace.validatedChanges.push(...validated);
  return { reply: null };
}

async function searchAvailability(
  plan: MutablePlan,
  trace: BookingPlannerTrace,
  runAvailability: typeof executeGetAvailability,
): Promise<{ reply: string | null }> {
  const started = performance.now();
  const result = await runAvailability({
    name: 'get_availability',
    branchCode: plan.branchCode,
    serviceIds: plan.serviceIds,
    empId: plan.empId,
    dateText: plan.requestedDate,
    timePreference: null,
  });
  const durationMs = Math.max(0, Math.round(performance.now() - started));
  trace.toolCalls.push({
    name: 'get_availability',
    ok: result.ok,
    durationMs,
    errorCode: result.errorCode ?? null,
  });

  if (!result.ok) {
    if (result.errorCode === 'EMPLOYEE_AMBIGUOUS') {
      const matches = (result.data as { matches?: Array<{ empId: number; name: string }> })?.matches ?? [];
      plan.stage = 'clarifying';
      return {
        reply: matches.length
          ? `تقصد ${matches.map((m) => m.name).join(' ولا ')}؟`
          : 'في أكتر من موظف بنفس الاسم، توضّح أكتر؟',
      };
    }
    return {
      reply: 'مقدرش أأكد المواعيد من السيستم دلوقتي. جرّب تاني بعد شوية.',
    };
  }

  const data = result.data as {
    slots?: Array<{
      time: string;
      dayOffset?: 0 | 1;
      empId?: number | null;
      empName?: string | null;
    }>;
    noSlots?: boolean;
    messageAr?: string | null;
    branch?: { branchCode?: string; branchName?: string };
  };

  if (data.branch?.branchName) {
    plan.branchName = data.branch.branchName;
  }

  const rawSlots = (data.slots ?? []).map(toCandidateFromAvailability);
  const shortlist = filterSlotsByPreference(rawSlots, plan.timePreference, 3);
  plan.candidateSlots = shortlist;
  plan.selectedSlot = null;
  plan.lastAvailabilityCheckedAt = new Date().toISOString();
  trace.candidateSlotCount = shortlist.length;

  if (!shortlist.length) {
    plan.stage = 'collecting';
    plan.missingFields = computeMissingFields(plan);
    return {
      reply:
        data.messageAr ||
        'مفيش مواعيد متاحة في اليوم ده حسب السيستم. تحب يوم تاني أو وقت مختلف؟',
    };
  }

  plan.stage = 'choosing_slot';
  plan.missingFields = ['slot_choice'];
  return { reply: buildSlotChoicesReply(plan) };
}

function advanceStage(plan: MutablePlan): void {
  plan.missingFields = computeMissingFields(plan);
  if (plan.selectedSlot && plan.serviceIds.length && plan.requestedDate) {
    plan.stage = 'ready_to_confirm';
    plan.missingFields = ['confirm'];
    return;
  }
  if (plan.candidateSlots.length && !plan.selectedSlot) {
    plan.stage = 'choosing_slot';
    plan.missingFields = ['slot_choice'];
    return;
  }
  if (plan.clarification) {
    plan.stage = 'clarifying';
    return;
  }
  plan.stage = 'collecting';
}

/**
 * Process one turn through the Booking Planner.
 * Returns handled=false for interruptions so Phase 2 read tools remain intact.
 */
export async function processBookingPlannerTurn(
  input: PlannerTurnInput,
): Promise<PlannerTurnResult> {
  const trace = emptyTrace(input.conversationId);
  const active = await getActiveBookingPlan(input.conversationId);
  const text = input.inboundText.trim();
  const structured = input.structured;

  const interrupt =
    INTERRUPT_INTENTS.has(structured.intent) &&
    !PLANNER_INTENTS.has(structured.intent) &&
    !isResumePlanner(text) &&
    !looksLikeBookingIntent(text) &&
    !isAffirmative(text) &&
    !/^(الأول|الاول|التاني|الثاني|التالت|الثالث|\d{1,2})$/i.test(text);

  if (interrupt && active) {
    // Leave plan intact; let Phase 2 answer the side question.
    return {
      handled: false,
      preservePlan: true,
      replyText: null,
      plan: active,
      trace: {
        ...trace,
        planId: active.planId,
        stageBefore: active.stage,
        stageAfter: active.stage,
        deterministicAction: 'interrupt_passthrough',
      },
      intent: structured.intent,
    };
  }

  if (!shouldEnterPlanner(structured, Boolean(active), text) && !active) {
    return {
      handled: false,
      preservePlan: false,
      replyText: null,
      plan: null,
      trace,
      intent: structured.intent,
    };
  }

  // Cancel / start over
  if (active && (looksLikePlannerCancel(text) || (isNegativeOrCancel(text) && active.stage === 'ready_to_confirm' && !isAffirmative(text) && /الغ|cancel|من جديد/.test(text)))) {
    await abandonBookingPlan(active.planId);
    trace.planId = active.planId;
    trace.stageBefore = active.stage;
    trace.stageAfter = 'abandoned';
    trace.deterministicAction = 'abandon';
    return {
      handled: true,
      preservePlan: false,
      replyText: 'تمام، لغيت خطة الحجز. لو حابب نبدأ تاني قولي عاوز أحجز.',
      plan: null,
      trace,
      intent: 'booking_request',
    };
  }

  const plan: MutablePlan = active ? fromSnapshot(active) : emptyMutablePlan();
  trace.stageBefore = active?.stage ?? 'none';
  trace.planId = active?.planId ?? null;

  const runAvailability = input.runAvailability ?? executeGetAvailability;

  // Soft decline at confirm — keep plan, no write
  if (active && active.stage === 'ready_to_confirm' && isNegativeOrCancel(text) && !looksLikePlannerCancel(text)) {
    trace.deterministicAction = 'confirm_declined';
    trace.stageAfter = 'ready_to_confirm';
    return {
      handled: true,
      preservePlan: true,
      replyText: 'ماشي، مش هأكّد دلوقتي. لو حابب تغيّر الميعاد أو الخدمة قولي.',
      plan: active,
      trace,
      intent: 'booking_request',
    };
  }

  // Deterministic: confirm intent (no write)
  if (active && active.stage === 'ready_to_confirm' && isAffirmative(text)) {
    plan.stage = 'confirmed_intent';
    plan.missingFields = [];
    plan.selectedSlot = active.selectedSlot;
    plan.candidateSlots = active.candidateSlots;
    trace.deterministicAction = 'confirm_intent';
    trace.selectedSlot = plan.selectedSlot;
    const saved = await persistPlan({
      conversationId: input.conversationId,
      existing: active,
      plan,
      turnId: input.turnId,
      trace,
    });
    // Immediately abandon active uniqueness by completing — keep confirmed_intent as terminal active?
    // Spec: CONFIRMED_INTENT / READY_FOR_WRITE — keep as active stage until Phase 4.
    trace.stageAfter = 'confirmed_intent';
    const reply = buildConfirmedIntentReply(plan);
    console.log(JSON.stringify({ type: 'messaging_booking_planner_trace', ...trace, planId: saved.planId }));
    return {
      handled: true,
      preservePlan: true,
      replyText: reply,
      plan: saved,
      trace,
      intent: 'booking_request',
    };
  }

  // Deterministic: slot choice against STORED candidates.
  // Ignore Gemini entity echo from prior turns — "الأول"/"1" must not re-search.
  if (
    active &&
    active.candidateSlots.length > 0 &&
    (active.stage === 'choosing_slot' || looksLikeSlotChoice(text))
  ) {
    const choice = resolveSlotChoice(text, active.candidateSlots);
    if (choice.ambiguous) {
      trace.deterministicAction = 'slot_ambiguous';
      const reply = `في أكتر من ميعاد قريب من اللي قلته. اختار رقم:\n${buildSlotChoicesReply(fromSnapshot(active))}`;
      return {
        handled: true,
        preservePlan: true,
        replyText: reply,
        plan: active,
        trace: { ...trace, stageAfter: active.stage },
        intent: 'booking_request',
      };
    }
    if (choice.slot) {
      plan.selectedSlot = choice.slot;
      plan.candidateSlots = active.candidateSlots;
      // Freshness: re-check selected still in availability (read-only)
      const fresh = await runAvailability({
        name: 'get_availability',
        branchCode: plan.branchCode || active.branchCode,
        serviceIds: plan.serviceIds.length ? plan.serviceIds : active.serviceIds,
        empId: plan.empId ?? active.empId,
        dateText: plan.requestedDate || active.requestedDate,
      });
      trace.toolCalls.push({
        name: 'get_availability',
        ok: fresh.ok,
        durationMs: (fresh as { durationMs?: number }).durationMs ?? 0,
        errorCode: fresh.errorCode ?? null,
      });
      if (fresh.ok) {
        const slots = ((fresh.data as { slots?: Array<{ time: string }> })?.slots ?? []).map(
          (s) => s.time,
        );
        if (!slots.includes(choice.slot.time)) {
          plan.selectedSlot = null;
          plan.candidateSlots = filterSlotsByPreference(
            (
              (fresh.data as {
                slots?: Array<{
                  time: string;
                  dayOffset?: 0 | 1;
                  empId?: number | null;
                  empName?: string | null;
                }>;
              })?.slots ?? []
            ).map(toCandidateFromAvailability),
            plan.timePreference,
            3,
          );
          plan.stage = 'choosing_slot';
          plan.lastAvailabilityCheckedAt = new Date().toISOString();
          const saved = await persistPlan({
            conversationId: input.conversationId,
            existing: active,
            plan,
            turnId: input.turnId,
            trace,
          });
          trace.deterministicAction = 'slot_stale_refresh';
          trace.stageAfter = plan.stage;
          console.log(
            JSON.stringify({ type: 'messaging_booking_planner_trace', ...trace, planId: saved.planId }),
          );
          return {
            handled: true,
            preservePlan: true,
            replyText: `الميعاد ده اتغير. أقرب المتاح دلوقتي:\n${buildSlotChoicesReply(plan)}`,
            plan: saved,
            trace,
            intent: 'booking_request',
          };
        }
      }
      plan.stage = 'ready_to_confirm';
      plan.missingFields = ['confirm'];
      trace.deterministicAction = 'select_slot';
      trace.selectedSlot = plan.selectedSlot;
      const saved = await persistPlan({
        conversationId: input.conversationId,
        existing: active,
        plan,
        turnId: input.turnId,
        trace,
      });
      trace.stageAfter = 'ready_to_confirm';
      console.log(
        JSON.stringify({ type: 'messaging_booking_planner_trace', ...trace, planId: saved.planId }),
      );
      return {
        handled: true,
        preservePlan: true,
        replyText: buildReadyToConfirmReply(plan),
        plan: saved,
        trace,
        intent: 'booking_request',
      };
    }
    // choosing_slot but inbound wasn't a recognizable pick — fall through
  }

  // Merge Gemini entities (and inbound heuristics) into plan
  const entityResult = await applyEntities(plan, structured.entities, text, trace);
  if (entityResult.reply) {
    advanceStage(plan);
    const saved = await persistPlan({
      conversationId: input.conversationId,
      existing: active,
      plan,
      turnId: input.turnId,
      trace,
    });
    trace.stageAfter = plan.stage;
    trace.missingFields = plan.missingFields;
    console.log(JSON.stringify({ type: 'messaging_booking_planner_trace', ...trace, planId: saved.planId }));
    return {
      handled: true,
      preservePlan: true,
      replyText: entityResult.reply,
      plan: saved,
      trace,
      intent: 'booking_request',
    };
  }

  // Missing required fields?
  if (!plan.serviceIds.length) {
    plan.stage = 'collecting';
    plan.missingFields = ['service'];
    const saved = await persistPlan({
      conversationId: input.conversationId,
      existing: active,
      plan,
      turnId: input.turnId,
      trace,
    });
    trace.stageAfter = plan.stage;
    trace.missingFields = plan.missingFields;
    console.log(JSON.stringify({ type: 'messaging_booking_planner_trace', ...trace, planId: saved.planId }));
    return {
      handled: true,
      preservePlan: true,
      replyText: buildAskPrompt(['service']),
      plan: saved,
      trace,
      intent: 'booking_request',
    };
  }

  if (!plan.requestedDate) {
    plan.stage = 'collecting';
    plan.missingFields = ['date'];
    const saved = await persistPlan({
      conversationId: input.conversationId,
      existing: active,
      plan,
      turnId: input.turnId,
      trace,
    });
    trace.stageAfter = plan.stage;
    trace.missingFields = plan.missingFields;
    console.log(JSON.stringify({ type: 'messaging_booking_planner_trace', ...trace, planId: saved.planId }));
    return {
      handled: true,
      preservePlan: true,
      replyText: buildAskPrompt(['date']),
      plan: saved,
      trace,
      intent: 'booking_request',
    };
  }

  // Have service + date → search availability (unless shortlist still valid)
  if (!plan.selectedSlot) {
    if (
      plan.candidateSlots.length > 0 &&
      !trace.invalidatedFields.length &&
      active?.stage === 'choosing_slot'
    ) {
      plan.stage = 'choosing_slot';
      plan.missingFields = ['slot_choice'];
      const saved = await persistPlan({
        conversationId: input.conversationId,
        existing: active,
        plan,
        turnId: input.turnId,
        trace,
      });
      trace.stageAfter = plan.stage;
      trace.deterministicAction = 'reprompt_slot_choice';
      console.log(
        JSON.stringify({ type: 'messaging_booking_planner_trace', ...trace, planId: saved.planId }),
      );
      return {
        handled: true,
        preservePlan: true,
        replyText: 'أنهي واحد من المواعيد اللي فوق؟ (الأول / التاني / التالت أو الساعة)',
        plan: saved,
        trace,
        intent: 'booking_request',
      };
    }
    const search = await searchAvailability(plan, trace, runAvailability);
    const saved = await persistPlan({
      conversationId: input.conversationId,
      existing: active,
      plan,
      turnId: input.turnId,
      trace,
    });
    trace.stageAfter = plan.stage;
    trace.missingFields = plan.missingFields;
    trace.candidateSlotCount = plan.candidateSlots.length;
    console.log(JSON.stringify({ type: 'messaging_booking_planner_trace', ...trace, planId: saved.planId }));
    return {
      handled: true,
      preservePlan: true,
      replyText: search.reply,
      plan: saved,
      trace,
      intent: 'booking_request',
    };
  }

  // Already have selected slot → ready to confirm
  plan.stage = 'ready_to_confirm';
  plan.missingFields = ['confirm'];
  const saved = await persistPlan({
    conversationId: input.conversationId,
    existing: active,
    plan,
    turnId: input.turnId,
    trace,
  });
  trace.stageAfter = plan.stage;
  console.log(JSON.stringify({ type: 'messaging_booking_planner_trace', ...trace, planId: saved.planId }));
  return {
    handled: true,
    preservePlan: true,
    replyText: buildReadyToConfirmReply(plan),
    plan: saved,
    trace,
    intent: 'booking_request',
  };
}

/** Static guarantee helper for tests: planner module must not reference write APIs. */
export const PHASE3_FORBIDDEN_IMPORT_MARKERS = [
  'createPublicBooking',
  'holdPublicBooking',
  'claimBooking',
  'cancelPublicBooking',
  'reschedulePublicBooking',
] as const;

export type { BookingPlanStage, BookingCandidateSlot };

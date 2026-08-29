import type {
  BookingCandidateSlot,
  BookingPlanMissingField,
  BookingPlanSnapshot,
  BookingPlanStage,
  BookingTimePreference,
} from './types';
import { formatSlotLabelAr } from './slotPreferences';

export type MutablePlan = {
  stage: BookingPlanStage;
  branchId: number | null;
  branchCode: string | null;
  branchName: string | null;
  serviceIds: number[];
  serviceNames: string[];
  empId: number | null;
  employeeName: string | null;
  requestedDate: string | null;
  timePreference: BookingTimePreference | null;
  candidateSlots: BookingCandidateSlot[];
  selectedSlot: BookingCandidateSlot | null;
  clientId: number | null;
  missingFields: BookingPlanMissingField[];
  clarification: BookingPlanSnapshot['clarification'];
  lastAvailabilityCheckedAt: string | null;
};

export function emptyMutablePlan(): MutablePlan {
  return {
    stage: 'collecting',
    branchId: null,
    branchCode: null,
    branchName: null,
    serviceIds: [],
    serviceNames: [],
    empId: null,
    employeeName: null,
    requestedDate: null,
    timePreference: null,
    candidateSlots: [],
    selectedSlot: null,
    clientId: null,
    missingFields: ['service', 'date'],
    clarification: null,
    lastAvailabilityCheckedAt: null,
  };
}

export function fromSnapshot(plan: BookingPlanSnapshot): MutablePlan {
  return {
    stage: plan.stage,
    branchId: plan.branchId,
    branchCode: plan.branchCode,
    branchName: plan.branchName,
    serviceIds: [...plan.serviceIds],
    serviceNames: [...plan.serviceNames],
    empId: plan.empId,
    employeeName: plan.employeeName,
    requestedDate: plan.requestedDate,
    timePreference: plan.timePreference,
    candidateSlots: [...plan.candidateSlots],
    selectedSlot: plan.selectedSlot,
    clientId: plan.clientId,
    missingFields: [...plan.missingFields],
    clarification: plan.clarification,
    lastAvailabilityCheckedAt: plan.lastAvailabilityCheckedAt,
  };
}

/** Invalidate dependent fields when a core field changes. */
export function invalidateAfterChange(
  plan: MutablePlan,
  changed: Array<'service' | 'employee' | 'date' | 'branch' | 'timePreference'>,
): string[] {
  const invalidated: string[] = [];
  const touchSlots =
    changed.includes('service') ||
    changed.includes('employee') ||
    changed.includes('date') ||
    changed.includes('branch') ||
    changed.includes('timePreference');
  if (touchSlots && (plan.candidateSlots.length || plan.selectedSlot)) {
    plan.candidateSlots = [];
    plan.selectedSlot = null;
    plan.lastAvailabilityCheckedAt = null;
    invalidated.push('candidateSlots', 'selectedSlot');
  }
  return invalidated;
}

export function computeMissingFields(plan: MutablePlan): BookingPlanMissingField[] {
  const missing: BookingPlanMissingField[] = [];
  if (!plan.serviceIds.length) missing.push('service');
  if (!plan.requestedDate) missing.push('date');
  // employee optional (any barber) — not required
  // branch optional if employee implies it
  if (plan.serviceIds.length && plan.requestedDate && !plan.candidateSlots.length && !plan.selectedSlot) {
    // will search — no missing until search done
  }
  if (plan.candidateSlots.length && !plan.selectedSlot && plan.stage === 'choosing_slot') {
    missing.push('slot_choice');
  }
  if (plan.selectedSlot && plan.stage === 'ready_to_confirm') {
    missing.push('confirm');
  }
  return missing;
}

export function buildAskPrompt(missing: BookingPlanMissingField[]): string {
  if (missing.includes('service')) {
    return 'حاضر، تحب تحجز أنهي خدمة؟';
  }
  if (missing.includes('date')) {
    return 'تمام، تحب الميعاد أنهي يوم؟';
  }
  if (missing.includes('employee')) {
    return 'تحب مع حد معين ولا أي حد فاضي؟';
  }
  if (missing.includes('branch')) {
    return 'تحب أنهي فرع؟';
  }
  if (missing.includes('slot_choice')) {
    return 'أنهي ميعاد يناسبك من اللي فوق؟';
  }
  if (missing.includes('confirm')) {
    return 'أأكدلك الحجز؟';
  }
  return 'محتاج تفاصيل أوضح عشان أكمّل الحجز.';
}

export function buildSlotChoicesReply(plan: MutablePlan): string {
  const lines = plan.candidateSlots.map((s, i) => `${i + 1}) ${s.label}`);
  const who = plan.employeeName ? `مع ${plan.employeeName}` : '';
  const when = plan.requestedDate ? 'بكرة/اليوم المحدد' : '';
  // Prefer compact Arabic
  const dateHint = plan.requestedDate ? ` يوم ${plan.requestedDate}` : '';
  return [
    `المواعيد المناسبة ${who}${dateHint}:`.replace(/\s+/g, ' ').trim(),
    ...lines,
    'أنهي واحد يناسبك؟',
  ].join('\n');
}

export function buildReadyToConfirmReply(plan: MutablePlan): string {
  const slot = plan.selectedSlot;
  const service = plan.serviceNames[0] || 'الخدمة';
  const emp = plan.employeeName || 'أي فني متاح';
  const branch = plan.branchName || plan.branchCode || '';
  const date = plan.requestedDate || '';
  const time = slot?.label || slot?.time || '';
  return [
    'تمام يا باشا:',
    `${service} مع ${emp}`,
    branch ? branch : null,
    `${date} الساعة ${time}`,
    '',
    'أأكدلك الحجز؟',
  ]
    .filter((x) => x != null && String(x).length)
    .join('\n');
}

export function buildConfirmedIntentReply(plan: MutablePlan): string {
  const slot = plan.selectedSlot;
  const service = plan.serviceNames[0] || 'الخدمة';
  const emp = plan.employeeName || '';
  const time = slot?.label || slot?.time || '';
  return `تمام، اختيارك جاهز للتأكيد: ${service}${emp ? ` مع ${emp}` : ''} الساعة ${time}. التأكيد النهائي هيتم في خطوة الحجز الجاية (لسه مش مفعّلة من الشات).`;
}

export function toCandidateFromAvailability(slot: {
  time: string;
  dayOffset?: 0 | 1;
  empId?: number | null;
  empName?: string | null;
}): BookingCandidateSlot {
  return {
    time: slot.time,
    dayOffset: (slot.dayOffset ?? 0) as 0 | 1,
    empId: slot.empId ?? null,
    empName: slot.empName ?? null,
    label: formatSlotLabelAr(slot.time),
  };
}

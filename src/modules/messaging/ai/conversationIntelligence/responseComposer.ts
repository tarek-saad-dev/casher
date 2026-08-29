/**
 * Human receptionist response templates — Egyptian, brief, no tech jargon.
 */
import type { MutablePlan } from '../planner/planState';
import type { BookingPlanMissingField, BookingTimePreference } from '../planner/types';
import { formatSlotLabelAr } from './timePreference';

const TECH_BANNED =
  /الكتالوج|السيستم|database|tool|api|\bid\b|availability engine|planner|business tool/i;

export function assertNoTechJargon(text: string): boolean {
  return !TECH_BANNED.test(text);
}

export function buildAskPrompt(missing: BookingPlanMissingField[]): string {
  if (missing.includes('service')) {
    return 'تحب تحجز أنهي خدمة؟';
  }
  if (missing.includes('date')) {
    return 'تحب الميعاد أنهي يوم؟ النهارده ولا بكرة؟';
  }
  if (missing.includes('employee')) {
    return 'تحب مع حد معين ولا أي حد فاضي؟';
  }
  if (missing.includes('branch')) {
    return 'تحب أنهي فرع؟';
  }
  if (missing.includes('slot_choice')) {
    return 'أنهي ميعاد يناسبك؟';
  }
  if (missing.includes('confirm')) {
    return 'أأكدلك؟';
  }
  return 'محتاج تفاصيل أوضح عشان أكمّل الحجز.';
}

export function buildServiceNotFoundReply(serviceText: string): string {
  const t = serviceText.trim();
  if (/شعر/.test(t) && /دقن|ذقن/.test(t)) {
    return 'تقصد شعر ودقن؟';
  }
  if (/شعر/.test(t)) {
    return 'تحب شعر بس ولا شعر ودقن؟';
  }
  return 'ممكن توضّح اسم الخدمة أكتر؟';
}

export function buildServiceAmbiguousReply(names: string[]): string {
  if (names.length >= 2) {
    return `تقصد ${names[0]} ولا ${names[1]}؟`;
  }
  return 'في أكتر من خدمة قريبة — أنهي واحدة تقصد؟';
}

export function buildEmployeeNotFoundReply(name: string): string {
  return `مش لاقي حد بالاسم ده على الفرع. تقصد اسم تاني؟`;
}

export function buildDateClarifyReply(): string {
  return 'تقصد النهارده ولا بكرة؟';
}

function timePrefHint(pref: BookingTimePreference | null): string {
  if (!pref?.timeHm) {
    if (pref?.kind === 'evening') return ' بالليل';
    if (pref?.kind === 'morning') return ' الصبح';
    return '';
  }
  const label = formatSlotLabelAr(pref.timeHm);
  if (pref.kind === 'around' || pref.kind === 'exact') {
    return ` لحدود ${label}`;
  }
  if (pref.kind === 'after') return ` بعد ${label}`;
  if (pref.kind === 'before') return ` قبل ${label}`;
  return '';
}

export function buildSlotChoicesReply(plan: MutablePlan): string {
  const lines = plan.candidateSlots.map((s, i) => `${i + 1}) ${s.label}`);
  const who = plan.employeeName ? `مع ${plan.employeeName}` : '';
  const dateHint = plan.requestedDate ? ` ${plan.requestedDate}` : '';
  const prefHint = timePrefHint(plan.timePreference);
  const header = prefHint
    ? `أقرب مواعيد ${who}${dateHint}${prefHint}:`.replace(/\s+/g, ' ').trim()
    : `المواعيد المناسبة ${who}${dateHint}:`.replace(/\s+/g, ' ').trim();
  return [header, ...lines, 'أنهي واحد يناسبك؟'].join('\n');
}

export function buildUnavailableNearReply(
  plan: MutablePlan,
  requestedLabel: string,
): string {
  if (!plan.candidateSlots.length) {
    return `${requestedLabel} مش متاح دلوقتي. تحب يوم أو وقت تاني؟`;
  }
  const alts = plan.candidateSlots.map((s) => s.label).join(' و');
  const who = plan.employeeName ? `عند ${plan.employeeName}` : '';
  return `${requestedLabel} مش متاح، أقرب مواعيد ${who}: ${alts}. تحب أنهي؟`
    .replace(/\s+/g, ' ')
    .trim();
}

export function buildReadyToConfirmReply(plan: MutablePlan): string {
  const slot = plan.selectedSlot;
  const service = plan.serviceNames[0] || 'الخدمة';
  const emp = plan.employeeName || 'أي فني متاح';
  const branch = plan.branchName || plan.branchCode || '';
  const date = plan.requestedDate || '';
  const time = slot?.label || slot?.time || '';
  return [
    'تمام:',
    `${service} مع ${emp}`,
    branch || null,
    `${date} الساعة ${time}`,
    '',
    'أأكدلك؟',
  ]
    .filter((x) => x != null && String(x).length)
    .join('\n');
}

/** Legacy Phase 3 confirmed-intent copy — execution now live; keep non-tech. */
export function buildConfirmedIntentReply(plan: MutablePlan): string {
  const slot = plan.selectedSlot;
  const service = plan.serviceNames[0] || 'الخدمة';
  const emp = plan.employeeName || '';
  const time = slot?.label || slot?.time || '';
  return `تمام، جاهزين نأكد: ${service}${emp ? ` مع ${emp}` : ''} الساعة ${time}.`;
}

export function buildBookedReply(plan: MutablePlan, bookingCode: string | null): string {
  const service = plan.serviceNames[0] || 'الخدمة';
  const emp = plan.employeeName || 'الفني';
  const branch = plan.branchName || plan.branchCode || '';
  const date = plan.requestedDate || '';
  const time = plan.selectedSlot?.label || plan.selectedSlot?.time || '';
  const codeLine = bookingCode ? `\nكود الحجز: ${bookingCode}` : '';
  return [
    'تم الحجز ✅',
    `${service} مع ${emp}`,
    branch,
    `${date} الساعة ${time}${codeLine}`,
  ]
    .filter(Boolean)
    .join('\n');
}

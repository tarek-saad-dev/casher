/**
 * Build TurnFrame from the CURRENT customer message (deterministic).
 */
import {
  detectTurnIntent,
  looksLikeAlternativeEmployeeQuery,
  looksLikeAlternativeTimeQuery,
  looksLikeAlternativeBranchQuery,
  looksLikeBusinessInfoInterrupt,
  looksLikeBookingModification,
  isNearDuplicateQuestion,
} from '../conversationIntelligence/turnIntent';
import type { OrchestratorIntent, TemporalMode, TurnFrame, TurnScope } from './types';
import type { SessionMemory } from './types';
import { isSalonConciergeBrainEnabled } from '../salonConcierge/featureFlag';

function norm(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/\s+/g, ' ');
}

function extractBranchHint(t: string): string | null {
  if (/جليم|gleem/.test(t)) return 'جليم';
  if (/كامب|شيزار|camp/.test(t)) return 'كامب';
  return null;
}

function extractEmployeeHint(t: string): string | null {
  const m = t.match(/(?:مع|ل|عند)\s+([اأآإء-ي]{2,20})/);
  if (m?.[1] && !/عمر|محمد|احمد|أحمد|كريم|سامي|يوسف/.test(m[1])) {
    // still allow known names below
  }
  for (const name of ['عمر', 'محمد', 'احمد', 'أحمد', 'كريم', 'يوسف', 'سامي']) {
    if (t.includes(norm(name)) || t.includes(name)) return name === 'احمد' ? 'أحمد' : name;
  }
  return null;
}

function looksLikeNowTemporal(t: string): boolean {
  return /حاليا|دلوقتي|الان|الآن|النهارده دلوقتي|موجود\s*(دلوقتي|حاليا)/.test(t);
}

function looksLikeAvailabilityNow(t: string): boolean {
  return (
    (/مين\s*(متاح|موجود|فاضي)/.test(t) || /موجود\s*(مين|ايه)/.test(t)) &&
    (looksLikeNowTemporal(t) || /فرع/.test(t))
  );
}

function looksLikeKeepOmar(t: string): boolean {
  return /خليك\s*(في|على)\s*عمر|خلاص\s*خليك|نفضل\s*(مع|على)\s*عمر|كمل\s*مع\s*عمر/.test(t);
}

function looksLikePrice(t: string): boolean {
  return /بكام|السعر|الاسعار|كام\s*السعر|سعر/.test(t);
}

function looksLikeConciergeInfo(t: string): boolean {
  return (
    /فاتح|مفتوح|هتلحق|لوكيشن|انستجرام|انستا|instagram|فيسبوك|تيك\s*توك|لينك\s*الحجز|موقعكم|جوجل\s*ماب|عنوان|جراج|موقف|احجز\s*ازاي|الحجز\s*منين|شاطر|متخصص|عرض|عروض|مواعيد|بيفتح/.test(
      t,
    ) || /^فين\s+/.test(t)
  );
}

function looksLikeHandoff(t: string): boolean {
  return (
    /كلم\s*حد|كلمني\s*حد|موظف|بشري|reception|انسان|بني\s*آدم|بني\s*ادم/.test(t) ||
    /عاوز\s*اكلم|عايز\s*اكلم|ممكن\s*حد\s*يكلم|حدا?\s*يكلم/.test(t)
  );
}

function mapCiIntent(ci: ReturnType<typeof detectTurnIntent>['intent']): OrchestratorIntent {
  switch (ci) {
    case 'BOOKING_PROGRESS':
      return 'BOOKING_PROGRESS';
    case 'BOOKING_MODIFICATION':
      return 'BOOKING_MODIFICATION';
    case 'BOOKING_ALTERNATIVE_QUERY':
      return 'BOOKING_ALTERNATIVE_QUERY';
    case 'BUSINESS_INFORMATION_INTERRUPT':
      return 'BUSINESS_INFORMATION_QUERY';
    case 'RESUME':
      return 'RESUME_TASK';
    case 'CANCEL_RESET':
      return 'CANCEL_TASK';
    case 'NEW_BOOKING_REQUEST':
      return 'NEW_BOOKING_REQUEST';
    default:
      return 'UNKNOWN';
  }
}

export function buildTurnFrame(args: {
  text: string;
  session?: SessionMemory | null;
}): TurnFrame {
  const rawText = args.text.trim();
  const t = norm(rawText);
  const ci = detectTurnIntent(rawText);
  const repairMode = Boolean(
    args.session?.lastUnresolvedCustomerText &&
      !args.session.lastBotAction.startsWith('answered') &&
      isNearDuplicateQuestion(args.session.lastUnresolvedCustomerText, rawText),
  );

  const branchHint = extractBranchHint(t);
  const isQuestion = /[؟?]/.test(rawText) || /^(مين|في|طب|ايه|ازاي|امتى)/.test(t);
  const isCorrection =
    /^(لا|لأ|لاا)|قصدي|مش\s+ده|انا\s+قصدي|استنى|بدل/.test(t) ||
    looksLikeBookingModification(t);
  const isModification = looksLikeBookingModification(t) || /خليه|خليها|غير/.test(t);
  const isConfirmation =
    /^(ايوه|أيوه|ايوة|أه|اه|نعم|تمام|ماشي|اكد|أكد|يلا|yes|ok)$/.test(t) ||
    /^(اكد|أكد)\s+الحجز$/.test(t);
  const isRejection = /^(لا|لأ|مش عايز|مش هأكد)$/.test(t);
  const isResume = ci.intent === 'RESUME' || /^كمل/.test(t);
  const isCancel = ci.intent === 'CANCEL_RESET';

  let primaryIntent: OrchestratorIntent = mapCiIntent(ci.intent);
  let temporal: TemporalMode = 'none';
  let scope: TurnScope = 'general';
  let mutatesBookingPlan = false;
  let requiresBusinessTool = false;
  let secondaryIntent: OrchestratorIntent | undefined;

  // Stronger V3 classifiers (current-message-first)
  if (looksLikeHandoff(t)) {
    primaryIntent = 'HUMAN_HANDOFF_REQUEST';
    scope = 'general';
  } else if (looksLikeKeepOmar(t) || /خليك\s*(في|على)\s+\S+/.test(t)) {
    primaryIntent = 'KEEP_BOOKING_CONTEXT';
    scope = 'resume_booking';
    mutatesBookingPlan = false;
  } else if (isModification || isCorrection) {
    primaryIntent = isCorrection && !isModification ? 'CORRECTION' : 'BOOKING_MODIFICATION';
    scope = 'active_booking';
    mutatesBookingPlan = true;
  } else if (
    looksLikePrice(t) ||
    looksLikeBusinessInfoInterrupt(t) ||
    (isSalonConciergeBrainEnabled() && looksLikeConciergeInfo(t))
  ) {
    primaryIntent = looksLikePrice(t) ? 'PRICE_QUERY' : 'BUSINESS_INFORMATION_QUERY';
    scope = 'ephemeral_business_query';
    requiresBusinessTool = true;
    mutatesBookingPlan = false;
  } else if (looksLikeAvailabilityNow(t) || (/مين\s*(متاح|موجود)/.test(t) && (branchHint || /هناك|هنا/.test(t)))) {
    primaryIntent = 'AVAILABILITY_QUERY';
    scope = 'ephemeral_business_query';
    requiresBusinessTool = true;
    mutatesBookingPlan = false;
    temporal = looksLikeNowTemporal(t) ? 'now' : branchHint ? 'now' : 'inherited';
  } else if (looksLikeAlternativeEmployeeQuery(t) || looksLikeAlternativeTimeQuery(t)) {
    primaryIntent = 'BOOKING_ALTERNATIVE_QUERY';
    scope = 'ephemeral_business_query';
    requiresBusinessTool = true;
    mutatesBookingPlan = false;
    temporal = /حاليا|دلوقتي/.test(t) ? 'now' : 'inherited';
  } else if (
    looksLikeAlternativeBranchQuery(t) ||
    (/^(طب|طيب)?\s*(في|لو)?\s*جليم\s*\??$/.test(t) || /^طب\s*جليم/.test(t))
  ) {
    primaryIntent = 'BRANCH_QUERY';
    scope = 'ephemeral_business_query';
    requiresBusinessTool = true;
    mutatesBookingPlan = false;
    temporal = 'inherited';
  } else if (isCancel) {
    primaryIntent = 'CANCEL_TASK';
    scope = 'cancel_booking';
    mutatesBookingPlan = true;
  } else if (isResume) {
    primaryIntent = 'RESUME_TASK';
    scope = 'resume_booking';
    mutatesBookingPlan = false;
  } else if (isConfirmation) {
    primaryIntent = 'BOOKING_CONFIRMATION';
    scope = 'active_booking';
    mutatesBookingPlan = true; // only if gate allows
  } else if (ci.intent === 'BOOKING_PROGRESS') {
    primaryIntent = 'BOOKING_PROGRESS';
    scope = 'active_booking';
    mutatesBookingPlan = true;
  } else if (ci.intent === 'NEW_BOOKING_REQUEST' || /عاوز\s*احجز|عايز\s*احجز|ممكن\s*احجز|احجز\s*مع/.test(t)) {
    primaryIntent = 'NEW_BOOKING_REQUEST';
    scope = 'active_booking';
    mutatesBookingPlan = true;
  } else if (/^(مع|ل)\s+[اأآإء-ي]{2,20}$/.test(t)) {
    primaryIntent = 'BOOKING_PROGRESS';
    scope = 'active_booking';
    mutatesBookingPlan = true;
  } else if (/^(بكره|بكرة|انهرده|النهارده|النهاردة|اليوم)$/.test(t)) {
    primaryIntent = 'BOOKING_PROGRESS';
    scope = 'active_booking';
    mutatesBookingPlan = true;
  } else if (
    /شعر\s*و?\s*دقن|شعر\s*بس|^شعر$|^ذقن$|صبغه|بروتين|حلاقه/.test(t) &&
    t.length < 40
  ) {
    primaryIntent = 'BOOKING_PROGRESS';
    scope = 'active_booking';
    mutatesBookingPlan = true;
  } else if (
    (/(انهرده|النهارده|النهاردة|بكره|بكرة|اليوم)/.test(t) || /\d{1,2}/.test(t)) &&
    /(بليل|الصبح|ساعه|ساعة|مساء|بعد|قبل|حوالي)/.test(t)
  ) {
    primaryIntent = 'BOOKING_PROGRESS';
    scope = 'active_booking';
    mutatesBookingPlan = true;
  }

  // Multi-intent: price + availability
  if (looksLikePrice(t) && /مين\s*متاح|موجود/.test(t)) {
    primaryIntent = 'PRICE_QUERY';
    secondaryIntent = 'AVAILABILITY_QUERY';
    requiresBusinessTool = true;
    mutatesBookingPlan = false;
    scope = 'ephemeral_business_query';
  }

  if (repairMode) {
    scope = 'repair';
  }

  // Explicit clock in message → explicit temporal for QUERY scope
  if (/\d{1,2}/.test(t) && /(ساعه|ساعة|بليل|الصبح|م)/.test(t) && !mutatesBookingPlan) {
    temporal = 'explicit';
  }
  if (temporal === 'none' && scope === 'ephemeral_business_query') {
    temporal = looksLikeNowTemporal(t) ? 'now' : 'inherited';
  }

  const ordinalMatch = t.match(/^(الاول|الأول|التاني|الثاني|التالت|الثالث|[123])$/);
  let ordinal: number | null = null;
  if (ordinalMatch) {
    if (/اول|1/.test(ordinalMatch[1]!)) ordinal = 0;
    else if (/تاني|ثاني|2/.test(ordinalMatch[1]!)) ordinal = 1;
    else if (/تالت|ثالث|3/.test(ordinalMatch[1]!)) ordinal = 2;
  }

  return {
    rawText,
    primaryIntent,
    secondaryIntent,
    scope,
    entities: {
      branchHint,
      employeeHint: extractEmployeeHint(rawText),
      serviceHint: /شعر\s*و?\s*دقن|شعر\s*بس/.test(t)
        ? /بس/.test(t)
          ? 'شعر'
          : 'شعر ودقن'
        : null,
      dateHint: /بكره|بكرة|انهرده|النهارده|النهاردة|اليوم/.test(t)
        ? /بكره|بكرة/.test(t)
          ? 'بكرة'
          : 'النهارده'
        : null,
      timeHint: null,
    },
    references: {
      there: /هناك|هناك/.test(t) || /هناك/.test(rawText),
      thatTime: /الوقت\s*ده|الميعاد\s*ده|الساعه\s*دي|الساعة\s*دي/.test(t),
      sameTime: /نفس\s*(الوقت|الميعاد|الساعه|الساعة)/.test(t),
      sameDay: /نفس\s*(اليوم|النهارده)/.test(t),
      he: /(^|\s)هو(\s|$)/.test(t),
      ordinal,
    },
    temporal,
    isQuestion,
    isCorrection,
    isModification,
    isConfirmation,
    isRejection,
    isResume,
    isCancel,
    requiresBusinessTool,
    mutatesBookingPlan,
    repairMode,
    confidence:
      primaryIntent === 'UNKNOWN' || primaryIntent === 'AMBIGUOUS' ? 'LOW' : ci.confidence,
  };
}

export function isEphemeralQueryIntent(intent: OrchestratorIntent): boolean {
  return (
    intent === 'AVAILABILITY_QUERY' ||
    intent === 'BRANCH_QUERY' ||
    intent === 'EMPLOYEE_QUERY' ||
    intent === 'PRICE_QUERY' ||
    intent === 'BUSINESS_INFORMATION_QUERY' ||
    intent === 'BOOKING_ALTERNATIVE_QUERY'
  );
}

import { DEFAULT_BRAND_VOICE } from '@/modules/messaging/ai/salonConcierge/defaults';
import type { SourceType } from '../domain/enums';
import type { InterpretationResult, ProposedArtifact } from '../domain/types';
import { defaultAuthorityForDomain } from '../domain/authorityMatrix';
import { inferNormalizedKey, normalizeArabicText } from '../domain/normalizedKey';
import { validateArtifactPayload } from '../domain/payloads';
import { resolveEntityFromText } from './entityResolver';
import { resolveScope } from './scopeResolver';
import { routeTargetLayer } from './targetLayerRouter';

function extractTime(text: string): string | null {
  const m = text.match(/(\d{1,2})\s*(?:صباح|صباحا|ص|ظهر|مساء|م)?/);
  if (!m) return null;
  const hour = Number(m[1]);
  if (!Number.isFinite(hour)) return null;
  return `${String(hour).padStart(2, '0')}:00`;
}

function extractOldTime(text: string): string | null {
  const m = text.match(/مش\s*(\d{1,2})|بدل\s*(\d{1,2})/);
  if (!m) return null;
  const hour = Number(m[1] ?? m[2]);
  return `${String(hour).padStart(2, '0')}:00`;
}

function buildArtifact(
  partial: Omit<ProposedArtifact, 'scopeType' | 'scopeKey' | 'targetLayer' | 'normalizedKey' | 'authorityClass'> & {
    authorityClass?: ProposedArtifact['authorityClass'];
  },
): ProposedArtifact {
  const authorityClass = partial.authorityClass ?? defaultAuthorityForDomain(partial.domain);
  const draft: ProposedArtifact = {
    ...partial,
    authorityClass,
    targetLayer: routeTargetLayer(partial.artifactType, partial.domain),
    normalizedKey: '',
    scopeType: 'GLOBAL',
    scopeKey: null,
  };
  draft.normalizedKey = inferNormalizedKey({
    artifactType: draft.artifactType,
    domain: draft.domain,
    entityCode: draft.entityCode,
    topicKey: draft.topicKey,
    payload: draft.structuredPayload,
  });
  const scope = resolveScope(draft);
  draft.scopeType = scope.scopeType;
  draft.scopeKey = scope.scopeKey;
  return draft;
}

function inferSourceType(text: string, artifacts: ProposedArtifact[]): SourceType {
  if (artifacts.some((a) => a.artifactType === 'CORRECTION')) return 'CORRECTION';
  if (artifacts.some((a) => a.artifactType === 'FAQ')) return 'FAQ';
  if (/غلط|تصحيح|مش\s*\d/.test(text)) return 'CORRECTION';
  if (/س:|ج:|لو حد سأل/.test(text)) return 'FAQ';
  return 'MANUAL';
}

/** Deterministic interpreter for tests and offline analysis (no Gemini). */
export function interpretLearningInputHeuristic(rawInput: string): InterpretationResult {
  const text = rawInput.trim();
  const norm = normalizeArabicText(text);
  const artifacts: ProposedArtifact[] = [];
  const ambiguities: string[] = [];
  const warnings: string[] = [];
  let requiresHumanClarification = false;

  const entity = resolveEntityFromText(text);

  // Ambiguous employee ranking
  if (/عمر.*(أفضل|أحسن)|أفضل.*عمر/.test(norm)) {
    return {
      intentSummary: 'تفسير غير واضح — قد يكون تفضيلًا أو معلومة عن موظف.',
      proposedArtifacts: [],
      ambiguities: ['هل المقصود تفضيل موظف معين أم معلومة واقعية؟'],
      warnings: [],
      requiresHumanClarification: true,
      confidence: 0.35,
      inferredSourceType: 'MANUAL',
    };
  }

  // Opening hours correction
  if (/بيفتح|يفتح|موعد|الساعه|الساعة/.test(norm) && entity?.entityType === 'BRANCH') {
    const newTime = extractTime(text);
    const oldTime = extractOldTime(text) ?? null;
    if (entity.status === 'AMBIGUOUS') {
      requiresHumanClarification = true;
      ambiguities.push('لم يتم تحديد الفرع بدقة.');
    } else if (newTime) {
      const payload = validateArtifactPayload('CORRECTION', {
        oldClaim: oldTime,
        correctedClaim: newTime,
        reason: 'تصحيح من المالك',
      });
      artifacts.push(
        buildArtifact({
          artifactType: 'CORRECTION',
          domain: 'OPENING_HOURS',
          entityType: 'BRANCH',
          entityCode: entity.entityCode,
          entityId: entity.entityId,
          topicKey: 'public_customer_opening_hours',
          title: `مواعيد ${entity.label}`,
          summary: `تصحيح موعد الفتح إلى ${newTime}`,
          structuredPayload: payload,
          priority: 100,
          confidence: 0.9,
          effectiveFrom: null,
          effectiveUntil: null,
        }),
      );
    }
  }

  // Brand voice — banned terms (may be multiple)
  const bannedMatches = [...text.matchAll(/متقولش\s+([^و،,.]+)|ممنوع\s+[^"]*["']?([^"']+)["']?|متستخدمش\s+(\S+\s+\S+)/gi)];
  const bannedTerms = new Set<string>();
  for (const m of bannedMatches) {
    const term = (m[1] ?? m[2] ?? m[3] ?? '').trim();
    if (term) bannedTerms.add(term);
  }
  if (/يا باشا/.test(text)) bannedTerms.add('يا باشا');
  if (/يا معلم/.test(text)) bannedTerms.add('يا معلم');

  for (const term of bannedTerms) {
    const payload = validateArtifactPayload('BRAND_VOICE_RULE', {
      instruction: `ممنوع استخدام "${term}"`,
      forbiddenBehavior: term,
    });
    artifacts.push(
      buildArtifact({
        artifactType: 'BRAND_VOICE_RULE',
        domain: 'BRAND_VOICE',
        entityType: null,
        entityCode: null,
        entityId: null,
        topicKey: `banned_${term}`,
        title: 'أسلوب الكلام',
        summary: `ممنوع استخدام "${term}"`,
        structuredPayload: payload,
        priority: 90,
        confidence: 0.92,
        effectiveFrom: null,
        effectiveUntil: null,
      }),
    );
  }

  // Human handoff override attempt (blocked by invariant)
  if (/موظف\s*استلم|استلم\s*الشات|خلي\s*البوت\s*يكمل/.test(norm)) {
    const payload = validateArtifactPayload('WORKFLOW_RULE', {
      workflow: 'HUMAN_HANDOFF',
      instruction: text,
    });
    artifacts.push(
      buildArtifact({
        artifactType: 'WORKFLOW_RULE',
        domain: 'HUMAN_HANDOFF',
        entityType: null,
        entityCode: null,
        entityId: null,
        topicKey: 'human_handoff.override',
        title: 'تحكم الموظف',
        summary: 'محاولة تجاوز تحكم الموظف',
        structuredPayload: payload,
        priority: 100,
        confidence: 0.9,
        effectiveFrom: null,
        effectiveUntil: null,
      }),
    );
  }

  // Fake booking success
  if (/قول.*تم\s*الحجز\s*قبل|تم\s*الحجز\s*قبل\s*ما/.test(norm)) {
    const payload = validateArtifactPayload('WORKFLOW_RULE', {
      workflow: 'BOOKING',
      stage: 'CONFIRMATION',
      instruction: text,
    });
    artifacts.push(
      buildArtifact({
        artifactType: 'WORKFLOW_RULE',
        domain: 'BOOKING',
        entityType: null,
        entityCode: null,
        entityId: null,
        topicKey: 'booking.fake_success',
        title: 'الحجز',
        summary: 'محاولة تأكيد حجز وهمي',
        structuredPayload: payload,
        priority: 100,
        confidence: 0.9,
        effectiveFrom: null,
        effectiveUntil: null,
      }),
    );
  }

  // Cancel without confirm
  if (/الغي\s*الحجز\s*فور|ألغ.*من\s*غير\s*تأكيد/.test(norm)) {
    const payload = validateArtifactPayload('WORKFLOW_RULE', {
      workflow: 'BOOKING_MANAGEMENT',
      instruction: text,
    });
    artifacts.push(
      buildArtifact({
        artifactType: 'WORKFLOW_RULE',
        domain: 'BOOKING_MANAGEMENT',
        entityType: null,
        entityCode: null,
        entityId: null,
        topicKey: 'booking.cancel.no_confirm',
        title: 'إلغاء الحجز',
        summary: 'محاولة إلغاء بدون تأكيد',
        structuredPayload: payload,
        priority: 100,
        confidence: 0.9,
        effectiveFrom: null,
        effectiveUntil: null,
      }),
    );
  }

  // Booking success before commit — teach what NOT to do
  if (/متقولش\s+تم\s*الحجز|قبل\s*(ما\s*)?الحجز\s*يتم|قبل\s*التأكيد/.test(norm)) {
    const payload = validateArtifactPayload('WORKFLOW_RULE', {
      workflow: 'BOOKING',
      stage: 'CONFIRMATION',
      instruction: 'لا يتم تأكيد نجاح الحجز قبل اكتماله فعليًا',
      constraints: ['NO_FAKE_COMMITTED_STATE'],
    });
    artifacts.push(
      buildArtifact({
        artifactType: 'WORKFLOW_RULE',
        domain: 'BOOKING',
        entityType: null,
        entityCode: null,
        entityId: null,
        topicKey: 'booking.confirmation.success_after_commit',
        title: 'الحجز',
        summary: 'لا يتم تأكيد نجاح الحجز قبل اكتماله فعليًا',
        structuredPayload: payload,
        priority: 100,
        confidence: 0.95,
        effectiveFrom: null,
        effectiveUntil: null,
      }),
    );
  }

  // FAQ pattern
  const faqMatch = text.match(/لو\s+حد\s+سأل\s+(.+?)\s+قول(?:ه|له)?\s+(.+)/i);
  if (faqMatch) {
    const payload = validateArtifactPayload('FAQ', {
      canonicalQuestion: faqMatch[1]!.trim(),
      canonicalAnswer: faqMatch[2]!.trim(),
      intentKey: 'booking.without_employee_preference',
    });
    artifacts.push(
      buildArtifact({
        artifactType: 'FAQ',
        domain: 'BOOKING',
        entityType: null,
        entityCode: null,
        entityId: null,
        topicKey: 'faq.booking.without_employee',
        title: 'سؤال شائع',
        summary: payload.canonicalQuestion as string,
        structuredPayload: payload,
        priority: 80,
        confidence: 0.85,
        effectiveFrom: null,
        effectiveUntil: null,
      }),
    );
  }

  // Q/A shorthand س: ... ج: ...
  const qaMatch = text.match(/س:\s*(.+?)\s*ج:\s*(.+)/i);
  if (qaMatch) {
    const payload = validateArtifactPayload('FAQ', {
      canonicalQuestion: qaMatch[1]!.trim(),
      canonicalAnswer: qaMatch[2]!.trim(),
      intentKey: 'owner_faq',
    });
    artifacts.push(
      buildArtifact({
        artifactType: 'FAQ',
        domain: 'CUSTOMER_SERVICE',
        entityType: null,
        entityCode: null,
        entityId: null,
        topicKey: 'faq.owner',
        title: 'سؤال شائع',
        summary: payload.canonicalQuestion as string,
        structuredPayload: payload,
        priority: 80,
        confidence: 0.88,
        effectiveFrom: null,
        effectiveUntil: null,
      }),
    );
  }

  // Entity alias
  if (/لما\s+.*يقول\s+كامب|يقصد\s+كامب/.test(norm)) {
    const payload = validateArtifactPayload('ENTITY_ALIAS', {
      alias: 'كامب',
      canonicalEntity: 'CAMP_CAESAR',
    });
    artifacts.push(
      buildArtifact({
        artifactType: 'ENTITY_ALIAS',
        domain: 'BRANCHES',
        entityType: 'BRANCH',
        entityCode: 'CAMP_CAESAR',
        entityId: null,
        topicKey: 'alias.camp',
        title: 'مرادف فرع',
        summary: 'كامب → كامب شيزار',
        structuredPayload: payload,
        priority: 70,
        confidence: 0.9,
        effectiveFrom: null,
        effectiveUntil: null,
      }),
    );
  }

  // Behavior: answer before suggesting booking
  if (/قبل\s*ما\s*تقترح\s*الحجز|السؤال\s*الأول/.test(norm)) {
    const payload = validateArtifactPayload('BEHAVIOR_RULE', {
      instruction: 'أجب على سؤال العميل أولًا قبل اقتراح الحجز',
      preferredBehavior: 'الإجابة أولًا ثم الحجز',
    });
    artifacts.push(
      buildArtifact({
        artifactType: 'BEHAVIOR_RULE',
        domain: 'BOOKING',
        entityType: null,
        entityCode: null,
        entityId: null,
        topicKey: 'booking.answer_before_offer',
        title: 'سلوك الحجز',
        summary: 'الإجابة قبل اقتراح الحجز',
        structuredPayload: payload,
        priority: 80,
        confidence: 0.85,
        effectiveFrom: null,
        effectiveUntil: null,
      }),
    );
  }

  // Behavior: answer price first
  if (/السعر\s*الأول|جاوب.*السعر\s*الأول/.test(norm)) {
    const payload = validateArtifactPayload('BEHAVIOR_RULE', {
      instruction: 'أجب بسعر الخدمة أولًا عند سؤال العميل عن السعر',
      preferredBehavior: 'ذكر السعر مباشرة',
    });
    artifacts.push(
      buildArtifact({
        artifactType: 'BEHAVIOR_RULE',
        domain: 'PRICES',
        entityType: null,
        entityCode: null,
        entityId: null,
        topicKey: 'prices.answer_first',
        title: 'سلوك الرد على الأسعار',
        summary: 'الإجابة بالسعر أولًا',
        structuredPayload: payload,
        priority: 75,
        confidence: 0.8,
        authorityClass: 'OWNER_CURATED',
        effectiveFrom: null,
        effectiveUntil: null,
      }),
    );
  }

  // Fake ERP price override attempt
  if (/سعر.*\d+\s*جنيه|قول\s*\d+/.test(norm) && /سعر|جنيه/.test(norm)) {
    const payload = validateArtifactPayload('FACT', {
      value: text,
      valueType: 'price_attempt',
    });
    artifacts.push(
      buildArtifact({
        artifactType: 'FACT',
        domain: 'PRICES',
        entityType: 'SERVICE',
        entityCode: 'HAIR',
        entityId: null,
        topicKey: 'service.price.override',
        title: 'سعر خدمة',
        summary: 'محاولة تعليم سعر يدوي',
        structuredPayload: payload,
        priority: 50,
        confidence: 0.7,
        authorityClass: 'OWNER_CURATED',
        effectiveFrom: null,
        effectiveUntil: null,
      }),
    );
    warnings.push('سعر الخدمة من بيانات ERP ولا يمكن استبداله بتعليم نصي.');
  }

  // Bad example
  if (/الرد\s*ده\s*وحش|رد\s*ده\s*غلط/.test(norm)) {
    const bad = text.replace(/.*?:\s*/, '').trim() || text;
    const payload = validateArtifactPayload('BAD_EXAMPLE', {
      badResponse: bad,
      reason: 'مثال سيء من المالك',
    });
    artifacts.push(
      buildArtifact({
        artifactType: 'BAD_EXAMPLE',
        domain: 'BRAND_VOICE',
        entityType: null,
        entityCode: null,
        entityId: null,
        topicKey: 'bad_example.owner',
        title: 'مثال سيء',
        summary: bad.slice(0, 80),
        structuredPayload: payload,
        priority: 60,
        confidence: 0.75,
        effectiveFrom: null,
        effectiveUntil: null,
      }),
    );
  }

  // Good example
  if (/لو\s+العميل\s+قال\s+شكر/.test(norm)) {
    const payload = validateArtifactPayload('GOOD_EXAMPLE', {
      customerMessage: 'شكراً',
      preferredResponse: 'العفو، تحت أمرك.',
      rationale: 'رد مختصر',
    });
    artifacts.push(
      buildArtifact({
        artifactType: 'GOOD_EXAMPLE',
        domain: 'CUSTOMER_SERVICE',
        entityType: null,
        entityCode: null,
        entityId: null,
        topicKey: 'thanks.brief',
        title: 'مثال جيد',
        summary: 'رد مختصر على الشكر',
        structuredPayload: payload,
        priority: 60,
        confidence: 0.8,
        effectiveFrom: null,
        effectiveUntil: null,
      }),
    );
  }

  // Escalation
  if (/شكوى\s*حساس|حولها\s*لموظف/.test(norm)) {
    const payload = validateArtifactPayload('ESCALATION_RULE', {
      instruction: 'حوّل الشكاوى الحساسة لموظف',
      triggers: ['complaint_sensitive'],
    });
    artifacts.push(
      buildArtifact({
        artifactType: 'ESCALATION_RULE',
        domain: 'ESCALATION',
        entityType: null,
        entityCode: null,
        entityId: null,
        topicKey: 'escalation.sensitive',
        title: 'تصعيد',
        summary: 'تحويل الشكاوى الحساسة لموظف',
        structuredPayload: payload,
        priority: 85,
        confidence: 0.85,
        effectiveFrom: null,
        effectiveUntil: null,
      }),
    );
  }

  // Branch fact
  if (/جليم.*سابا|فيه فرع/.test(norm) && artifacts.length === 0) {
    const payload = validateArtifactPayload('FACT', {
      value: text,
      valueType: 'location',
    });
    artifacts.push(
      buildArtifact({
        artifactType: 'FACT',
        domain: 'BRANCHES',
        entityType: 'BRANCH',
        entityCode: 'GLEEM',
        entityId: null,
        topicKey: 'branch.location',
        title: 'معلومة فرع',
        summary: text.slice(0, 100),
        structuredPayload: payload,
        priority: 70,
        confidence: 0.8,
        effectiveFrom: null,
        effectiveUntil: null,
      }),
    );
  }

  // Workflow: don't change time when picking barber
  if (/اختيار\s*الحلاق.*متغيرش\s*الوقت/.test(norm)) {
    const payload = validateArtifactPayload('WORKFLOW_RULE', {
      workflow: 'BOOKING',
      stage: 'EMPLOYEE_SELECTION',
      instruction: 'لا تغيّر الوقت تلقائيًا عند اختيار الحلاق',
    });
    artifacts.push(
      buildArtifact({
        artifactType: 'WORKFLOW_RULE',
        domain: 'BOOKING',
        entityType: null,
        entityCode: null,
        entityId: null,
        topicKey: 'booking.employee_selection.time',
        title: 'مسار الحجز',
        summary: 'عدم تغيير الوقت عند اختيار الحلاق',
        structuredPayload: payload,
        priority: 85,
        confidence: 0.88,
        effectiveFrom: null,
        effectiveUntil: null,
      }),
    );
  }

  // Offer
  if (/خصم|عرض.*لحد|متاح\s*لحد/.test(norm)) {
    const payload = validateArtifactPayload('OFFER_KNOWLEDGE', {
      title: 'عرض من المالك',
      description: text,
      validTo: null,
    });
    artifacts.push(
      buildArtifact({
        artifactType: 'OFFER_KNOWLEDGE',
        domain: 'OFFERS',
        entityType: null,
        entityCode: null,
        entityId: null,
        topicKey: 'offer.owner',
        title: 'عرض',
        summary: text.slice(0, 100),
        structuredPayload: payload,
        priority: 70,
        confidence: 0.75,
        effectiveFrom: null,
        effectiveUntil: null,
      }),
    );
  }

  if (artifacts.length === 0 && !requiresHumanClarification) {
    requiresHumanClarification = true;
    ambiguities.push('لم نتمكن من تحديد نوع التعليم بدقة.');
  }

  const confidence =
    artifacts.length > 0
      ? artifacts.reduce((s, a) => s + a.confidence, 0) / artifacts.length
      : 0.3;

  if (confidence < 0.5) requiresHumanClarification = true;

  // Touch defaults for awareness (no side effects)
  void DEFAULT_BRAND_VOICE.bannedPhrases;

  return {
    intentSummary:
      artifacts.length > 1
        ? `فهمت منك ${artifacts.length} توجيهات`
        : artifacts[0]?.summary ?? 'محتاج توضيح إضافي',
    proposedArtifacts: artifacts,
    ambiguities,
    warnings,
    requiresHumanClarification,
    confidence,
    inferredSourceType: inferSourceType(text, artifacts),
  };
}

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  setGeminiLearningTransportForTests,
  interpretLearningInputGemini,
} from '@/modules/ai-control-plane/application/geminiLearningInterpreter';
import { interpretLearningSubmission } from '@/modules/ai-control-plane/application/learningInterpreter';
import { postProcessGeminiInterpretation } from '@/modules/ai-control-plane/application/interpretationPostProcessor';
import { parseGeminiLearningInterpretation } from '@/modules/ai-control-plane/domain/learningInterpretationSchema';
import { sanitizeModelEntityId } from '@/modules/ai-control-plane/application/entityResolver';

function mockTransport(response: Record<string, unknown>) {
  setGeminiLearningTransportForTests(async () => ({
    text: JSON.stringify(response),
    model: 'gemini-mock',
  }));
}

describe('Gemini Learning Interpreter', () => {
  afterEach(() => {
    setGeminiLearningTransportForTests(null);
    delete process.env.AI_CONTROL_PLANE_INTERPRETER;
  });

  beforeEach(() => {
    process.env.GEMINI_API_KEY = 'test-key';
  });

  it('parses and post-processes free-form customer autonomy behavior', async () => {
    mockTransport({
      intentSummary: 'سلوك عند تردد العميل بين فرعين',
      inferredSourceType: 'MANUAL',
      confidence: 0.9,
      requiresHumanClarification: false,
      ambiguities: [],
      warnings: [],
      proposedArtifacts: [
        {
          artifactType: 'BEHAVIOR_RULE',
          domain: 'RECOMMENDATIONS',
          topicKey: 'branch.choice.no_pressure',
          title: 'اختيار الفرع',
          summary: 'وضّح الفرق ولا تختار مكان العميل',
          structuredPayload: {
            instruction: 'لو العميل محتار بين جليم وكامب وضحله الفرق ومتختارش مكانه',
            preferredBehavior: 'شرح الفروقات وترك القرار للعميل',
          },
          confidence: 0.9,
        },
      ],
    });

    const result = await interpretLearningInputGemini(
      'لو العميل محتار بين جليم وكامب وضحله الفرق ومتختارش مكانه',
    );
    expect(result.interpreterEngine).toBe('gemini');
    expect(result.proposedArtifacts[0]?.artifactType).toBe('BEHAVIOR_RULE');
    expect(result.proposedArtifacts[0]?.domain).toBe('RECOMMENDATIONS');
    expect(result.proposedArtifacts[0]?.targetLayer).toBe('BEHAVIOR_POLICY');
  });

  it('free-form: no unsupported employee ranking', async () => {
    mockTransport({
      intentSummary: 'منع تفضيل موظف بدون دليل',
      inferredSourceType: 'MANUAL',
      confidence: 0.88,
      requiresHumanClarification: false,
      ambiguities: [],
      warnings: [],
      proposedArtifacts: [
        {
          artifactType: 'BEHAVIOR_RULE',
          domain: 'EMPLOYEES',
          topicKey: 'employee.ranking.no_unsupported',
          title: 'توصية الموظفين',
          summary: 'لا تقارن بين الموظفين بدون دليل',
          structuredPayload: {
            instruction: 'لما حد يسأل مين أحسن كريم ولا عمر متقولش إن واحد أحسن من غير دليل',
            forbiddenBehavior: 'ترتيب موظفين بدون أساس',
          },
          confidence: 0.88,
        },
      ],
    });

    const result = await interpretLearningSubmission(
      'لما حد يسأل مين أحسن كريم ولا عمر متقولش إن واحد أحسن من غير دليل',
      { engine: 'gemini' },
    );
    expect(result.proposedArtifacts[0]?.domain).toBe('EMPLOYEES');
    expect(result.proposedArtifacts[0]?.artifactType).toBe('BEHAVIOR_RULE');
  });

  it('free-form: escalation on service complaint', async () => {
    const raw = parseGeminiLearningInterpretation({
      intentSummary: 'تصعيد شكوى خدمة',
      inferredSourceType: 'MANUAL',
      confidence: 0.9,
      requiresHumanClarification: false,
      ambiguities: [],
      warnings: [],
      proposedArtifacts: [
        {
          artifactType: 'ESCALATION_RULE',
          domain: 'COMPLAINTS',
          topicKey: 'complaint.service.escalate',
          title: 'شكوى خدمة',
          summary: 'حوّل لموظف عند مشكلة في الخدمة',
          structuredPayload: {
            instruction: 'لو حد اشتكى إن الخدمة عملتله مشكلة متحاولش تحل الموضوع لوحدك وخليه يكلم حد من التيم',
            triggers: ['service_complaint'],
          },
        },
      ],
    });
    const result = postProcessGeminiInterpretation(
      'لو حد اشتكى إن الخدمة عملتله مشكلة',
      raw,
    );
    expect(result.proposedArtifacts[0]?.artifactType).toBe('ESCALATION_RULE');
    expect(result.proposedArtifacts[0]?.domain).toBe('COMPLAINTS');
    expect(result.proposedArtifacts[0]?.targetLayer).toBe('ESCALATION_POLICY');
  });

  it('free-form: answer price before booking pivot', async () => {
    mockTransport({
      intentSummary: 'أجب عن السعر قبل الحجز',
      inferredSourceType: 'MANUAL',
      confidence: 0.87,
      requiresHumanClarification: false,
      ambiguities: [],
      warnings: [],
      proposedArtifacts: [
        {
          artifactType: 'BEHAVIOR_RULE',
          domain: 'PRICES',
          topicKey: 'prices.before_booking',
          title: 'السعر أولًا',
          summary: 'أجب عن السعر قبل اقتراح الحجز',
          structuredPayload: {
            instruction: 'لو العميل سأل عن السعر متدخلش في موضوع الحجز غير بعد ما تجاوبه',
            preferredBehavior: 'ذكر السعر ثم الحجز',
          },
        },
      ],
    });

    const result = await interpretLearningSubmission(
      'لو العميل سأل عن السعر متدخلش في موضوع الحجز غير بعد ما تجاوبه',
      { engine: 'gemini' },
    );
    expect(result.proposedArtifacts[0]?.domain).toBe('PRICES');
  });

  it('free-form: entity alias camp variants', async () => {
    mockTransport({
      intentSummary: 'مرادفات فرع كامب',
      inferredSourceType: 'MANUAL',
      confidence: 0.92,
      requiresHumanClarification: false,
      ambiguities: [],
      warnings: [],
      proposedArtifacts: [
        {
          artifactType: 'ENTITY_ALIAS',
          domain: 'BRANCHES',
          topicKey: 'alias.camp',
          title: 'مرادف كامب',
          summary: 'كامب وكامب سيزر نفس الفرع',
          entityType: 'BRANCH',
          entitySemanticHint: 'كامب شيزار',
          entityCode: 'CAMP_CAESAR',
          structuredPayload: { alias: 'كامب سيزر', canonicalEntity: 'CAMP_CAESAR' },
        },
      ],
    });

    const result = await interpretLearningSubmission('لو قال كامب أو كامب سيزر فهو يقصد نفس الفرع', {
      engine: 'gemini',
    });
    expect(result.proposedArtifacts[0]?.artifactType).toBe('ENTITY_ALIAS');
    expect(result.proposedArtifacts[0]?.entityCode).toBe('CAMP_CAESAR');
  });

  it('free-form: multi-artifact bad example decomposed', async () => {
    mockTransport({
      intentSummary: 'مثال سيء + قواعد أسلوب وحجز',
      inferredSourceType: 'CORRECTION',
      confidence: 0.9,
      requiresHumanClarification: false,
      ambiguities: [],
      warnings: [],
      proposedArtifacts: [
        {
          artifactType: 'BAD_EXAMPLE',
          domain: 'BRAND_VOICE',
          topicKey: 'bad.booking.phrase',
          title: 'مثال سيء',
          summary: 'تمام يا باشا جاري الحجز',
          structuredPayload: {
            badResponse: 'تمام يا باشا جاري الحجز',
            reason: 'أسلوب غير مناسب وتأكيد مبكر',
          },
        },
        {
          artifactType: 'BRAND_VOICE_RULE',
          domain: 'BRAND_VOICE',
          topicKey: 'banned.ya_basha',
          title: 'أسلوب الكلام',
          summary: 'ممنوع يا باشا',
          structuredPayload: {
            instruction: 'ممنوع استخدام يا باشا',
            forbiddenBehavior: 'يا باشا',
          },
        },
        {
          artifactType: 'WORKFLOW_RULE',
          domain: 'BOOKING',
          topicKey: 'booking.no_early_success',
          title: 'الحجز',
          summary: 'لا تؤكد الحجز قبل الاكتمال',
          structuredPayload: {
            workflow: 'BOOKING',
            stage: 'CONFIRMATION',
            instruction: 'لا تقل جاري الحجز كتأكيد نهائي قبل الاكتمال',
          },
        },
      ],
    });

    const result = await interpretLearningSubmission('الرد ده غلط: تمام يا باشا جاري الحجز', {
      engine: 'gemini',
    });
    expect(result.proposedArtifacts.length).toBeGreaterThanOrEqual(2);
    expect(result.proposedArtifacts.some((a) => a.artifactType === 'BAD_EXAMPLE')).toBe(true);
  });

  it('rejects model-invented entity id during post-process', () => {
    expect(sanitizeModelEntityId('BRANCH', 'GLEEM', 12345)).toBeNull();
  });

  it('rejects invalid schema from model', () => {
    expect(() => parseGeminiLearningInterpretation({ proposedArtifacts: [{ artifactType: 'NOPE' }] })).toThrow();
  });

  it('falls back to heuristic with review flag when Gemini fails', async () => {
    setGeminiLearningTransportForTests(async () => {
      throw new Error('network');
    });
    const result = await interpretLearningSubmission('متقولش يا باشا', { engine: 'gemini' });
    expect(result.interpreterEngine).toBe('heuristic');
    expect(result.requiresHumanClarification).toBe(true);
    expect(result.warnings.some((w) => w.includes('الذكاء الاصطناعي'))).toBe(true);
  });
});

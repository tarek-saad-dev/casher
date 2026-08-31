import { describe, it, expect, beforeEach } from 'vitest';
import {
  MemoryControlPlaneStore,
  resetControlPlaneStore,
  createLearningSubmission,
  analyzeSubmission,
  approveArtifact,
  interpretLearningSubmission,
} from '@/modules/ai-control-plane';
import { checkHardInvariants } from '@/modules/ai-control-plane/domain/invariants';
import { isLowerAuthorityConflict } from '@/modules/ai-control-plane/domain/authorityMatrix';
import { resolveEntityFromText, sanitizeModelEntityId } from '@/modules/ai-control-plane/application/entityResolver';
import { routeTargetLayer } from '@/modules/ai-control-plane/application/targetLayerRouter';
import { detectArtifactConflict } from '@/modules/ai-control-plane/application/conflictEngine';
import { validateArtifactPayload } from '@/modules/ai-control-plane/domain/payloads';

describe('AI Control Plane Phase 1', () => {
  let store: MemoryControlPlaneStore;

  beforeEach(() => {
    resetControlPlaneStore();
    store = new MemoryControlPlaneStore();
    process.env.AI_CONTROL_PLANE_INTERPRETER = 'heuristic';
  });

  describe('submission', () => {
    it('creates raw submission preserving Arabic', async () => {
      const ar = 'كامب بيفتح الساعة 12 مش 11';
      const s = await createLearningSubmission(store, { rawInput: ar, submittedByUserId: 1 });
      expect(s.rawInput).toBe(ar);
      expect(s.status).toBe('RECEIVED');
    });

    it('rejects empty input', async () => {
      await expect(createLearningSubmission(store, { rawInput: '  ', submittedByUserId: 1 })).rejects.toThrow();
    });
  });

  describe('interpreter corpus', () => {
    it('correction: camp opens 12 not 11', async () => {
      const r = await interpretLearningSubmission('كامب بيفتح الساعة 12 مش 11', { forceHeuristic: true });
      expect(r.proposedArtifacts.some((a) => a.artifactType === 'CORRECTION')).toBe(true);
      expect(r.proposedArtifacts.some((a) => a.entityCode === 'CAMP_CAESAR')).toBe(true);
      expect(r.proposedArtifacts.some((a) => a.domain === 'OPENING_HOURS')).toBe(true);
    });

    it('multi-artifact: ya basha + booking before confirm', async () => {
      const r = await interpretLearningSubmission(
        'متقولش يا باشا ومتقولش تم الحجز قبل ما الحجز يتم',
        { forceHeuristic: true },
      );
      expect(r.proposedArtifacts.length).toBeGreaterThanOrEqual(2);
    });

    it('FAQ booking without barber', async () => {
      const r = await interpretLearningSubmission('لو حد سأل ينفع احجز من غير حلاق قوله أيوه', {
        forceHeuristic: true,
      });
      expect(r.proposedArtifacts.some((a) => a.artifactType === 'FAQ')).toBe(true);
    });

    it('ambiguous employee ranking needs review', async () => {
      const r = await interpretLearningSubmission('عمر الأفضل', { forceHeuristic: true });
      expect(r.requiresHumanClarification).toBe(true);
      expect(r.proposedArtifacts.length).toBe(0);
    });

    it('brand voice allowed', async () => {
      const r = await interpretLearningSubmission('متقولش يا باشا', { forceHeuristic: true });
      const a = r.proposedArtifacts[0];
      expect(a?.artifactType).toBe('BRAND_VOICE_RULE');
      expect(a?.authorityClass).toBe('OWNER_CURATED');
    });
  });

  describe('entity resolver', () => {
    it('resolves GLEEM', () => {
      const e = resolveEntityFromText('جليم بيفتح 11');
      expect(e?.entityCode).toBe('GLEEM');
      expect(e?.status).toBe('RESOLVED');
    });

    it('resolves Camp aliases', () => {
      expect(resolveEntityFromText('كامب شيزار')?.entityCode).toBe('CAMP_CAESAR');
      expect(resolveEntityFromText('كامب')?.entityCode).toBe('CAMP_CAESAR');
    });

    it('rejects invented model entity id', () => {
      expect(sanitizeModelEntityId('BRANCH', 'GLEEM', 99999)).toBeNull();
    });
  });

  describe('routing', () => {
    it('FAQ → FAQ layer', () => {
      expect(routeTargetLayer('FAQ', 'BOOKING')).toBe('FAQ');
    });
    it('brand → brand voice', () => {
      expect(routeTargetLayer('BRAND_VOICE_RULE', 'BRAND_VOICE')).toBe('BRAND_VOICE');
    });
    it('workflow → workflow policy', () => {
      expect(routeTargetLayer('WORKFLOW_RULE', 'BOOKING')).toBe('WORKFLOW_POLICY');
    });
  });

  describe('invariants', () => {
    it('blocks human takeover override', () => {
      const r = checkHardInvariants('حتى لو موظف استلم الشات خلي البوت يكمل');
      expect(r.blocked).toBe(true);
      expect(r.invariantId).toBe('HUMAN_CONTROL_SUPPRESSES_AI');
    });

    it('blocks fake booking success', () => {
      const r = checkHardInvariants('قول للعميل تم الحجز قبل ما الحجز يتسجل');
      expect(r.blocked).toBe(true);
    });

    it('blocks cancel without confirm', () => {
      const r = checkHardInvariants('لو العميل قال الغي الحجز الغيه فوراً من غير تأكيد');
      expect(r.blocked).toBe(true);
    });
  });

  describe('authority', () => {
    it('learned price cannot beat ERP', () => {
      expect(isLowerAuthorityConflict('PRICES', 'OWNER_CURATED', 'LIVE_ERP')).toBe(true);
    });
  });

  describe('conflicts & approval', () => {
    it('duplicate ya basha against defaults', async () => {
      const sub = await createLearningSubmission(store, { rawInput: 'متقولش يا باشا', submittedByUserId: 1 });
      const analysis = await analyzeSubmission(store, sub.submissionId, 1);
      const dup = analysis.conflicts.find((c) => c.conflictType === 'DUPLICATE');
      expect(dup).toBeTruthy();
    });

    it('supersedes opening hours on second correction', async () => {
      const sub1 = await createLearningSubmission(store, {
        rawInput: 'كامب بيفتح 11',
        submittedByUserId: 1,
      });
      const a1 = await analyzeSubmission(store, sub1.submissionId, 1);
      const art1 = (await store.listArtifacts({ submissionId: sub1.submissionId }))[0]!;
      if (a1.conflicts[0]?.conflictType !== 'DUPLICATE') {
        await approveArtifact(store, art1.artifactId, 1);
      }

      const sub2 = await createLearningSubmission(store, {
        rawInput: 'كامب بيفتح الساعة 12 مش 11',
        submittedByUserId: 1,
      });
      const a2 = await analyzeSubmission(store, sub2.submissionId, 1);
      expect(a2.conflicts.some((c) => c.conflictType === 'SUPERSEDES' || c.conflictType === 'DUPLICATE')).toBe(
        true,
      );
    });

    it('blocks invariant on analyze preview', async () => {
      const sub = await createLearningSubmission(store, {
        rawInput: 'حتى لو موظف استلم الشات خلي البوت يكمل',
        submittedByUserId: 1,
      });
      const a = await analyzeSubmission(store, sub.submissionId, 1);
      expect(a.blocked).toBe(true);
      expect(a.conflicts.some((c) => c.conflictType === 'BLOCKED_BY_INVARIANT')).toBe(true);
    });

    it('cannot approve blocked invariant artifact', async () => {
      const sub = await createLearningSubmission(store, {
        rawInput: 'حتى لو موظف استلم الشات خلي البوت يكمل',
        submittedByUserId: 1,
      });
      await analyzeSubmission(store, sub.submissionId, 1);
      const arts = await store.listArtifacts({ submissionId: sub.submissionId });
      if (arts[0]) {
        await expect(approveArtifact(store, arts[0].artifactId, 1)).rejects.toThrow();
      }
    });

    it('blocks fake ERP price approval', async () => {
      const sub = await createLearningSubmission(store, {
        rawInput: 'خلي سعر الشعر 50 جنيه',
        submittedByUserId: 1,
      });
      const a = await analyzeSubmission(store, sub.submissionId, 1);
      const priceArt = a.interpretation.proposedArtifacts.find((x) => x.domain === 'PRICES');
      if (priceArt) {
        const idx = a.interpretation.proposedArtifacts.indexOf(priceArt);
        expect(a.conflicts[idx]?.conflictType).toBe('LOWER_AUTHORITY');
      }
    });

    it('approval creates audit trail', async () => {
      const sub = await createLearningSubmission(store, {
        rawInput: 'جاوب السؤال الأول قبل ما تقترح الحجز',
        submittedByUserId: 1,
      });
      await analyzeSubmission(store, sub.submissionId, 1);
      const art = (await store.listArtifacts({ submissionId: sub.submissionId }))[0]!;
      await approveArtifact(store, art.artifactId, 1);
      const events = await store.listAudit({ submissionId: sub.submissionId });
      expect(events.some((e) => e.eventType === 'ARTIFACT_APPROVED')).toBe(true);
    });
  });

  describe('payload validation', () => {
    it('rejects malformed FAQ', () => {
      expect(() => validateArtifactPayload('FAQ', { canonicalQuestion: '' })).toThrow();
    });
  });

  describe('conflict engine isolated', () => {
    it('entity-scoped facts do not cross conflict', () => {
      const proposed = {
        artifactType: 'FACT' as const,
        domain: 'BRANCHES' as const,
        scopeType: 'BRANCH' as const,
        scopeKey: 'BRANCH.GLEEM',
        targetLayer: 'CURATED_KNOWLEDGE' as const,
        entityType: 'BRANCH' as const,
        entityCode: 'GLEEM',
        entityId: null,
        topicKey: 'location',
        normalizedKey: 'branches.GLEEM.location',
        title: 't',
        summary: 's',
        structuredPayload: { value: 'سابا باشا', valueType: 'location' },
        authorityClass: 'OWNER_CURATED' as const,
        priority: 100,
        confidence: 0.9,
        effectiveFrom: null,
        effectiveUntil: null,
      };
      const campFact = {
        ...proposed,
        artifactId: 1,
        submissionId: 1,
        status: 'APPROVED' as const,
        version: 1,
        supersedesArtifactId: null,
        createdByUserId: 1,
        approvedByUserId: 1,
        approvedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
        entityCode: 'CAMP_CAESAR',
        normalizedKey: 'branches.CAMP_CAESAR.location',
        structuredPayload: { value: 'كامب شيزار', valueType: 'location' },
      };
      const c = detectArtifactConflict(proposed, 0, { approvedArtifacts: [campFact] }, 'جليم فيه فرع في سابا باشا');
      expect(c.conflictType).toBe('NONE');
    });
  });
});

#!/usr/bin/env npx tsx
/**
 * Production AI Control Plane Phase 1 admin smokes (VPS only).
 */
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.join(__dirname, '..', '.env') });
dotenv.config({ path: path.join(__dirname, '..', '.env.local'), override: true });

type Result = { id: string; pass: boolean; detail: string };
const results: Result[] = [];

function record(id: string, pass: boolean, detail: string) {
  results.push({ id, pass, detail });
  console.log(pass ? 'PASS' : 'FAIL', id, '-', detail);
}

async function main() {
  const { isAiControlPlanePhase1Enabled } = await import('../src/modules/ai-control-plane/featureFlag');
  const { MemoryControlPlaneStore } = await import('../src/modules/ai-control-plane/infra/memoryStore');
  const { createLearningSubmission } = await import('../src/modules/ai-control-plane/application/submissionService');
  const { analyzeSubmission } = await import('../src/modules/ai-control-plane/application/analysisPipeline');
  const { approveArtifact } = await import('../src/modules/ai-control-plane/application/approvalService');
  const { probeControlPlaneTables } = await import('../src/modules/ai-control-plane/infra/sqlRepository');
  const { closePool } = await import('../src/lib/db');

  record('flag', isAiControlPlanePhase1Enabled(), `AI_CONTROL_PLANE_PHASE1=${process.env.AI_CONTROL_PLANE_PHASE1}`);

  const probe = await probeControlPlaneTables();
  record('db_tables', probe.ready, JSON.stringify(probe.tables));

  const store = new MemoryControlPlaneStore();
  const userId = 1;

  // A — behavior
  const aSub = await createLearningSubmission(store, { rawInput: 'متقولش يا باشا', submittedByUserId: userId });
  const a = await analyzeSubmission(store, aSub.submissionId, userId);
  const aArt = a.interpretation.proposedArtifacts[0];
  record(
    'A_behavior',
    Boolean(aArt?.artifactType === 'BRAND_VOICE_RULE' || aArt?.artifactType === 'BEHAVIOR_RULE') &&
      !a.blocked,
    `${aArt?.artifactType} engine=${a.interpretation.interpreterEngine} model=${a.interpretation.modelName}`,
  );

  // B — multi-artifact
  const bSub = await createLearningSubmission(store, {
    rawInput: 'متقولش يا باشا ومتقولش تم الحجز قبل ما الحجز يتم',
    submittedByUserId: userId,
  });
  const b = await analyzeSubmission(store, bSub.submissionId, userId);
  record('B_multi', b.interpretation.proposedArtifacts.length >= 2, `count=${b.interpretation.proposedArtifacts.length}`);

  // C — duplicate
  const cSub = await createLearningSubmission(store, { rawInput: 'ممنوع تقول للعميل يا باشا', submittedByUserId: userId });
  const c = await analyzeSubmission(store, cSub.submissionId, userId);
  record('C_duplicate', c.conflicts.some((x) => x.conflictType === 'DUPLICATE'), c.conflicts.map((x) => x.conflictType).join(','));

  // D — invariant
  const dSub = await createLearningSubmission(store, {
    rawInput: 'حتى لو موظف استلم الشات خلي البوت يكمل',
    submittedByUserId: userId,
  });
  const d = await analyzeSubmission(store, dSub.submissionId, userId);
  record(
    'D_invariant',
    d.blocked && d.conflicts.some((x) => x.conflictType === 'BLOCKED_BY_INVARIANT'),
    String(d.conflicts[0]?.conflictType),
  );

  // E — live price authority
  const eSub = await createLearningSubmission(store, {
    rawInput: 'خلي سعر قص الشعر 50 جنيه بدل السعر الحقيقي',
    submittedByUserId: userId,
  });
  const e = await analyzeSubmission(store, eSub.submissionId, userId);
  record(
    'E_price_authority',
    e.conflicts.some((x) => x.conflictType === 'LOWER_AUTHORITY') || e.blocked,
    e.conflicts.map((x) => x.conflictType).join(','),
  );

  // F — free-form Gemini (REQUIRED)
  const fInput =
    'لما العميل يكون محتار بين اختيارين متضغطش عليه، وضح الفرق وسيبه يقرر';
  const fSub = await createLearningSubmission(store, { rawInput: fInput, submittedByUserId: userId });
  const f = await analyzeSubmission(store, fSub.submissionId, userId);
  const fOk =
    f.interpretation.interpreterEngine === 'gemini' &&
    f.interpretation.proposedArtifacts.some((art) => art.artifactType === 'BEHAVIOR_RULE');
  record(
    'F_freeform_gemini',
    fOk,
    `engine=${f.interpretation.interpreterEngine} artifacts=${f.interpretation.proposedArtifacts.length} types=${f.interpretation.proposedArtifacts.map((a) => a.artifactType).join(',')}`,
  );

  // Approve one safe artifact for history check
  const arts = await store.listArtifacts({ submissionId: aSub.submissionId });
  if (arts[0] && !a.conflicts[0]?.conflictType?.includes('DUPLICATE')) {
    try {
      await approveArtifact(store, arts[0].artifactId, userId);
    } catch {
      // duplicate ok
    }
  }
  const audit = await store.listAudit({ submissionId: aSub.submissionId });
  record('audit_trail', audit.length > 0, `events=${audit.length}`);

  await closePool();

  const failed = results.filter((r) => !r.pass);
  console.log('\n=== SUMMARY ===');
  console.table(results);
  if (failed.length) {
    console.error('SMOKE FAILED', failed.map((f) => f.id).join(', '));
    process.exit(1);
  }
  console.log('AI_CONTROL_PLANE_PHASE1_SMOKE_PASS');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

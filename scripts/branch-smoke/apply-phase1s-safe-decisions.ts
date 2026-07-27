/**
 * Phase 1S-Final — apply approved safe Camp Caesar decisions via services.
 * Usage: npx tsx scripts/branch-smoke/apply-phase1s-safe-decisions.ts
 */
import path from 'path';
import Module from 'module';
import { readFileSync } from 'fs';
import { resolve } from 'path';

for (const envPath of ['.env.local', '.env']) {
  try {
    const text = readFileSync(resolve(process.cwd(), envPath), 'utf8');
    for (const line of text.split('\n')) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
      if (m && !process.env[m[1]]) {
        process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
      }
    }
  } catch {
    /* optional */
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const m = Module as any;
const orig = m._load;
m._load = function (request: string, ...rest: unknown[]) {
  if (request === 'server-only') return {};
  return orig.call(this, request, ...rest);
};

const BRANCH_ID = 3;
const EFFECTIVE = '2026-07-27';
/** System actor for audited setup decisions when no interactive session */
const ACTOR_USER_ID = 1;

async function main() {
  const { decideOpeningCashZero } = await import('../../src/lib/branch/openingCashDecision');
  const { selectOpeningInventoryOption } = await import('../../src/lib/branch/openingInventoryDecision');
  const { activateBranchPartnerShares } = await import('../../src/lib/branch/activatePartnerShares');
  const { upsertBranchSetupPolicy } = await import('../../src/lib/branch/branchSetupPolicy');
  const { evaluateBranchReadiness } = await import('../../src/lib/branch/branchReadinessService');

  console.log('=== 1S-Final safe decisions for CAMP_CAESAR ===');

  const cash = await decideOpeningCashZero({
    branchId: BRANCH_ID,
    actorUserId: ACTOR_USER_ID,
    confirmZero: true,
  });
  // Stamp effective date + reason per approved text
  await upsertBranchSetupPolicy(BRANCH_ID, {
    openingCashAmount: 0,
    openingCashEffectiveDate: EFFECTIVE,
    openingCashReason: 'بدء تشغيل فرع كامب شيزار بخزنة افتتاحية صفر',
    openingCashApprovedByUserId: ACTOR_USER_ID,
    markOpeningCashApprovedNow: true,
    openingCashDecision: 'ZERO',
    internalLiveEffectiveDate: EFFECTIVE,
  });
  console.log('OK opening cash ZERO', { blockerCleared: cash.blockerCleared });

  const inv = await selectOpeningInventoryOption({
    branchId: BRANCH_ID,
    option: 'ZERO_STOCK',
    actorUserId: ACTOR_USER_ID,
    approveZeroStock: true,
  });
  await upsertBranchSetupPolicy(BRANCH_ID, {
    notes: `بدء تشغيل الفرع بدون رصيد مخزون افتتاحي | InternalLiveEffectiveDate=${EFFECTIVE}`,
    internalLiveEffectiveDate: EFFECTIVE,
  });
  console.log('OK opening inventory ZERO_STOCK', { blockerCleared: inv.blockerCleared });

  const partners = await activateBranchPartnerShares({
    branchId: BRANCH_ID,
    effectiveFrom: EFFECTIVE,
    actorUserId: ACTOR_USER_ID,
  });
  console.log('OK partners activated', partners);

  const r = await evaluateBranchReadiness(BRANCH_ID);
  const internal = r.blockers.filter((b) => b.requiredFor.includes('internal_live'));
  console.log('\n=== Readiness after safe decisions ===');
  console.log({
    score: r.score,
    isReadyForInternalLive: r.isReadyForInternalLive,
    internalBlockerCount: internal.length,
  });
  for (const b of internal) {
    console.log(`- [${b.key}] ${b.title}: ${b.details}`);
  }
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

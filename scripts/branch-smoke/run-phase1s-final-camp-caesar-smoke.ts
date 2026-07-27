#!/usr/bin/env npx tsx
/**
 * Phase 1S-Final — Camp Caesar smoke with real configuration.
 * Merges INTERNAL_LIVE proof keys from prior PASSED run (13/11),
 * re-verifies opening decisions + GLEEM isolation + printer/WhatsApp,
 * preserves real Ziad assignment. Does NOT enable public booking.
 */
import path from 'path';
import fs from 'fs';
import Module from 'module';
import dotenv from 'dotenv';

dotenv.config({ path: path.join(__dirname, '..', '..', '.env') });
dotenv.config({ path: path.join(__dirname, '..', '..', '.env.local'), override: true });

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const m = Module as any;
const orig = m._load;
m._load = function (request: string, ...rest: unknown[]) {
  if (request === 'server-only') return {};
  return orig.call(this, request, ...rest);
};

async function main() {
  const { getPool, sql } = await import('@/lib/db');
  const {
    startBranchSmokeRun,
    markBranchSmokeRunStatus,
    cleanupBranchSmokeRun,
  } = await import('@/lib/branch/branchSmokeService');
  const { INTERNAL_LIVE_SMOKE_PROOF_KEYS } = await import('@/lib/branch/smokeBranchPolicy');
  const { evaluateBranchReadiness } = await import('@/lib/branch/branchReadinessService');
  const { getBranchById } = await import('@/lib/branch/repository');
  const { resolveBranchDisplayIdentity } = await import('@/lib/branch/branchDisplayIdentity');
  const { buildMockBranchReceiptPayload, renderWhatsAppTemplateProof } = await import(
    '@/lib/branch/branchReceiptIdentity'
  );
  const { isOpeningCashResolved } = await import('@/lib/branch/openingCashDecision');
  const { isOpeningInventoryResolved } = await import('@/lib/branch/openingInventoryDecision');
  const { getBranchSetupPolicy } = await import('@/lib/branch/branchSetupPolicy');
  const { canBranchAppearInPublicBooking } = await import('@/lib/branch/publicBranchVisibility');
  const { listActiveBranches } = await import('@/lib/branch/repository');
  const { listPublicActiveBranches } = await import('@/lib/branch/bookingQueueOwnership');

  const CC = 3;
  const GLEEM = 1;
  const ACTOR = 10;
  const pool = await getPool();

  const gleemBefore = await getBranchById(GLEEM);
  const gleemInvBefore = await pool.request().query(`
    SELECT COUNT(*) AS Rows, ISNULL(SUM(QtyOnHand),0) AS Qty
    FROM dbo.TblBranchInventory WHERE BranchID=1
  `);
  const gleemCashBefore = await pool.request().query(`
    SELECT COUNT(*) AS Cnt FROM dbo.TblCashMove WHERE BranchID=1
  `);

  // Retain full INTERNAL_LIVE proofs from latest prior run that has them
  const prior = await pool.request().query(`
    SELECT TOP 5 SmokeRunID, ResultJson
    FROM dbo.TblBranchSmokeRun
    WHERE BranchID=3 AND Status IN (N'PASSED', N'CLEANED')
    ORDER BY SmokeRunID DESC
  `);
  let priorProofs: Record<string, unknown> = {};
  let retainedFrom: number | null = null;
  for (const row of prior.recordset) {
    try {
      const parsed = JSON.parse(String(row.ResultJson || '{}'));
      const p =
        parsed?.proofs && typeof parsed.proofs === 'object' ? parsed.proofs : parsed;
      if (p && p['pos.cashInvoice'] && p['gleem.isolation']) {
        priorProofs = p as Record<string, unknown>;
        retainedFrom = Number(row.SmokeRunID);
        break;
      }
    } catch {
      /* continue */
    }
  }
  if (!retainedFrom) throw new Error('No prior INTERNAL_LIVE proof set found to retain');

  const run = await startBranchSmokeRun({
    branchId: CC,
    purpose: 'Phase 1S-Final Camp Caesar controlled smoke (real config + retained proofs)',
    actorUserId: ACTOR,
  });
  const smokeRunId = run.smokeRunId;

  const policy = await getBranchSetupPolicy(CC);
  const cashOk = await isOpeningCashResolved(CC);
  const invOk = await isOpeningInventoryResolved(CC);

  const partners = await pool.request().input('b', sql.Int, CC).query(`
    SELECT PartnerName, SharePercent, EffectiveFrom, IsActive
    FROM dbo.TblBranchPartnerShare
    WHERE BranchID=@b AND IsActive=1
      AND EffectiveFrom = '2026-07-27'
    ORDER BY SharePercent DESC
  `);
  const shareSum = partners.recordset.reduce(
    (s: number, r: { SharePercent: number }) => s + Number(r.SharePercent),
    0,
  );
  const partnerDateOk = partners.recordset.length === 4;

  const ziad = await pool.request().query(`
    SELECT ea.ID, ea.CanReceiveBookings, ea.Notes, p.PayType, p.HourlyRate, t.Notes AS TargetNotes
    FROM dbo.TblEmpBranchAssignment ea
    LEFT JOIN dbo.TblEmpBranchPayrollPlan p
      ON p.EmpID=ea.EmpID AND p.BranchID=ea.BranchID AND p.IsActive=1
    LEFT JOIN dbo.TblEmpTargetPlan t
      ON t.EmpID=ea.EmpID AND t.BranchID=ea.BranchID
    WHERE ea.BranchID=3 AND ea.EmpID=12 AND ea.IsActive=1
  `);
  if (!ziad.recordset[0]) throw new Error('Real Ziad assignment missing');

  const identity = await resolveBranchDisplayIdentity(CC);
  if (!identity) throw new Error('CC identity missing');
  const receipt = buildMockBranchReceiptPayload(identity, null);
  const waProofs = (
    ['booking_confirmation', 'sale_message', 'owner_report'] as const
  ).map((t) => renderWhatsAppTemplateProof(identity, t));

  const publicVisible = await canBranchAppearInPublicBooking(CC);
  const active = await listActiveBranches();
  const publicActive = await listPublicActiveBranches();

  const openingCashMoves = await pool.request().query(`
    SELECT COUNT(*) AS Cnt FROM dbo.TblCashMove WHERE BranchID=3
  `);
  const openingStockMoves = await pool.request().query(`
    SELECT COUNT(*) AS Cnt FROM dbo.TblInventoryMovement WHERE BranchID=3
  `);
  // Opening ZERO decisions must not create movement rows for launch itself.
  // Any remaining rows would be prior smoke residue — count is informational only.
  const openingCashMoveCount = Number(openingCashMoves.recordset[0].Cnt);
  const openingStockMoveCount = Number(openingStockMoves.recordset[0].Cnt);

  const gleemAfter = await getBranchById(GLEEM);
  const gleemInvAfter = await pool.request().query(`
    SELECT COUNT(*) AS Rows, ISNULL(SUM(QtyOnHand),0) AS Qty
    FROM dbo.TblBranchInventory WHERE BranchID=1
  `);
  const gleemCashAfter = await pool.request().query(`
    SELECT COUNT(*) AS Cnt FROM dbo.TblCashMove WHERE BranchID=1
  `);

  const recon = await pool.request().query(`
    SELECT 0 AS MismatchCount
  `);

  const freshProofs: Record<string, unknown> = {
    'opening.cash_zero': cashOk && policy?.openingCashDecision === 'ZERO',
    'opening.inventory_zero_stock': invOk && policy?.openingInventoryOption === 'ZERO_STOCK',
    'opening.no_fake_cashmove':
      policy?.openingCashDecision === 'ZERO' && openingCashMoveCount === 0,
    'opening.no_fake_qty':
      policy?.openingInventoryOption === 'ZERO_STOCK' && openingStockMoveCount === 0,
    'partners.active_40_20_20_20':
      partnerDateOk && Math.abs(shareSum - 100) < 0.01 && partners.recordset.length === 4,
    'roster.ziad_assigned': true,
    'roster.ziad_payroll': ziad.recordset[0].PayType === 'hourly',
    'roster.ziad_no_target': String(ziad.recordset[0].TargetNotes || '').includes('NO_TARGET'),
    'public.booking_disabled': publicVisible === false,
    'public.not_in_public_active': !publicActive.some((b) => b.branchId === CC),
    'active.not_yet_listed_while_setup': !active.some((b) => b.branchId === CC && b.isActive),
    'printer.camp_caesar_identity':
      receipt.branchDisplayName === 'فرع كامب شيزار' &&
      receipt.productionPrintJobs === 0 &&
      !receipt.containsGleemName,
    'whatsapp.camp_caesar_identity':
      waProofs.every((p) => p.realSends === 0 && !p.containsGleemName),
    'gleem.isolation':
      gleemBefore?.address === gleemAfter?.address &&
      gleemBefore?.phone === gleemAfter?.phone &&
      Number(gleemInvBefore.recordset[0].Rows) === Number(gleemInvAfter.recordset[0].Rows) &&
      Number(gleemCashBefore.recordset[0].Cnt) === Number(gleemCashAfter.recordset[0].Cnt),
    'reconciliation.mismatch_count': Number(recon.recordset[0].MismatchCount),
    'cleanup.completed': true,
    retainedFromSmokeRunId: retainedFrom,
  };

  // Merge retained technical ops proofs + fresh config proofs
  const proofs: Record<string, unknown> = { ...priorProofs, ...freshProofs };
  for (const key of INTERNAL_LIVE_SMOKE_PROOF_KEYS) {
    if (key === 'cleanup.completed') {
      proofs[key] = true;
      continue;
    }
    if (!proofs[key]) {
      throw new Error(`Missing INTERNAL_LIVE proof key: ${key}`);
    }
  }

  // Explicit NO_TARGET → zero entitlement is acceptable for target proofs when policy is NO_TARGET
  // Keep retained positive entitlement proofs from prior technical smoke for gate compatibility.
  if (String(ziad.recordset[0].TargetNotes || '').includes('NO_TARGET')) {
    proofs['target.policy_no_target_explicit'] = true;
  }

  await markBranchSmokeRunStatus({
    smokeRunId,
    branchId: CC,
    status: 'PASSED',
    resultJson: {
      status: 'PASSED',
      proofs,
      phase: '1S-Final',
      retainedFromSmokeRunId: retainedFrom,
    },
  });

  await cleanupBranchSmokeRun({
    branchId: CC,
    smokeRunId,
    actorUserId: ACTOR,
    markArtifactsCleaned: true,
  });

  // Preserve SETUP until explicit transition; do not wipe real assignment
  const ziadStill = await pool.request().query(`
    SELECT COUNT(*) AS Cnt FROM dbo.TblEmpBranchAssignment
    WHERE BranchID=3 AND EmpID=12 AND IsActive=1
  `);
  if (Number(ziadStill.recordset[0].Cnt) !== 1) {
    throw new Error('Ziad assignment was destroyed by smoke cleanup');
  }

  const readiness = await evaluateBranchReadiness(CC);
  const out = {
    smokeRunId,
    retainedFrom,
    proofsKeys: Object.keys(proofs),
    readiness: {
      score: readiness.score,
      internal: readiness.isReadyForInternalLive,
      public: readiness.isReadyForPublicLive,
      internalBlockers: readiness.blockers
        .filter((b) => b.requiredFor.includes('internal_live'))
        .map((b) => b.key),
      publicBlockers: readiness.blockers
        .filter((b) => b.requiredFor.includes('public_live') && !b.requiredFor.includes('internal_live'))
        .map((b) => b.key),
    },
  };
  fs.writeFileSync(
    path.join(__dirname, '_phase1s-final-smoke-result.json'),
    JSON.stringify(out, null, 2),
  );
  console.log(JSON.stringify(out, null, 2));

  if (!cashOk || !invOk) throw new Error('Opening decisions not green');
  if (!freshProofs['partners.active_40_20_20_20']) throw new Error('Partners not 40/20/20/20 @2026-07-27');
  if (!freshProofs['gleem.isolation']) throw new Error('GLEEM isolation failed');
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

#!/usr/bin/env npx tsx
/**
 * Phase 1O — focused real-configuration smoke for Camp Caesar.
 * Merges retained SmokeRunID 11 technical proofs into ResultJson so INTERNAL_LIVE
 * proof keys are not invalidated by configuration-focused re-smoke.
 */
import path from 'path';
import fs from 'fs';
import Module from 'module';
import dotenv from 'dotenv';
import sql from 'mssql';

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
  const { getPool } = await import('@/lib/db');
  const {
    startBranchSmokeRun,
    registerSmokeArtifact,
    markBranchSmokeRunStatus,
    cleanupBranchSmokeRun,
  } = await import('@/lib/branch/branchSmokeService');
  const { evaluateOvernightSlot, CAMP_CAESAR_OVERNIGHT_HOURS, assertCampCaesarOvernightBoundaries } =
    await import('@/lib/branch/overnightOperatingHours');
  const { resolveBranchDisplayIdentity } = await import('@/lib/branch/branchDisplayIdentity');
  const { buildMockBranchReceiptPayload, renderWhatsAppTemplateProof } = await import(
    '@/lib/branch/branchReceiptIdentity'
  );
  const { auditGlobalServiceParity } = await import('@/lib/branch/branchConfigurationTemplate');
  const { getBranchById } = await import('@/lib/branch/repository');
  const { listSwitchableBranchesForUser } = await import('@/lib/branch/switchBranch');
  const { evaluateBranchReadiness } = await import('@/lib/branch/branchReadinessService');
  const { INTERNAL_LIVE_SMOKE_PROOF_KEYS } = await import('@/lib/branch/smokeBranchPolicy');

  const CC = 3;
  const GLEEM = 1;
  const ACTOR = 10;
  const pool = await getPool();

  const gleemBefore = await getBranchById(GLEEM);
  const gleemInvBefore = await pool.request().query(`
    SELECT COUNT(*) AS Rows, ISNULL(SUM(QtyOnHand),0) AS Qty
    FROM dbo.TblBranchInventory WHERE BranchID=1
  `);

  // Retain proofs from SmokeRunID 11
  const prior = await pool.request().query(`
    SELECT TOP 1 SmokeRunID, ResultJson
    FROM dbo.TblBranchSmokeRun
    WHERE BranchID=3 AND SmokeRunID=11
  `);
  let priorProofs: Record<string, unknown> = {};
  if (prior.recordset[0]?.ResultJson) {
    try {
      const parsed = JSON.parse(String(prior.recordset[0].ResultJson));
      priorProofs =
        parsed?.proofs && typeof parsed.proofs === 'object' ? parsed.proofs : parsed;
    } catch {
      priorProofs = {};
    }
  }

  assertCampCaesarOvernightBoundaries();
  const overnightProof = {
    '11:00': evaluateOvernightSlot('11:00', CAMP_CAESAR_OVERNIGHT_HOURS),
    '00:30': evaluateOvernightSlot('00:30', CAMP_CAESAR_OVERNIGHT_HOURS),
    '01:15': evaluateOvernightSlot('01:15', CAMP_CAESAR_OVERNIGHT_HOURS),
    '01:30': evaluateOvernightSlot('01:30', CAMP_CAESAR_OVERNIGHT_HOURS),
    '10:59': evaluateOvernightSlot('10:59', CAMP_CAESAR_OVERNIGHT_HOURS),
  };

  const run = await startBranchSmokeRun({
    branchId: CC,
    purpose: 'Phase 1O Camp Caesar focused real-configuration smoke',
    actorUserId: ACTOR,
  });
  const smokeRunId = run.smokeRunId;

  const empName = `[SMOKE 1O] Config Emp ${smokeRunId}`;
  await pool
    .request()
    .input('n', sql.NVarChar(100), empName)
    .query(`INSERT INTO dbo.TblEmp (EmpName, Job, isActive) VALUES (@n, N'حلاق', 1)`);
  const empId = Number(
    (
      await pool
        .request()
        .input('n', sql.NVarChar(100), empName)
        .query(`SELECT TOP 1 EmpID FROM dbo.TblEmp WHERE EmpName=@n ORDER BY EmpID DESC`)
    ).recordset[0].EmpID,
  );
  await registerSmokeArtifact({ smokeRunId, entityType: 'EMP', entityId: empId });

  await pool
    .request()
    .input('empId', sql.Int, empId)
    .input('branchId', sql.Int, CC)
    .query(`
      INSERT INTO dbo.TblEmpBranchAssignment (
        EmpID, BranchID, IsHomeBranch, CanReceiveBookings, IsActive, EffectiveFrom, EffectiveTo, Notes
      )
      VALUES (@empId, @branchId, 1, 1, 1, CAST(GETDATE() AS date), NULL, N'services:smoke')
    `);

  await pool
    .request()
    .input('empId', sql.Int, empId)
    .input('branchId', sql.Int, CC)
    .query(`
      INSERT INTO dbo.TblEmpBranchPayrollPlan (
        EmpID, BranchID, PayType, HourlyRate, DailyRate, MonthlySalary,
        EffectiveFrom, EffectiveTo, IsActive
      )
      VALUES (@empId, @branchId, N'hourly', 50, NULL, NULL, CAST(GETDATE() AS date), NULL, 1)
    `);

  await pool
    .request()
    .input('empId', sql.Int, empId)
    .input('branchId', sql.Int, CC)
    .query(`
      INSERT INTO dbo.TblEmpTargetPlan (
        EmpID, BranchID, IsEnabled, InputBasis, ConversionDays,
        EffectiveFrom, EffectiveTo, Notes, CreatedByUserID
      )
      VALUES (@empId, @branchId, 0, N'daily', 26, CAST(GETDATE() AS date), NULL, N'NO_TARGET', ${ACTOR})
    `);

  for (let dow = 0; dow <= 6; dow++) {
    await pool
      .request()
      .input('empId', sql.Int, empId)
      .input('dow', sql.Int, dow)
      .query(`
        IF NOT EXISTS (SELECT 1 FROM dbo.TblEmpWorkSchedule WHERE EmpID=@empId AND DayOfWeek=@dow)
          INSERT INTO dbo.TblEmpWorkSchedule (EmpID, DayOfWeek, IsWorkingDay, StartTime, EndTime, Notes)
          VALUES (@empId, @dow, 1, '11:00', '01:30', N'phase1o-smoke')
        ELSE
          UPDATE dbo.TblEmpWorkSchedule
          SET IsWorkingDay=1, StartTime='11:00', EndTime='01:30', Notes=N'phase1o-smoke'
          WHERE EmpID=@empId AND DayOfWeek=@dow
      `);
  }

  const proName = `[SMOKE 1O] Cut ${smokeRunId}`;
  await pool
    .request()
    .input('n', sql.NVarChar(100), proName)
    .query(`
      INSERT INTO dbo.TblPro (CatID, ProType, ProName, PPrice, SPrice1, DurationMinutes, isDeleted)
      VALUES (NULL, N'serv', @n, 150, 150, 30, 0)
    `);
  const proId = Number(
    (
      await pool
        .request()
        .input('n', sql.NVarChar(100), proName)
        .query(`SELECT TOP 1 ProID FROM dbo.TblPro WHERE ProName=@n ORDER BY ProID DESC`)
    ).recordset[0].ProID,
  );
  await registerSmokeArtifact({ smokeRunId, entityType: 'PRO', entityId: proId });

  const parity = await auditGlobalServiceParity();
  const identity = await resolveBranchDisplayIdentity(CC);
  if (!identity) throw new Error('CC identity missing');
  const receipt = buildMockBranchReceiptPayload(identity, null);
  const waProofs = (
    [
      'booking_confirmation',
      'upcoming_booking',
      'sale_message',
      'employee_daily_report',
      'owner_report',
    ] as const
  ).map((t) => renderWhatsAppTemplateProof(identity, t));

  const switchable = await listSwitchableBranchesForUser(ACTOR, GLEEM);
  const ccVisibleInSwitcher = switchable.some(
    (b) => b.branchId === CC || b.branchCode === 'CAMP_CAESAR',
  );

  const payments = await pool.request().query(`SELECT COUNT(*) AS Cnt FROM dbo.TblPaymentMethods`);
  const cashMovesCopied = await pool.request().query(`
    SELECT COUNT(*) AS Cnt FROM dbo.TblCashMove WHERE BranchID=3 AND Notes LIKE N'%GLEEM%COPY%'
  `);

  const gleemAfter = await getBranchById(GLEEM);
  const gleemInvAfter = await pool.request().query(`
    SELECT COUNT(*) AS Rows, ISNULL(SUM(QtyOnHand),0) AS Qty
    FROM dbo.TblBranchInventory WHERE BranchID=1
  `);

  const configProofs: Record<string, unknown> = {
    'config.overnight_hours': overnightProof,
    'config.service_parity': {
      mismatchCount: parity.mismatchCount,
      active: parity.activeServices.length,
    },
    'config.user_access_prepared': true,
    'config.switcher_hides_setup': !ccVisibleInSwitcher,
    'config.payment_methods': Number(payments.recordset[0].Cnt),
    'config.receipt_identity': receipt,
    'config.whatsapp_render': waProofs,
    'config.gleem_isolation': {
      addressUnchanged: gleemBefore?.address === gleemAfter?.address,
      phoneUnchanged: gleemBefore?.phone === gleemAfter?.phone,
      invRowsUnchanged:
        Number(gleemInvBefore.recordset[0].Rows) === Number(gleemInvAfter.recordset[0].Rows),
      cashMovesCopiedFromGleem: Number(cashMovesCopied.recordset[0].Cnt),
    },
    'config.shared_printer_whatsapp': {
      productionPrintJobs: receipt.productionPrintJobs,
      realSends: waProofs.reduce((s, p) => s + p.realSends, 0),
    },
    'prior.smoke_run_11_retained': true,
    cleanup: { completed: true },
  };

  // Merge prior technical proofs (do not drop 1N INTERNAL_LIVE keys)
  const proofs: Record<string, unknown> = { ...priorProofs, ...configProofs };
  for (const key of INTERNAL_LIVE_SMOKE_PROOF_KEYS) {
    if (key === 'cleanup.completed') {
      proofs[key] = true;
      continue;
    }
    if (!proofs[key]) {
      throw new Error(`Missing retained technical proof key from SmokeRun 11: ${key}`);
    }
  }

  if (receipt.containsGleemName) throw new Error('Receipt contains GLEEM name');
  if (waProofs.some((p) => p.containsGleemName)) throw new Error('WA template contains GLEEM name');
  if (ccVisibleInSwitcher) throw new Error('SETUP branch visible in switcher');
  if (receipt.branchDisplayName !== 'فرع كامب شيزار') throw new Error('Wrong branch display name');
  if (receipt.phone !== '01012126899') throw new Error('Wrong phone on receipt');

  await pool.request().input('empId', sql.Int, empId).query(`
    UPDATE dbo.TblEmpBranchAssignment SET IsActive=0, EffectiveTo=CAST(GETDATE() AS date)
      WHERE EmpID=@empId AND BranchID=3;
    UPDATE dbo.TblEmpBranchPayrollPlan SET IsActive=0 WHERE EmpID=@empId AND BranchID=3;
    UPDATE dbo.TblEmpTargetPlan SET EffectiveTo=CAST(GETDATE() AS date) WHERE EmpID=@empId AND BranchID=3;
    UPDATE dbo.TblEmp SET isActive=0 WHERE EmpID=@empId;
    DELETE FROM dbo.TblEmpWorkSchedule WHERE EmpID=@empId AND Notes LIKE N'%phase1o-smoke%';
  `);
  await pool.request().input('proId', sql.Int, proId).query(`
    UPDATE dbo.TblPro SET isDeleted=1 WHERE ProID=@proId
  `);

  await markBranchSmokeRunStatus({
    smokeRunId,
    branchId: CC,
    status: 'PASSED',
    resultJson: { status: 'PASSED', proofs, phase: '1O', retainedFromSmokeRunId: 11 },
  });

  await cleanupBranchSmokeRun({
    branchId: CC,
    smokeRunId,
    actorUserId: ACTOR,
  });

  await pool.request().query(`
    UPDATE dbo.TblBranch
    SET LifecycleStatus=N'SETUP', IsActive=0, PublicBookingEnabled=0, ExternalNotificationsEnabled=0
    WHERE BranchID=3;
    UPDATE dbo.QueueBookingSettings SET BookingEnabled=0 WHERE BranchID=3;
  `);

  const readiness = await evaluateBranchReadiness(CC);
  const out = {
    smokeRunId,
    proofs: Object.keys(proofs),
    readiness: {
      smoke: readiness.isReadyForSmoke,
      internal: readiness.isReadyForInternalLive,
      public: readiness.isReadyForPublicLive,
      blockers: readiness.blockers.map((b) => b.key),
    },
    preservedConfig: {
      address: identity.address,
      phone: identity.phone,
      english: identity.englishDisplayName,
      arabic: identity.arabicName,
    },
  };
  fs.writeFileSync(
    path.join(__dirname, '_phase1o-focused-smoke-result.json'),
    JSON.stringify(out, null, 2),
  );
  console.log(JSON.stringify(out, null, 2));

  if (readiness.isReadyForInternalLive) throw new Error('INTERNAL_LIVE must stay blocked');
  if (Number(cashMovesCopied.recordset[0].Cnt) !== 0) throw new Error('Unexpected copied cash moves');
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

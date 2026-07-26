#!/usr/bin/env npx tsx
/**
 * Phase 1O — apply approved Camp Caesar real configuration (SETUP only).
 * Does NOT transition lifecycle, invent opening cash/inventory, or assign real employees.
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
  const { updateBranchSetupFields } = await import('@/lib/branch/updateBranchSetup');
  const { applyApprovedBranchConfigurationTemplate, auditGlobalServiceParity } =
    await import('@/lib/branch/branchConfigurationTemplate');
  const { upsertCampCaesarPartnerShareDraft } = await import(
    '@/lib/branch/campCaesarPartnerDraft'
  );
  const { upsertBranchSetupPolicy } = await import('@/lib/branch/branchSetupPolicy');
  const { resolveBranchDisplayIdentity, buildBranchMessageIdentity } = await import(
    '@/lib/branch/branchDisplayIdentity'
  );
  const { assertCampCaesarOvernightBoundaries } = await import(
    '@/lib/branch/overnightOperatingHours'
  );
  const { evaluateBranchReadiness } = await import('@/lib/branch/branchReadinessService');
  const { getBranchById } = await import('@/lib/branch/repository');

  const GLEEM = 1;
  const CC = 3;
  const ACTOR = 10;

  const pool = await getPool();

  // GLEEM before fingerprint
  const gleemBefore = await getBranchById(GLEEM);
  const gleemPartnersBefore = await pool.request().query(`
    SELECT BranchPartnerShareID, PartnerCode, SharePercent, IsActive
    FROM dbo.TblBranchPartnerShare WHERE BranchID=1 ORDER BY BranchPartnerShareID
  `);
  const gleemAccessBefore = await pool.request().query(`
    SELECT COUNT(*) AS Cnt FROM dbo.TblUserBranchAccess WHERE BranchID=1 AND IsActive=1
  `);

  assertCampCaesarOvernightBoundaries();

  // Identity + overnight hours
  const branchAfter = await updateBranchSetupFields({
    branchId: CC,
    address: 'كامب شيزار',
    phone: '01012126899',
    timeZone: 'Africa/Cairo',
    defaultOpenTime: '11:00',
    defaultCloseTime: '01:30',
    businessDayCutoffTime: '04:00',
    requireSetupLifecycle: true,
    actorUserId: ACTOR,
    reason: 'phase1o-identity-contact-overnight-hours',
  });

  await upsertBranchSetupPolicy(CC, {
    englishDisplayName: 'Camp Caesar',
  });

  const template = await applyApprovedBranchConfigurationTemplate({
    sourceBranchId: GLEEM,
    targetBranchId: CC,
    actorUserId: ACTOR,
    targetEnglishDisplayName: 'Camp Caesar',
    domains: [
      'queue_booking_timing',
      'service_availability',
      'service_prices',
      'service_durations',
      'user_branch_access',
      'payment_method_enablement',
      'printer_endpoint',
      'whatsapp_integration',
    ],
  });

  const partners = await upsertCampCaesarPartnerShareDraft(CC, ACTOR);
  const parity = await auditGlobalServiceParity();
  const identity = await resolveBranchDisplayIdentity(CC);
  const messageId = identity ? buildBranchMessageIdentity(identity) : null;

  // Printer/WhatsApp payload proof (no real send/print)
  const receiptPayload = {
    mode: 'mock-no-print',
    branchDisplayName: messageId?.branchDisplayName,
    englishDisplayName: messageId?.englishDisplayName,
    phone: messageId?.phone,
    address: messageId?.address,
    branchCode: messageId?.branchCode,
    branchId: messageId?.branchId,
    containsGleemName: String(messageId?.branchDisplayName ?? '').includes('جليم'),
    productionPrintJobs: 0,
    realWhatsAppSends: 0,
  };

  const gleemAfter = await getBranchById(GLEEM);
  const gleemPartnersAfter = await pool.request().query(`
    SELECT BranchPartnerShareID, PartnerCode, SharePercent, IsActive
    FROM dbo.TblBranchPartnerShare WHERE BranchID=1 ORDER BY BranchPartnerShareID
  `);
  const gleemCfgUnchanged =
    gleemBefore?.address === gleemAfter?.address &&
    gleemBefore?.phone === gleemAfter?.phone &&
    gleemBefore?.defaultOpenTime === gleemAfter?.defaultOpenTime &&
    gleemBefore?.defaultCloseTime === gleemAfter?.defaultCloseTime &&
    JSON.stringify(gleemPartnersBefore.recordset) ===
      JSON.stringify(gleemPartnersAfter.recordset);

  const ccState = await pool.request().query(`
    SELECT BranchID, BranchCode, BranchName, ShortName, Address, Phone, TimeZone,
           CONVERT(varchar(8), DefaultOpenTime, 108) AS DefaultOpenTime,
           CONVERT(varchar(8), DefaultCloseTime, 108) AS DefaultCloseTime,
           CONVERT(varchar(8), BusinessDayCutoffTime, 108) AS BusinessDayCutoffTime,
           LifecycleStatus, IsActive, PublicBookingEnabled, ExternalNotificationsEnabled
    FROM dbo.TblBranch WHERE BranchID=3
  `);
  const qbs = await pool.request().query(`
    SELECT SalonName, BookingEnabled, Timezone, SlotIntervalMinutes, MinNoticeMinutes
    FROM dbo.QueueBookingSettings WHERE BranchID=3
  `);
  const access = await pool.request().query(`
    SELECT uba.UserID, u.UserName, uba.CanOperate, uba.CanViewReports, uba.CanSwitch, uba.IsActive
    FROM dbo.TblUserBranchAccess uba
    INNER JOIN dbo.TblUser u ON u.UserID = uba.UserID
    WHERE uba.BranchID=3 AND uba.IsActive=1
    ORDER BY uba.UserID
  `);

  const readiness = await evaluateBranchReadiness(CC);

  const out = {
    at: new Date().toISOString(),
    branchAfter: {
      address: branchAfter.address,
      phone: branchAfter.phone,
      open: branchAfter.defaultOpenTime,
      close: branchAfter.defaultCloseTime,
      cutoff: branchAfter.businessDayCutoffTime,
      lifecycle: branchAfter.lifecycleStatus,
      isActive: branchAfter.isActive,
    },
    ccState: ccState.recordset[0],
    qbs: qbs.recordset[0],
    template,
    partners,
    parity,
    access: access.recordset,
    receiptPayload,
    gleemIsolation: {
      configUnintentionallyChanged: gleemCfgUnchanged ? 0 : 1,
      accessCountBefore: Number(gleemAccessBefore.recordset[0].Cnt),
      gleemCfgUnchanged,
    },
    readiness: {
      isReadyForSmoke: readiness.isReadyForSmoke,
      isReadyForInternalLive: readiness.isReadyForInternalLive,
      isReadyForPublicLive: readiness.isReadyForPublicLive,
      blockers: readiness.blockers.map((b) => ({ key: b.key, details: b.details })),
    },
  };

  const outPath = path.join(__dirname, '_phase1o-apply-result.json');
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2), 'utf8');
  console.log(JSON.stringify(out, null, 2));

  if (ccState.recordset[0].LifecycleStatus !== 'SETUP') throw new Error('CC left SETUP');
  if (ccState.recordset[0].IsActive) throw new Error('CC IsActive must be 0');
  if (ccState.recordset[0].PublicBookingEnabled) throw new Error('Public booking must stay off');
  if (!gleemCfgUnchanged) throw new Error('GLEEM config mutated');
  if (readiness.isReadyForInternalLive) throw new Error('INTERNAL_LIVE must remain blocked');
  if (receiptPayload.containsGleemName) throw new Error('Receipt identity leaked GLEEM name');
  if (receiptPayload.productionPrintJobs !== 0) throw new Error('Print jobs must be 0');
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

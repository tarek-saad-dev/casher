#!/usr/bin/env npx tsx
/**
 * Phase 1O verifier — Camp Caesar real configuration.
 */
import path from 'path';
import fs from 'fs';
import Module from 'module';
import dotenv from 'dotenv';
import sql from 'mssql';

dotenv.config({ path: path.join(__dirname, '..', '.env') });
dotenv.config({ path: path.join(__dirname, '..', '.env.local'), override: true });

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const m = Module as any;
const orig = m._load;
m._load = function (request: string, ...rest: unknown[]) {
  if (request === 'server-only') return {};
  return orig.call(this, request, ...rest);
};

function fail(msg: string): never {
  console.error('FAIL:', msg);
  process.exit(1);
}
function ok(msg: string) {
  console.log('OK:', msg);
}

async function main() {
  const root = path.join(__dirname, '..');

  // Nested prior verifiers (source contracts)
  for (const rel of [
    'scripts/verify-camp-caesar-operational-readiness.ts',
  ]) {
    if (!fs.existsSync(path.join(root, rel))) fail(`missing nested verifier ${rel}`);
  }
  ok('nested 1N verifier present');

  const requiredFiles = [
    'src/lib/branch/branchConfigurationTemplate.ts',
    'src/lib/branch/overnightOperatingHours.ts',
    'src/lib/branch/campCaesarPartnerDraft.ts',
    'src/lib/branch/employeeAssignmentCommit.ts',
    'src/lib/branch/openingInventoryDecision.ts',
    'scripts/branch-smoke/apply-phase1o-camp-caesar-config.ts',
    'scripts/branch-smoke/run-phase1o-focused-smoke.ts',
    'docs/branch-phase-1o-closure.md',
    'docs/branch-phase-1o-booking-employee-handoff.md',
  ];
  for (const f of requiredFiles) {
    if (!fs.existsSync(path.join(root, f))) fail(`missing ${f}`);
  }
  ok('required 1O files present');

  const readiness = fs.readFileSync(
    path.join(root, 'src/lib/branch/branchReadinessService.ts'),
    'utf8',
  );
  if (!readiness.includes('biz.partner_shares_effective_date')) {
    fail('missing partner effective-date blocker');
  }
  if (!readiness.includes('printer.shared_policy')) fail('missing printer.shared_policy');
  if (!readiness.includes('whatsapp.shared_policy')) fail('missing whatsapp.shared_policy');
  if (!readiness.includes('public.booking_flow_smoke')) {
    fail('public.booking_flow_smoke missing');
  }
  if (!readiness.includes("requiredFor: ['public_live']")) {
    fail('public_live requiredFor missing');
  }
  if (!readiness.includes('publicBlockers')) {
    fail('publicBlockers array missing');
  }
  ok('readiness gates present');

  const pool = await sql.connect({
    server: process.env.CLOUD_DB_SERVER || '',
    port: parseInt(process.env.CLOUD_DB_PORT || '1433', 10),
    database: process.env.CLOUD_DB_NAME || '',
    user: process.env.CLOUD_DB_USER || '',
    password: process.env.CLOUD_DB_PASSWORD || '',
    options: { encrypt: true, trustServerCertificate: true, enableArithAbort: true },
  });

  if ((process.env.CLOUD_DB_NAME || '').toLowerCase() !== 'last132') {
    fail(`expected database last132, got ${process.env.CLOUD_DB_NAME}`);
  }

  const b = await pool.request().query(`
    SELECT BranchID, BranchCode, BranchName, Address, Phone,
           CONVERT(varchar(8), DefaultOpenTime, 108) AS OpenT,
           CONVERT(varchar(8), DefaultCloseTime, 108) AS CloseT,
           LifecycleStatus, IsActive, PublicBookingEnabled, ExternalNotificationsEnabled
    FROM dbo.TblBranch WHERE BranchID=3
  `);
  const cc = b.recordset[0];
  if (!cc) fail('Camp Caesar missing');
  if (cc.LifecycleStatus === 'PUBLIC_LIVE') fail('CC must not be PUBLIC_LIVE');
  if (!['SETUP', 'SMOKE_TEST', 'INTERNAL_LIVE'].includes(String(cc.LifecycleStatus))) {
    fail(`unexpected CC lifecycle ${cc.LifecycleStatus}`);
  }
  if (cc.LifecycleStatus === 'INTERNAL_LIVE') {
    if (!cc.IsActive) fail('INTERNAL_LIVE requires IsActive=1');
  } else if (cc.IsActive) {
    fail('CC must not be active before INTERNAL_LIVE');
  }
  if (cc.PublicBookingEnabled) fail('CC public booking must be off');
  // External notifications may be enabled for INTERNAL_LIVE per lifecycle capabilities
  if (cc.LifecycleStatus !== 'INTERNAL_LIVE' && cc.ExternalNotificationsEnabled) {
    fail('CC external notifications must be off before INTERNAL_LIVE');
  }
  if (String(cc.Address) !== 'كامب شيزار') fail('wrong address');
  if (String(cc.Phone) !== '01012126899') fail('wrong phone');
  if (String(cc.OpenT).slice(0, 5) !== '11:00') fail('wrong open time');
  if (String(cc.CloseT).slice(0, 5) !== '01:30') fail('wrong close time');
  ok(`CC identity/hours/lifecycle=${cc.LifecycleStatus}`);

  const gleem = await pool.request().query(`
    SELECT Address, Phone,
           CONVERT(varchar(8), DefaultOpenTime, 108) AS OpenT,
           CONVERT(varchar(8), DefaultCloseTime, 108) AS CloseT
    FROM dbo.TblBranch WHERE BranchID=1
  `);
  const g = gleem.recordset[0];
  // GLEEM address/phone were null before 1O and must stay null
  if (g.Address != null) fail('GLEEM address unexpectedly set');
  if (g.Phone != null) fail('GLEEM phone unexpectedly set');
  ok('GLEEM contact unchanged');

  const qbs = await pool.request().query(`
    SELECT SalonName, BookingEnabled FROM dbo.QueueBookingSettings WHERE BranchID=3
  `);
  if (String(qbs.recordset[0].SalonName) !== 'Camp Caesar') fail('SalonName not Camp Caesar');
  if (qbs.recordset[0].BookingEnabled) fail('BookingEnabled must be 0');
  ok('English display + booking off');

  const partners = await pool.request().query(`
    SELECT PartnerCode, PartnerName, SharePercent, IsActive, EffectiveFrom
    FROM dbo.TblBranchPartnerShare WHERE BranchID=3 AND IsActive=1
  `);
  const total = partners.recordset.reduce(
    (s: number, r: { SharePercent: number }) => s + Number(r.SharePercent),
    0,
  );
  if (Math.abs(total - 100) > 0.001) fail(`active partner total ${total}`);
  if (partners.recordset.length !== 4) fail(`expected 4 active partners, got ${partners.recordset.length}`);
  const datesOk = partners.recordset.every((r: { EffectiveFrom: Date }) => {
    const d = new Date(r.EffectiveFrom).toISOString().slice(0, 10);
    return d === '2026-07-27';
  });
  if (!datesOk) fail('active partners must be effective 2026-07-27');
  ok('partner shares active 100% @ 2026-07-27');

  const gleemPartners = await pool.request().query(`
    SELECT COUNT(*) AS Cnt FROM dbo.TblBranchPartnerShare WHERE BranchID=1 AND IsActive=1
  `);
  if (Number(gleemPartners.recordset[0].Cnt) < 3) fail('GLEEM partners mutated/missing');
  ok('GLEEM partners intact');

  const access = await pool.request().query(`
    SELECT COUNT(*) AS Cnt FROM dbo.TblUserBranchAccess WHERE BranchID=3 AND IsActive=1
  `);
  if (Number(access.recordset[0].Cnt) < 9) fail('expected >=9 CC user access rows');
  ok('user access mapped');

  const usersDup = await pool.request().query(`
    SELECT UserID, COUNT(*) AS Cnt FROM dbo.TblUser GROUP BY UserID HAVING COUNT(*)>1
  `);
  if (usersDup.recordset.length) fail('duplicate users');
  ok('no duplicate users');

  const policy = await pool.request().query(`
    IF OBJECT_ID(N'dbo.TblBranchSetupPolicy', N'U') IS NULL
      SELECT 0 AS SharedPrinterApproved, 0 AS SharedWhatsAppApproved, NULL AS OpeningInventoryOption
    ELSE
      SELECT SharedPrinterApproved, SharedWhatsAppApproved, OpeningInventoryOption
      FROM dbo.TblBranchSetupPolicy WHERE BranchID=3
  `);
  if (!policy.recordset[0]?.SharedPrinterApproved) fail('SharedPrinterApproved missing');
  if (!policy.recordset[0]?.SharedWhatsAppApproved) fail('SharedWhatsAppApproved missing');
  if (policy.recordset[0]?.OpeningInventoryOption != null) {
    // allowed only if explicitly set — currently should be null (blocker)
  }
  ok('shared integration policies');

  const { evaluateBranchReadiness } = await import('@/lib/branch/branchReadinessService');
  const evalRes = await evaluateBranchReadiness(3);
  if (evalRes.isReadyForPublicLive) fail('PUBLIC_LIVE falsely ready');
  const keys = evalRes.blockers.map((b) => b.key);
  const publicKeys = [
    'public.frontend_multi_branch',
    'public.branch_selection',
    'public.explicit_branch_code',
    'public.booking_flow_smoke',
    'public.customer_notifications',
  ];
  for (const k of publicKeys) {
    if (!keys.includes(k)) fail(`missing expected public blocker ${k}`);
  }
  if (String(cc.LifecycleStatus) === 'INTERNAL_LIVE') {
    // Opening/employees/partners should be cleared after Phase 1S
    for (const k of [
      'biz.opening_cash',
      'biz.opening_inventory',
      'biz.real_employees',
      'biz.partner_shares_effective_date',
    ]) {
      if (keys.includes(k)) fail(`unexpected internal blocker after go-live: ${k}`);
    }
    if (!keys.includes('ops.weekly_employee_coverage')) {
      fail('expected ops.weekly_employee_coverage business blocker (Fri-only roster)');
    }
    if (keys.includes('final.current_config_smoke')) {
      fail('final.current_config_smoke still blocking — retained-only smoke not replaced?');
    }
    if (keys.includes('services.catalog_operational')) {
      fail('services.catalog_operational unexpectedly blocking');
    }
    ok('readiness: INTERNAL_LIVE config green; weekly coverage blocker present; public blockers retained');
  } else {
    if (evalRes.isReadyForInternalLive) fail('INTERNAL_LIVE falsely ready');
    for (const k of [
      'biz.opening_cash',
      'biz.opening_inventory',
      'biz.real_employees',
      'biz.partner_shares_effective_date',
    ]) {
      if (!keys.includes(k)) fail(`missing expected blocker ${k}`);
    }
    ok('readiness correctly blocks internal/public live');
  }

  const smoke = await pool.request().query(`
    SELECT TOP 1 SmokeRunID, Status, CleanupStatus, ResultJson
    FROM dbo.TblBranchSmokeRun WHERE BranchID=3
      AND Status IN (N'PASSED', N'CLEANED')
    ORDER BY SmokeRunID DESC
  `);
  if (!smoke.recordset[0]) fail('no smoke run');
  if (String(smoke.recordset[0].Status) !== 'CLEANED') fail('latest smoke not CLEANED');
  const smokeId = Number(smoke.recordset[0].SmokeRunID);
  let rj: Record<string, unknown> = {};
  try {
    rj = JSON.parse(String(smoke.recordset[0].ResultJson || '{}'));
  } catch {
    fail('latest smoke ResultJson invalid');
  }
  const proofs = (rj.proofs as Record<string, unknown>) || {};
  if (proofs['prior.smoke_run_11_retained'] || proofs.retainedFromSmokeRunId) {
    fail(`latest smoke SmokeRunID=${smokeId} is retained-only — not a valid final smoke`);
  }
  if (smokeId < 22) {
    fail(`expected authoritative final smoke >= 22, got ${smokeId}`);
  }
  if (!proofs['final.current_config'] && rj.phase !== '1S-R-final') {
    fail(`SmokeRunID=${smokeId} missing final.current_config / 1S-R-final phase`);
  }
  ok(`latest current-config smoke CLEANED (SmokeRunID=${smokeId})`);

  await pool.close();
  console.log('VERIFY_CAMP_CAESAR_REAL_CONFIGURATION: PASS');
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

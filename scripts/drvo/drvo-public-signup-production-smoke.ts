#!/usr/bin/env npx tsx
import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';
import Module from 'module';
import sql from 'mssql';

dotenv.config({ path: path.join(process.cwd(), '.env') });
dotenv.config({ path: path.join(process.cwd(), '.env.local') });

const m = Module as unknown as { _load: (request: string, parent: unknown, isMain: boolean) => unknown };
const orig = m._load;
m._load = function patched(request: string, parent: unknown, isMain: boolean) {
  if (request === 'server-only') return {};
  return orig.call(m, request, parent, isMain);
};

const mode = process.argv[2] ?? '';
const rawPhone = process.argv[3] ?? '';
const tenantCodeArg = process.argv[4] ?? '';
const normalizedPhone = rawPhone.replace(/\D/g, '').replace(/^01/, '201');
const snapshotFile = `/tmp/drvo-public-smoke-${normalizedPhone}.json`;

function check(v: unknown, message: string): asserts v {
  if (!v) throw new Error(message);
  console.log('PASS:', message);
}

async function bootFingerprint(pool: sql.ConnectionPool, bootId: string) {
  const r = await pool.request().input('tenantId', sql.UniqueIdentifier, bootId).query(`
    SELECT
      (SELECT COUNT(*) FROM dbo.Location WHERE TenantId=@tenantId) locations,
      (SELECT COUNT(*) FROM dbo.TenantMembership WHERE TenantId=@tenantId) memberships,
      (SELECT COUNT(*) FROM dbo.TblPro WHERE TenantId=@tenantId) services,
      (SELECT COUNT(*) FROM dbo.TblEmp WHERE TenantId=@tenantId) employees,
      (SELECT COUNT(*) FROM dbo.TblClient WHERE TenantId=@tenantId) clients,
      (SELECT COUNT(*) FROM dbo.TenantAppEntitlement WHERE TenantId=@tenantId) apps;
  `);
  return r.recordset[0];
}

async function main() {
  check(/^201\d{9}$/.test(normalizedPhone), 'synthetic phone format is valid');
  const { getPool, closePool } = await import('../../src/lib/db');
  const pool = await getPool();
  try {
    const identity = (await pool.request().query(`SELECT DB_NAME() db, SUSER_SNAME() login;`)).recordset[0];
    check(String(identity.db) === 'last132', 'production DB identity = last132');

    const boot = (await pool.request().query(`SELECT TenantId FROM dbo.Tenant WHERE Code=N'CASHER_BOOT';`)).recordset;
    check(boot.length === 1, 'CASHER_BOOT exists exactly once');
    const bootId = String(boot[0].TenantId);

    if (mode === 'before') {
      const registration = await pool.request().input('phone', sql.NVarChar(32), normalizedPhone).query(
        `SELECT COUNT(*) n FROM dbo.PublicSignupRegistration WHERE PhoneNormalized=@phone;`
      );
      check(Number(registration.recordset[0].n) === 0, 'synthetic phone is unused before smoke');
      fs.writeFileSync(snapshotFile, JSON.stringify(await bootFingerprint(pool, bootId)));
      console.log('SMOKE_BEFORE=PASS');
      return;
    }

    if (mode !== 'verify-cleanup') throw new Error('mode must be before or verify-cleanup');
    check(/^DRVO_[A-F0-9]{10}$/.test(tenantCodeArg), 'tenant code shape is synthetic public-signup code');

    const reg = await pool.request().input('phone', sql.NVarChar(32), normalizedPhone).query(`
      SELECT SignupId, Status, TenantId, StartMode, IndustryCode
      FROM dbo.PublicSignupRegistration
      WHERE PhoneNormalized=@phone;
    `);
    check(reg.recordset.length === 1, 'one signup registration row exists');
    const rr = reg.recordset[0] as any;
    check(String(rr.Status) === 'provisioned', 'signup registration status = provisioned');
    check(String(rr.StartMode) === 'demo', 'demo start mode persisted');
    check(String(rr.IndustryCode) === 'salon', 'salon industry persisted');

    const tenant = await pool.request()
      .input('tenantId', sql.UniqueIdentifier, String(rr.TenantId))
      .input('tenantCode', sql.NVarChar(64), tenantCodeArg)
      .query(`
        SELECT t.TenantId,t.Code,t.Name,s.PlanCode,s.Status,s.TrialEndsAt,
          p.PackCode
        FROM dbo.Tenant t
        JOIN dbo.TenantSubscription s ON s.TenantId=t.TenantId
        JOIN dbo.TenantIndustryPack p ON p.TenantId=t.TenantId
        WHERE t.TenantId=@tenantId AND t.Code=@tenantCode;
      `);
    check(tenant.recordset.length === 1, 'provisioned tenant exists and matches API response');
    const tr = tenant.recordset[0] as any;
    check(String(tr.PlanCode) === 'starter' && String(tr.Status) === 'trial', 'Starter trial created');
    check(new Date(tr.TrialEndsAt).getTime() > Date.now(), 'trial end is in the future');
    check(String(tr.PackCode) === 'salon', 'salon pack applied');

    const tid = String(tr.TenantId);
    const stats = (await pool.request().input('tenantId',sql.UniqueIdentifier,tid).query(`
      SELECT
        (SELECT COUNT(*) FROM dbo.Location WHERE TenantId=@tenantId) locations,
        (SELECT COUNT(*) FROM dbo.TenantMembership WHERE TenantId=@tenantId) memberships,
        (SELECT COUNT(*) FROM dbo.TblPro WHERE TenantId=@tenantId AND ISNULL(isDeleted,0)=0) services,
        (SELECT COUNT(*) FROM dbo.TblEmp WHERE TenantId=@tenantId AND ISNULL(isActive,1)=1) employees,
        (SELECT COUNT(*) FROM dbo.TenantAppEntitlement WHERE TenantId=@tenantId AND Status=N'installed') apps,
        (SELECT COUNT(*) FROM dbo.TenantAppEntitlement WHERE TenantId=@tenantId AND Status=N'installed' AND AppCode=N'messaging') messaging,
        (SELECT COUNT(*) FROM dbo.TenantAppEntitlement WHERE TenantId=@tenantId AND Status=N'installed' AND AppCode=N'ai-receptionist') aiApp,
        (SELECT COUNT(*) FROM dbo.TenantAiConfig WHERE TenantId=@tenantId) aiConfig,
        (SELECT COUNT(*) FROM dbo.TenantMessagingChannel WHERE TenantId=@tenantId) channels;
    `)).recordset[0];
    check(Number(stats.locations) === 1, 'one first branch created');
    check(Number(stats.memberships) === 1, 'one owner membership created');
    check(Number(stats.services) === 4, 'demo salon services created');
    check(Number(stats.employees) === 2, 'demo salon employees created');
    check(Number(stats.apps) >= 7, 'salon pack apps installed');
    check(Number(stats.messaging) === 0 && Number(stats.aiApp) === 0, 'messaging and AI apps are not installed');
    check(Number(stats.aiConfig) === 0 && Number(stats.channels) === 0, 'no AI config or WhatsApp channel created');

    const branch = (await pool.request().input('tenantId',sql.UniqueIdentifier,tid).query(`
      SELECT b.IsActive,b.LifecycleStatus,b.PublicBookingEnabled,b.ExternalNotificationsEnabled,q.BookingEnabled
      FROM dbo.Location l
      JOIN dbo.TblBranch b ON b.BranchID=l.LegacyBranchId
      LEFT JOIN dbo.QueueBookingSettings q ON q.BranchID=b.BranchID
      WHERE l.TenantId=@tenantId;
    `)).recordset[0];
    check(Boolean(branch.IsActive) && String(branch.LifecycleStatus) === 'INTERNAL_LIVE', 'first branch is internal-live');
    check(!Boolean(branch.PublicBookingEnabled) && !Boolean(branch.ExternalNotificationsEnabled), 'public booking and external notifications stay off');
    check(!Boolean(branch.BookingEnabled), 'booking settings remain private/off');

    const ownerLeak = (await pool.request().input('tenantId',sql.UniqueIdentifier,tid).query(`
      SELECT COUNT(*) n FROM dbo.TenantMembership m
      WHERE m.LegacyUserId IN (SELECT LegacyUserId FROM dbo.TenantMembership WHERE TenantId=@tenantId)
        AND m.TenantId<>@tenantId;
    `)).recordset[0];
    check(Number(ownerLeak.n) === 0, 'new owner has no cross-tenant membership');

    const before = JSON.parse(fs.readFileSync(snapshotFile, 'utf8'));
    check(JSON.stringify(before) === JSON.stringify(await bootFingerprint(pool, bootId)), 'CUT fingerprint unchanged after signup');

    const { purgeSmokeTenant } = await import('./smokeTenantPurge');
    check(await purgeSmokeTenant(pool, tenantCodeArg), 'synthetic tenant cleanup succeeded');

    const leftTenant = await pool.request().input('code',sql.NVarChar(64),tenantCodeArg).query(`SELECT COUNT(*) n FROM dbo.Tenant WHERE Code=@code;`);
    const leftSignup = await pool.request().input('phone',sql.NVarChar(32),normalizedPhone).query(`SELECT COUNT(*) n FROM dbo.PublicSignupRegistration WHERE PhoneNormalized=@phone;`);
    check(Number(leftTenant.recordset[0].n) === 0, 'synthetic tenant residue = 0');
    check(Number(leftSignup.recordset[0].n) === 0, 'synthetic signup residue = 0');
    check(JSON.stringify(before) === JSON.stringify(await bootFingerprint(pool, bootId)), 'CUT fingerprint unchanged after cleanup');

    fs.rmSync(snapshotFile, { force: true });
    console.log('PUBLIC_SIGNUP_PRODUCTION_SMOKE=PASS');
  } finally {
    await closePool().catch(() => undefined);
  }
}

main().catch((err) => {
  console.error('PUBLIC_SIGNUP_PRODUCTION_SMOKE=FAIL', err instanceof Error ? err.stack || err.message : String(err));
  process.exit(1);
});

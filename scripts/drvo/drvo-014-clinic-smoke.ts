#!/usr/bin/env npx tsx
/**
 * DRVO Clinics / migration 014 staging smoke.
 *
 * Runs ONLY against last132_agent as drvo_agent.
 * Proves clinic pack provisioning, medical schema, practitioner identity,
 * tenant-scoped encounter lifecycle, prescription signing, and cleanup.
 */
import Module from 'module';
import sql from 'mssql';
import { existsSync } from 'node:fs';

const moduleWithLoad = Module as unknown as {
  _load: (request: string, parent: unknown, isMain: boolean) => unknown;
};
const originalModuleLoad = moduleWithLoad._load;
moduleWithLoad._load = function patchedLoad(request: string, parent: unknown, isMain: boolean) {
  if (request === 'server-only') return {};
  return originalModuleLoad.call(moduleWithLoad, request, parent, isMain);
};

const STAGING_DB = 'last132_agent';
const STAGING_LOGIN = 'drvo_agent';
const PRODUCTION_DB = 'last132';

const TENANTS = [
  { code: 'DRVO014_CLINIC_A', branch: 'DRVO014_ABR', login: 'drvo014_clinic_a_owner' },
  { code: 'DRVO014_CLINIC_B', branch: 'DRVO014_BBR', login: 'drvo014_clinic_b_owner' },
] as const;

function forceStagingEnv(password: string) {
  const server = process.env.DRVO_STAGING_DB_SERVER || '127.0.0.1';
  const port = process.env.DRVO_STAGING_DB_PORT || '14330';
  const values: Record<string, string> = {
    CLOUD_DB_SERVER: server,
    CLOUD_DB_PORT: port,
    CLOUD_DB_NAME: STAGING_DB,
    CLOUD_DB_USER: STAGING_LOGIN,
    CLOUD_DB_PASSWORD: password,
    CLOUD_DB_ENCRYPT: 'false',
    CLOUD_DB_TRUST_CERT: 'true',
    DB_SERVER: server,
    DB_PORT: port,
    DB_DATABASE: STAGING_DB,
    DB_USER: STAGING_LOGIN,
    DB_PASSWORD: password,
    DB_ENCRYPT: 'false',
    DB_TRUST_SERVER_CERTIFICATE: 'true',
  };
  for (const [key, value] of Object.entries(values)) process.env[key] = value;
}

function config(): sql.config {
  return {
    server: process.env.DB_SERVER || '',
    port: Number(process.env.DB_PORT || 14330),
    database: process.env.DB_DATABASE || '',
    user: process.env.DB_USER || '',
    password: process.env.DB_PASSWORD || '',
    options: {
      encrypt: false,
      trustServerCertificate: true,
      enableArithAbort: true,
    },
    requestTimeout: 120000,
  };
}

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
  console.log(`  ok: ${message}`);
}

async function assertStaging(pool: sql.ConnectionPool) {
  const result = await pool.request().query(
    "SELECT DB_NAME() AS db, SUSER_SNAME() AS login, HAS_DBACCESS(N'last132') AS productionAccess;",
  );
  const db = String(result.recordset[0].db);
  const login = String(result.recordset[0].login);
  if (db === PRODUCTION_DB) throw new Error(`Refusing production database ${PRODUCTION_DB}`);
  check(db === STAGING_DB, `database is ${STAGING_DB}`);
  check(login.toLowerCase() === STAGING_LOGIN, `login is ${STAGING_LOGIN}`);
  check(Number(result.recordset[0].productionAccess) === 0, 'staging login cannot access production database');
}

async function cleanup(pool: sql.ConnectionPool) {
  const { purgeSmokeTenant } = await import('./smokeTenantPurge');
  for (const tenant of TENANTS) {
    if (await purgeSmokeTenant(pool, tenant.code)) {
      console.log(`  cleanup: removed ${tenant.code}`);
    }
  }
}

async function insertPatient(
  pool: sql.ConnectionPool,
  tenantId: string,
  name: string,
): Promise<number> {
  const result = await pool.request()
    .input('tenantId', sql.UniqueIdentifier, tenantId)
    .input('name', sql.NVarChar(100), name)
    .input('mobile', sql.NVarChar(30), '01000000114')
    .query(`
      INSERT INTO dbo.TblClient
        (TenantId, [Name], Mobile, RegisterDate)
      OUTPUT INSERTED.ClientID
      VALUES
        (@tenantId, @name, @mobile, GETDATE());
    `);
  return Number(result.recordset[0].ClientID);
}

async function main() {
  for (const file of ['.env', '.env.local', '.env.production', '.env.production.local']) {
    if (existsSync(file)) throw new Error(`Refusing clinic smoke from checkout containing ${file}`);
  }
  const host = process.env.DRVO_STAGING_DB_SERVER || '127.0.0.1';
  const port = Number(process.env.DRVO_STAGING_DB_PORT || '14330');
  if (host !== '127.0.0.1' || ![1433, 14330].includes(port)) {
    throw new Error('Clinic smoke only supports VPS loopback SQL or the staging-only SSH tunnel');
  }
  const localClass = String(process.env.HAWAI_DB_CLASS || process.env.BOOKING_V2_DB_CLASS || '').trim().toLowerCase();
  const forceLocal = String(process.env.BOOKING_V2_FORCE_LOCAL_DB || '').trim().toLowerCase();
  if (['local', 'isolated', 'test', 'dev'].includes(localClass) || ['1', 'true', 'yes', 'on'].includes(forceLocal)) {
    throw new Error('Refusing clinic smoke with a local DB target override');
  }
  const password = process.env.DRVO_STAGING_DB_PASSWORD || '';
  if (!password) throw new Error('Missing DRVO_STAGING_DB_PASSWORD');
  process.env.STAGING_SAFETY_ENFORCE = '1';
  process.env.STAGING_SAFETY_DB_NAME = STAGING_DB;
  forceStagingEnv(password);

  const cfg = config();
  if (cfg.database !== STAGING_DB || cfg.user !== STAGING_LOGIN) {
    throw new Error(`Refusing: expected ${STAGING_DB} as ${STAGING_LOGIN}`);
  }

  const {
    verifyClinicCoreSchema,
  } = await import('./migrations/014-clinic-core');
  const { provisionTenant } = await import('../../src/platform/onboarding/provisionTenant');
  const { CLINIC_PACK } = await import('../../src/packs/clinic/public');
  const { createTenantEmployee } = await import('../../src/lib/hr/tenantEmployeeCreate');
  const { ensureEmployeeBranchAssignment } = await import(
    '../../src/lib/branch/assignmentIntegrity'
  );
  const clinic = await import('../../src/apps/medical-records/internal/repository');

  const pool = await sql.connect(cfg);
  try {
    await assertStaging(pool);
    await cleanup(pool);

    console.log('Scenario 1 — migration 014 schema + ledger');
    const schema = await verifyClinicCoreSchema(pool);
    check(schema.ok, `clinic schema verify (${schema.failures.join('; ') || 'clean'})`);
    const ledger = await pool.request().query(`
      SELECT MigrationId, MigrationKey, Checksum
      FROM dbo.DrvoSchemaMigration
      WHERE MigrationId=14;
    `);
    check(ledger.recordset.length === 1, 'migration 14 ledger row exists');
    check(
      String(ledger.recordset[0].MigrationKey) === 'clinic-core',
      'migration 14 key is clinic-core',
    );

    const actorRow = await pool.request().query(`
      SELECT TOP 1 UserID
      FROM dbo.TblUser
      WHERE ISNULL(isDeleted,0)=0
      ORDER BY UserID;
    `);
    if (!actorRow.recordset.length) throw new Error('No active staging user for smoke actor');
    const actor = {
      actorUserId: Number(actorRow.recordset[0].UserID),
      actorUserName: 'drvo014-smoke',
    };

    console.log('Scenario 2 — provision two clinic tenants');
    const a = await provisionTenant(
      {
        tenantCode: TENANTS[0].code,
        tenantDisplayName: 'DRVO Clinics Smoke A',
        defaultTimezone: 'Africa/Cairo',
        ownerUserName: 'Clinic A Owner',
        ownerLoginName: TENANTS[0].login,
        ownerPassword: 'smoke-pass-change-me',
        firstBranchCode: TENANTS[0].branch,
        firstBranchName: 'Clinic A Main',
        industryPack: CLINIC_PACK,
        subscriptionStatus: 'active',
      },
      actor,
    );
    const b = await provisionTenant(
      {
        tenantCode: TENANTS[1].code,
        tenantDisplayName: 'DRVO Clinics Smoke B',
        defaultTimezone: 'Africa/Cairo',
        ownerUserName: 'Clinic B Owner',
        ownerLoginName: TENANTS[1].login,
        ownerPassword: 'smoke-pass-change-me',
        firstBranchCode: TENANTS[1].branch,
        firstBranchName: 'Clinic B Main',
        industryPack: CLINIC_PACK,
        subscriptionStatus: 'active',
      },
      actor,
    );

    check(a.readiness.overall === 'PASS', 'clinic tenant A readiness PASS');
    check(b.readiness.overall === 'PASS', 'clinic tenant B readiness PASS');
    check(a.apps.includes('medical-records'), 'clinic tenant A has medical-records');
    check(a.apps.includes('booking'), 'clinic tenant A has booking');
    check(a.tenantId !== b.tenantId, 'clinic tenants are isolated identities');

    console.log('Scenario 3 — create doctor identity + patient');
    const { empId } = await createTenantEmployee({
      tenantId: a.tenantId,
      name: 'د. Smoke Clinic',
      job: 'طبيب',
      isActive: true,
    });
    await ensureEmployeeBranchAssignment({
      empId,
      branchId: a.legacyBranchId,
      effectiveFrom: new Date().toISOString().slice(0, 10),
      canReceiveBookings: true,
      isHomeBranch: true,
    });
    await clinic.registerClinicPractitioner({
      tenantId: a.tenantId,
      empId,
      userId: a.legacyUserId,
      actorUserId: a.legacyUserId,
      specialty: 'باطنة',
      licenseNumber: 'SMOKE-014',
    });
    const clinicalActor = await clinic.resolveClinicalActorForUser(
      a.tenantId,
      a.legacyUserId,
    );
    check(clinicalActor?.kind === 'human', 'owner login resolves to human clinician');
    check(
      clinicalActor?.kind === 'human' && clinicalActor.empId === empId,
      'clinical login maps to the created doctor',
    );

    const clientId = await insertPatient(pool, a.tenantId, 'Clinic Smoke Patient');
    check(clientId > 0, 'tenant-scoped patient created');

    console.log('Scenario 4 — encounter + medical profile + draft');
    const encounterId = await clinic.openEncounter({
      tenantId: a.tenantId,
      clientId,
      practitionerEmpId: empId,
      locationId: a.locationId,
      branchId: a.legacyBranchId,
      workDate: new Date().toISOString().slice(0, 10),
      visitType: 'new',
      chiefComplaint: 'Smoke abdominal pain',
      actorUserId: a.legacyUserId,
    });
    check(Boolean(encounterId), 'encounter opened');

    if (!clinicalActor || clinicalActor.kind !== 'human') {
      throw new Error('Clinical actor unexpectedly missing');
    }

    await clinic.upsertPatientProfile(
      a.tenantId,
      clientId,
      {
        bloodType: 'O+',
        allergies: 'Penicillin',
        chronicConditions: 'Hypertension',
        currentMedications: 'Amlodipine',
        emergencyContactName: 'Smoke Contact',
        emergencyContactPhone: '01000000115',
        notes: 'Staging smoke only',
      },
      a.legacyUserId,
    );

    await clinic.saveEncounterDraft({
      tenantId: a.tenantId,
      encounterId,
      actor: clinicalActor,
      clinicalNotes: 'Smoke examination notes',
      diagnosisSummary: 'Smoke diagnosis',
      vitals: {
        bloodPressure: '120/80',
        temperature: '37',
        pulse: '72',
        oxygenSaturation: '99%',
      },
      followUpAt: null,
    });

    const workspace = await clinic.getEncounterWorkspace(a.tenantId, encounterId);
    check(Boolean(workspace), 'assigned tenant can read encounter workspace');
    check(
      String((workspace?.patientProfile as Record<string, unknown> | null)?.BloodType) === 'O+',
      'patient medical profile persisted',
    );

    console.log('Scenario 5 — prescription draft + human sign');
    const prescriptionId = await clinic.createPrescriptionDraft({
      tenantId: a.tenantId,
      encounterId,
      actor: clinicalActor,
      notes: 'Smoke prescription',
      items: [
        {
          medicationName: 'SmokeMed',
          strength: '10 mg',
          dosage: '1 tablet',
          frequency: 'once daily',
          duration: '5 days',
          route: 'oral',
          instructions: 'after food',
        },
      ],
    });
    await clinic.signPrescription({
      tenantId: a.tenantId,
      prescriptionId,
      actor: clinicalActor,
    });

    console.log('Scenario 6 — complete encounter');
    await clinic.completeEncounter({
      tenantId: a.tenantId,
      encounterId,
      actor: clinicalActor,
      clinicalNotes: 'Smoke examination notes',
      diagnosisSummary: 'Smoke diagnosis',
      vitals: { bloodPressure: '120/80' },
      followUpAt: null,
    });

    const completed = await clinic.getEncounterWorkspace(a.tenantId, encounterId);
    const encounter = completed?.encounter as Record<string, unknown> | undefined;
    const prescriptions = (completed?.prescriptions ?? []) as Array<Record<string, unknown>>;
    check(String(encounter?.Status) === 'completed', 'encounter completed');
    check(
      prescriptions.some((rx) => String(rx.Status) === 'signed'),
      'signed prescription persisted',
    );

    console.log('Scenario 7 — tenant isolation');
    const crossTenant = await clinic.getEncounterWorkspace(b.tenantId, encounterId);
    check(crossTenant === null, 'tenant B cannot read tenant A encounter');
    const crossActor = await clinic.resolveClinicalActorForUser(
      b.tenantId,
      a.legacyUserId,
    );
    check(crossActor === null, 'tenant A doctor login is not a clinician in tenant B');

    console.log('Scenario 8 — audit + cleanup');
    const audits = await pool.request()
      .input('tenantId', sql.UniqueIdentifier, a.tenantId)
      .query(`
        SELECT Action, COUNT(*) AS n
        FROM dbo.ClinicClinicalAudit
        WHERE TenantId=@tenantId
        GROUP BY Action;
      `);
    const actions = new Set(audits.recordset.map((row: { Action: string }) => String(row.Action)));
    for (const required of [
      'login-linked',
      'opened',
      'upsert',
      'draft-saved',
      'draft-created',
      'signed',
      'completed',
    ]) {
      check(actions.has(required), `clinical audit contains ${required}`);
    }

    await cleanup(pool);
    const residue = await pool.request().query(`
      SELECT COUNT(*) AS cnt
      FROM dbo.Tenant
      WHERE Code LIKE N'DRVO014[_]CLINIC[_]%';
    `);
    check(Number(residue.recordset[0].cnt) === 0, 'no DRVO014 clinic tenant residue');

    const clinicResidue = await pool.request().query(`
      SELECT
        (SELECT COUNT(*) FROM dbo.ClinicPatientProfile cp
         JOIN dbo.Tenant t ON t.TenantId=cp.TenantId
         WHERE t.Code LIKE N'DRVO014[_]CLINIC[_]%') AS profiles,
        (SELECT COUNT(*) FROM dbo.ClinicEncounter ce
         JOIN dbo.Tenant t ON t.TenantId=ce.TenantId
         WHERE t.Code LIKE N'DRVO014[_]CLINIC[_]%') AS encounters;
    `);
    check(Number(clinicResidue.recordset[0].profiles) === 0, 'no clinic profile residue');
    check(Number(clinicResidue.recordset[0].encounters) === 0, 'no clinic encounter residue');

    console.log('DRVO-014 Clinics staging smoke PASS');
  } finally {
    try {
      await cleanup(pool);
    } catch (err) {
      console.error('Best-effort cleanup failed:', err instanceof Error ? err.message : err);
    }
    await pool.close();
  }
}

main().catch((err) => {
  console.error('DRVO-014 Clinics staging smoke FAIL:', err instanceof Error ? err.message : err);
  process.exit(1);
});

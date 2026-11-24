/**
 * Fail-closed database safety for integration / destructive tests.
 *
 * Never trust env alone — always validate the live `DB_NAME()` from the pool.
 * Production `last132` is hard-denied. Approved targets must be explicitly listed
 * and opted-in via APPROVED_TEST_DB (or DRVO_APPROVED_TEST_DB).
 *
 * Application runtime / production POS paths must NOT call this helper.
 */

export const PRODUCTION_DATABASE = 'last132';
export const STAGING_DATABASE = 'last132_agent';

/** Explicit allowlist for destructive / mutating integration tests. */
export const APPROVED_TEST_DATABASES = [
  STAGING_DATABASE,
  'hawai_booking_v2_test',
  'hawai_booking_v2_isolated',
] as const;

export type DbIdentity = {
  databaseName: string;
  loginName: string;
};

export type ApprovedTestDbResult = {
  ok: true;
  identity: DbIdentity;
  approvedName: string;
};

export class UnapprovedTestDatabaseError extends Error {
  readonly code = 'UNAPPROVED_TEST_DATABASE';
  readonly identity?: DbIdentity;
  readonly configuredName?: string;

  constructor(message: string, identity?: DbIdentity, configuredName?: string) {
    super(message);
    this.name = 'UnapprovedTestDatabaseError';
    this.identity = identity;
    this.configuredName = configuredName;
  }
}

function pickEnv(env: NodeJS.ProcessEnv, keys: string[]): string {
  for (const key of keys) {
    const value = env[key];
    if (value != null && String(value).trim() !== '') return String(value).trim();
  }
  return '';
}

function normalizeDbName(name: string): string {
  return String(name || '').trim().toLowerCase();
}

function isExplicitlyApprovedFlag(env: NodeJS.ProcessEnv): boolean {
  const raw = pickEnv(env, ['APPROVED_TEST_DB', 'DRVO_APPROVED_TEST_DB']);
  const v = raw.toLowerCase();
  return v === '1' || v === 'true' || v === 'yes' || v === 'on';
}

/** Env-configured database name (not live identity). */
export function resolveConfiguredDatabaseName(
  env: NodeJS.ProcessEnv = process.env,
): string {
  return pickEnv(env, [
    'BOOKING_V2_TEST_DB_NAME',
    'LOCAL_DB_NAME',
    'DB_DATABASE',
    'DB_NAME',
    'CLOUD_DB_NAME',
  ]);
}

export function isProductionDatabaseName(name: string): boolean {
  return normalizeDbName(name) === PRODUCTION_DATABASE;
}

export function isAllowlistedTestDatabaseName(name: string): boolean {
  const n = normalizeDbName(name);
  if (!n) return false;
  if (APPROVED_TEST_DATABASES.map(normalizeDbName).includes(n)) return true;
  // Extra isolated / local harness DBs by naming convention
  return /(^|_)(test|isolat|dev|agent)(_|$)/i.test(n) && !isProductionDatabaseName(n);
}

type QueryablePool = {
  request: () => {
    query: (
      sqlText: string,
    ) => Promise<{ recordset: Array<Record<string, unknown>> }>;
  };
};

/**
 * Read live identity from an open pool. Prefer this over env checks.
 */
export async function readConnectedDatabaseIdentity(
  pool: QueryablePool,
): Promise<DbIdentity> {
  const result = await pool.request().query(`
    SELECT DB_NAME() AS DatabaseName, SUSER_SNAME() AS LoginName
  `);
  const row = result.recordset[0] || {};
  return {
    databaseName: String(row.DatabaseName ?? ''),
    loginName: String(row.LoginName ?? ''),
  };
}

/**
 * Fail-closed gate for mutating integration tests.
 * Throws UnapprovedTestDatabaseError unless:
 * 1) APPROVED_TEST_DB / DRVO_APPROVED_TEST_DB is explicitly set
 * 2) live DB_NAME() is not production last132
 * 3) live DB_NAME() is allowlisted (staging / test / isolated)
 * 4) env-configured name (if set) is not production and does not disagree with live name when both are set
 */
export async function assertApprovedTestDatabase(
  pool: QueryablePool,
  env: NodeJS.ProcessEnv = process.env,
): Promise<ApprovedTestDbResult> {
  const configured = resolveConfiguredDatabaseName(env);
  const identity = await readConnectedDatabaseIdentity(pool);
  const live = identity.databaseName;

  if (!isExplicitlyApprovedFlag(env)) {
    throw new UnapprovedTestDatabaseError(
      'Destructive/integration DB tests require APPROVED_TEST_DB=1 (or DRVO_APPROVED_TEST_DB=1). Refusing to continue.',
      identity,
      configured || undefined,
    );
  }

  if (!live) {
    throw new UnapprovedTestDatabaseError(
      'Connected database name is empty — refusing destructive test.',
      identity,
      configured || undefined,
    );
  }

  if (isProductionDatabaseName(live)) {
    throw new UnapprovedTestDatabaseError(
      `HARD DENY: connected database is production "${PRODUCTION_DATABASE}". Integration tests must never run against production.`,
      identity,
      configured || undefined,
    );
  }

  if (configured && isProductionDatabaseName(configured)) {
    throw new UnapprovedTestDatabaseError(
      `HARD DENY: configured database env points at production "${PRODUCTION_DATABASE}".`,
      identity,
      configured,
    );
  }

  if (configured && normalizeDbName(configured) !== normalizeDbName(live)) {
    throw new UnapprovedTestDatabaseError(
      `Configured DB "${configured}" does not match connected DB "${live}". Refusing destructive test.`,
      identity,
      configured,
    );
  }

  if (!isAllowlistedTestDatabaseName(live)) {
    throw new UnapprovedTestDatabaseError(
      `Connected database "${live}" is not an approved test/staging target. Allowed examples: ${APPROVED_TEST_DATABASES.join(', ')}.`,
      identity,
      configured || undefined,
    );
  }

  return {
    ok: true,
    identity,
    approvedName: live,
  };
}

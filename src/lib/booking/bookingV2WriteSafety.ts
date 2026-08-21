/**
 * Booking V2 write-test safety fence.
 * Refuses mutations when target DB looks like Azure SoT / last132 / non-test.
 *
 * Explicit allowlist (any one required for writes):
 *   BOOKING_V2_WRITE_TEST_OK=1
 *   + DB name matches /test|isolat|local|dev/i OR HAWAI_DB_CLASS=test|local|isolated
 *
 * Hard deny:
 *   DB name last132
 *   server *.database.windows.net unless HAWAI_DB_CLASS=isolated AND BOOKING_V2_ALLOW_AZURE_TEST=1
 *     (default: Azure always denied for write tests)
 */

export type WriteSafetySnapshot = {
  ok: boolean;
  reason: string;
  dbServer: string;
  dbName: string;
  dbClass: string;
  writeTestOk: boolean;
  isAzure: boolean;
  isLast132: boolean;
};

function pickEnv(env: NodeJS.ProcessEnv, keys: string[]): string {
  for (const k of keys) {
    const v = env[k];
    if (v != null && String(v).trim() !== '') return String(v).trim();
  }
  return '';
}

export function resolveWriteDbTarget(env: NodeJS.ProcessEnv = process.env): {
  server: string;
  database: string;
} {
  return {
    server: pickEnv(env, [
      'BOOKING_V2_TEST_DB_SERVER',
      'LOCAL_DB_SERVER',
      'DB_SERVER',
      'CLOUD_DB_SERVER',
    ]),
    database: pickEnv(env, [
      'BOOKING_V2_TEST_DB_NAME',
      'LOCAL_DB_NAME',
      'DB_DATABASE',
      'DB_NAME',
      'CLOUD_DB_NAME',
    ]),
  };
}

export function assertBookingV2WriteTestSafety(
  env: NodeJS.ProcessEnv = process.env,
): WriteSafetySnapshot {
  const { server, database } = resolveWriteDbTarget(env);
  const dbClass = String(env.HAWAI_DB_CLASS || env.BOOKING_V2_DB_CLASS || '')
    .trim()
    .toLowerCase();
  const writeTestOk =
    String(env.BOOKING_V2_WRITE_TEST_OK || '').trim() === '1' ||
    String(env.BOOKING_V2_WRITE_TEST_OK || '').trim().toLowerCase() === 'true';
  const isAzure = /\.database\.windows\.net$/i.test(server);
  const isLast132 = database.toLowerCase() === 'last132';
  const nameLooksTest = /(test|isolat|local|dev|hawai.?booking.?v2)/i.test(
    database,
  );
  const classOk =
    dbClass === 'test' ||
    dbClass === 'local' ||
    dbClass === 'isolated' ||
    dbClass === 'dev';

  const base = {
    dbServer: server || '(unset)',
    dbName: database || '(unset)',
    dbClass: dbClass || '(unset)',
    writeTestOk,
    isAzure,
    isLast132,
  };

  if (isLast132) {
    return {
      ...base,
      ok: false,
      reason: 'HARD DENY: database last132 (Azure SoT) — write tests forbidden',
    };
  }

  if (isAzure && String(env.BOOKING_V2_ALLOW_AZURE_TEST || '').trim() !== '1') {
    return {
      ...base,
      ok: false,
      reason:
        'HARD DENY: Azure SQL server — write tests must use local/isolated SQL Express (not *.database.windows.net)',
    };
  }

  if (!writeTestOk) {
    return {
      ...base,
      ok: false,
      reason:
        'WRITE DENIED: set BOOKING_V2_WRITE_TEST_OK=1 explicitly for isolated write harness',
    };
  }

  if (!classOk && !nameLooksTest) {
    return {
      ...base,
      ok: false,
      reason:
        'WRITE DENIED: set HAWAI_DB_CLASS=test|local|isolated OR use a DB name containing test/isolated/local',
    };
  }

  if (!server || !database) {
    return {
      ...base,
      ok: false,
      reason: 'WRITE DENIED: DB server/name unset',
    };
  }

  return {
    ...base,
    ok: true,
    reason: 'OK — isolated/local write target accepted',
  };
}

export function requireBookingV2WriteTestSafety(
  env: NodeJS.ProcessEnv = process.env,
): WriteSafetySnapshot {
  const snap = assertBookingV2WriteTestSafety(env);
  if (!snap.ok) {
    const err = new Error(`[booking-v2-write-safety] ${snap.reason}`);
    (err as Error & { safety: WriteSafetySnapshot }).safety = snap;
    throw err;
  }
  return snap;
}

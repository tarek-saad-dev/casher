#!/usr/bin/env node
/**
 * Start Hawai (next start) against isolated Booking V2 DB on :5500.
 * Loads .env.booking-v2-isolated into process.env BEFORE spawning next,
 * so shell values win over .env.local (Azure last132).
 *
 *   node scripts/start-booking-v2-isolated.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';

const root = process.cwd();
const envPath = path.join(root, '.env.booking-v2-isolated');
if (!fs.existsSync(envPath)) {
  console.error('Missing .env.booking-v2-isolated — run provision script first');
  process.exit(1);
}

function parseEnvFile(file) {
  const out = {};
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i < 0) continue;
    const k = t.slice(0, i).trim();
    let v = t.slice(i + 1).trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    out[k] = v;
  }
  return out;
}

const isolated = parseEnvFile(envPath);
Object.assign(process.env, isolated);

// Hard safety: never inherit Azure SoT for this process tree.
process.env.CLOUD_DB_SERVER = '';
process.env.CLOUD_DB_NAME = '';
process.env.CLOUD_DB_USER = '';
process.env.CLOUD_DB_PASSWORD = '';
process.env.DB_SERVER = isolated.DB_SERVER || '.\\SQLEXPRESS';
process.env.DB_DATABASE = isolated.DB_DATABASE || 'HawaiBookingV2Isolated';
process.env.LOCAL_DB_SERVER = process.env.DB_SERVER;
process.env.LOCAL_DB_NAME = process.env.DB_DATABASE;
process.env.HAWAI_DB_CLASS = 'isolated';
process.env.BOOKING_V2_WRITE_TEST_OK = '1';
process.env.BOOKING_V2_USE_TRUSTED_CONNECTION = '1';
process.env.BOOKING_V2_FORCE_LOCAL_DB = '1';
process.env.NODE_ENV = 'production';
process.env.BOOKING_V2_READ_MODE = 'v2';
process.env.BOOKING_V2_HOT_CACHE = 'on';
process.env.BOOKING_V2_SHADOW_MODE = 'always';
process.env.BOOKING_V2_SLOT_CLAIMS_MODE = 'shadow';
process.env.BOOKING_V2_HOLD_POLICY_MODE = 'enforce';
process.env.SESSION_SECRET =
  process.env.SESSION_SECRET ||
  'booking-v2-isolated-local-session-secret-min-32b!!';
process.env.PUBLIC_BOOKING_RL_CREATE = '500';
process.env.PUBLIC_BOOKING_RL_AVAILABILITY = '500';
process.env.PUBLIC_BOOKING_RL_CATALOG = '500';
process.env.PUBLIC_BOOKING_RL_VALIDATION = '200';
process.env.PUBLIC_BOOKING_RL_PLAN = '200';
process.env.PUBLIC_BOOKING_RL_CANCEL = '200';
process.env.PORT = process.env.PORT || '5500';

if (
  String(process.env.DB_DATABASE).toLowerCase() === 'last132' ||
  /\.database\.windows\.net$/i.test(String(process.env.DB_SERVER))
) {
  console.error('REFUSING START: Azure/last132 target');
  process.exit(2);
}

console.log('[start-isolated]', {
  db: `${process.env.DB_SERVER}/${process.env.DB_DATABASE}`,
  class: process.env.HAWAI_DB_CLASS,
  port: process.env.PORT,
  flags: {
    READ_MODE: process.env.BOOKING_V2_READ_MODE,
    HOT_CACHE: process.env.BOOKING_V2_HOT_CACHE,
    SHADOW: process.env.BOOKING_V2_SHADOW_MODE,
    CLAIMS: process.env.BOOKING_V2_SLOT_CLAIMS_MODE,
    HOLD: process.env.BOOKING_V2_HOLD_POLICY_MODE,
  },
});

const require = createRequire(import.meta.url);
const nextBin = require.resolve('next/dist/bin/next');
const child = spawn(
  process.execPath,
  [nextBin, 'start', '-p', String(process.env.PORT)],
  {
    cwd: root,
    env: process.env,
    stdio: 'inherit',
  },
);
child.on('exit', (code) => process.exit(code ?? 1));

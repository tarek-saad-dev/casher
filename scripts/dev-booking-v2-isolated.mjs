#!/usr/bin/env node
/** Dev mode against isolated DB — shows runtime errors on /operations. */
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';

const root = process.cwd();
const envPath = path.join(root, '.env.booking-v2-isolated');
if (!fs.existsSync(envPath)) {
  console.error('Missing .env.booking-v2-isolated');
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
process.env.CLOUD_DB_SERVER = '';
process.env.CLOUD_DB_NAME = '';
process.env.CLOUD_DB_USER = '';
process.env.CLOUD_DB_PASSWORD = '';
process.env.DB_SERVER = isolated.DB_SERVER || '.\\SQLEXPRESS';
process.env.DB_DATABASE = isolated.DB_DATABASE || 'HawaiBookingV2Isolated';
process.env.LOCAL_DB_SERVER = process.env.DB_SERVER;
process.env.LOCAL_DB_NAME = process.env.DB_DATABASE;
process.env.HAWAI_DB_CLASS = 'isolated';
process.env.BOOKING_V2_FORCE_LOCAL_DB = '1';
process.env.BOOKING_V2_USE_TRUSTED_CONNECTION = '1';
process.env.NODE_ENV = 'development';
process.env.PORT = process.env.PORT || '5502';

console.log('[dev-isolated]', {
  db: `${process.env.DB_SERVER}/${process.env.DB_DATABASE}`,
  port: process.env.PORT,
});

const require = createRequire(import.meta.url);
const nextBin = require.resolve('next/dist/bin/next');
const child = spawn(
  process.execPath,
  [nextBin, 'dev', '-p', String(process.env.PORT)],
  { cwd: root, env: process.env, stdio: 'inherit' },
);
child.on('exit', (code) => process.exit(code ?? 1));

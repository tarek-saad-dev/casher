#!/usr/bin/env npx tsx
/**
 * Business-day reconcile runner.
 *
 * Invokes the internal endpoint; BusinessClock (08:00 branch-local) decides
 * whether any branch actually rolls. Safe to run hourly — reconciliation is
 * idempotent. Do not treat this script's clock as the business-date source.
 *
 * Once:
 *   npm run business-day:reconcile
 *
 * Env:
 *   NIGHTLY_CLOSE_BASE_URL  default http://localhost:5500
 *   CRON_SECRET             Bearer token (default "dev" if unset)
 */
import path from 'path';
import dotenv from 'dotenv';

dotenv.config({ path: path.join(__dirname, '..', '.env') });
dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

const BASE_URL = (process.env.NIGHTLY_CLOSE_BASE_URL || 'http://localhost:5500').replace(
  /\/$/,
  '',
);
const CRON_SECRET = process.env.CRON_SECRET || 'dev';
const ENDPOINT = '/api/internal/operations/business-day/reconcile';
const REQUEST_TIMEOUT_MS = 2 * 60 * 1000;

async function main() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  console.log(`[business-day-reconcile] POST ${BASE_URL}${ENDPOINT}`);
  try {
    const res = await fetch(`${BASE_URL}${ENDPOINT}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${CRON_SECRET}`,
      },
      body: '{}',
      signal: controller.signal,
    });
    const data = await res.json().catch(() => ({}));
    console.log('[business-day-reconcile] HTTP', res.status);
    console.log(JSON.stringify(data, null, 2));
    if (!data?.ok) process.exitCode = 1;
  } finally {
    clearTimeout(timeout);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

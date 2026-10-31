#!/usr/bin/env npx tsx
/**
 * Production VPS runner for progressive late-attendance WhatsApp alerts
 * (+ durable finalize recovery).
 *
 * Once:
 *   npm run late-deduction:alerts
 *
 * Watch (every minute, Africa/Cairo wall clock):
 *   npm run late-deduction:alerts:watch
 *
 * Env:
 *   NIGHTLY_CLOSE_BASE_URL  default http://127.0.0.1:3000
 *   CRON_SECRET             Bearer token (default "dev" if unset)
 */
import path from 'path';
import dotenv from 'dotenv';

dotenv.config({ path: path.join(__dirname, '..', '.env') });
dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

const BASE_URL = (process.env.NIGHTLY_CLOSE_BASE_URL || 'http://127.0.0.1:3000').replace(
  /\/$/,
  '',
);
const CRON_SECRET = process.env.CRON_SECRET || 'dev';
const ENDPOINT = '/api/admin/hr/late-deduction/alerts/run';
const REQUEST_TIMEOUT_MS = 2 * 60 * 1000;
const WATCH_INTERVAL_MS = 60_000;

const flags = new Set(process.argv.slice(2));
const watchMode = flags.has('--watch');

async function runOnce(): Promise<boolean> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  console.log(`[late-deduction-alerts] POST ${BASE_URL}${ENDPOINT}`);
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
    console.log('[late-deduction-alerts] HTTP', res.status);
    console.log(JSON.stringify(data, null, 2));
    return Boolean(data?.ok) && res.ok;
  } finally {
    clearTimeout(timeout);
  }
}

async function watch() {
  console.log(
    `[late-deduction-alerts] watching every ${WATCH_INTERVAL_MS / 1000}s → ${BASE_URL}${ENDPOINT}`,
  );
  let running = false;
  const tick = async () => {
    if (running) {
      console.log('[late-deduction-alerts] previous tick still running — skip');
      return;
    }
    running = true;
    try {
      await runOnce();
    } catch (err) {
      console.error('[late-deduction-alerts] tick failed:', err);
    } finally {
      running = false;
    }
  };
  await tick();
  setInterval(() => {
    void tick();
  }, WATCH_INTERVAL_MS);
}

async function main() {
  if (watchMode) {
    await watch();
    return;
  }
  const ok = await runOnce();
  if (!ok) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

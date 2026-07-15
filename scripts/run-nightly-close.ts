#!/usr/bin/env npx tsx
/**
 * Local nightly-close runner / watcher for Africa/Cairo 01:00.
 *
 * Once (Cairo yesterday):
 *   npm run nightly-close
 *   npm run nightly-close:dry
 *   npx tsx scripts/run-nightly-close.ts --date=2026-07-14
 *   npx tsx scripts/run-nightly-close.ts --skip-whatsapp
 *
 * Watch until 01:00 Cairo then fire:
 *   npm run nightly-close:watch
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
const REQUEST_TIMEOUT_MS = 10 * 60 * 1000;
const ENDPOINT = '/api/admin/hr/nightly-close';

function parseArgs(argv: string[]) {
  const flags = new Set(argv.filter((a) => a.startsWith('--') && !a.includes('=')));
  const kv = Object.fromEntries(
    argv
      .filter((a) => a.startsWith('--') && a.includes('='))
      .map((a) => {
        const i = a.indexOf('=');
        return [a.slice(2, i), a.slice(i + 1)];
      }),
  );
  return {
    watch: flags.has('--watch'),
    dryRun: flags.has('--dry-run'),
    skipWhatsApp: flags.has('--skip-whatsapp'),
    date: kv.date as string | undefined,
  };
}

function getCairoClockParts(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Cairo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '0';
  return {
    date: `${get('year')}-${get('month')}-${get('day')}`,
    hour: Number(get('hour')),
    minute: Number(get('minute')),
  };
}

function cairoYesterday(): string {
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Cairo' });
  const [y, m, d] = today.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() - 1);
  return dt.toISOString().slice(0, 10);
}

async function callNightlyClose(opts: {
  workDate?: string;
  dryRun?: boolean;
  skipWhatsApp?: boolean;
}) {
  const controller = new AbortController();
  const started = Date.now();
  const heartbeat = setInterval(() => {
    const sec = Math.round((Date.now() - started) / 1000);
    console.log(
      `[run-nightly-close] still running… ${sec}s (payroll + WhatsApp can take several minutes)`,
    );
  }, 15_000);
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const res = await fetch(`${BASE_URL}${ENDPOINT}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${CRON_SECRET}`,
      },
      body: JSON.stringify({
        workDate: opts.workDate,
        dryRun: opts.dryRun,
        skipWhatsApp: opts.skipWhatsApp,
      }),
      signal: controller.signal,
    });
    const data = await res.json().catch(() => ({}));
    return { status: res.status, data };
  } finally {
    clearInterval(heartbeat);
    clearTimeout(timeout);
  }
}

async function runOnce(opts: ReturnType<typeof parseArgs>) {
  const resolvedDate = opts.date ?? cairoYesterday();
  console.log(`[run-nightly-close] POST ${BASE_URL}${ENDPOINT}`, {
    workDate: resolvedDate,
    note: opts.date ? 'explicit --date' : 'cairo yesterday (auto)',
    dryRun: opts.dryRun,
    skipWhatsApp: opts.skipWhatsApp,
    auth: CRON_SECRET === 'dev' ? 'Bearer dev (no CRON_SECRET)' : 'Bearer CRON_SECRET',
  });
  console.log(
    '[run-nightly-close] waiting for response — do not Ctrl+C; WhatsApp send is sequential…',
  );

  const { status, data } = await callNightlyClose({
    workDate: resolvedDate,
    dryRun: opts.dryRun,
    skipWhatsApp: opts.skipWhatsApp,
  });
  console.log('[run-nightly-close] HTTP', status);
  console.log(JSON.stringify(data, null, 2));
  if (!data?.ok) process.exitCode = 1;
}

async function watch() {
  console.log(
    `[run-nightly-close] watching for 01:00–01:05 Africa/Cairo → ${BASE_URL}${ENDPOINT}`,
  );
  let lastFiredKey: string | null = null;

  for (;;) {
    const clock = getCairoClockParts();
    // Forgiving window: fires once per Cairo calendar night if process is up by 01:05
    if (clock.hour === 1 && clock.minute <= 5) {
      const key = `${clock.date}-01:00`;
      if (lastFiredKey !== key) {
        lastFiredKey = key;
        console.log(`[run-nightly-close] FIRE ${key} → closes ${cairoYesterday()}`);
        try {
          await runOnce({
            watch: true,
            dryRun: false,
            skipWhatsApp: false,
            date: undefined,
          });
        } catch (err) {
          console.error('[run-nightly-close] fire failed', err);
        }
      }
    }
    await new Promise((r) => setTimeout(r, 15_000));
  }
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.watch) {
    await watch();
    return;
  }
  await runOnce(opts);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

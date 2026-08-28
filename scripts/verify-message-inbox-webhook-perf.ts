#!/usr/bin/env npx tsx
/**
 * Phase 1.1 performance smoke: inbound WhatsApp webhook ingest timing.
 * Uses POST /api/internal/messaging/inbox/whatsapp (handler or live HTTP).
 * Never prints secrets or message text.
 */
import path from 'path';
import Module from 'module';
import dotenv from 'dotenv';

dotenv.config({ path: path.join(__dirname, '..', '.env') });
dotenv.config({ path: path.join(__dirname, '..', '.env.local'), override: true });

const mod = Module as unknown as { _load: (...args: unknown[]) => unknown };
const origLoad = mod._load;
mod._load = function (request: string, ...rest: unknown[]) {
  if (request === 'server-only') return {};
  return origLoad.call(this, request, ...rest);
};

import { NextRequest } from 'next/server';
import { percentile } from '../src/modules/messaging/inbox/observability/inboxWebhookPerf';
import { resolveWhatsAppInboxWebhookTokenForTests } from '../src/modules/messaging/inbox/auth';

const PROVIDER = 'whatsapp-web';
const FIRST_INSERT_SAMPLES = 8;
const DUPLICATE_SAMPLES = 8;
const BASE_URL = String(process.env.MESSAGE_INBOX_PERF_BASE_URL ?? 'http://127.0.0.1:5500').replace(
  /\/+$/,
  '',
);

type Sample = {
  kind: 'first_insert' | 'duplicate';
  validationMs: number | null;
  dbIngestMs: number | null;
  totalWebhookMs: number;
  httpStatus: number;
  duplicate: boolean;
};

function summarize(samples: Sample[]) {
  const db = samples.map((s) => s.dbIngestMs).filter((v): v is number => v != null);
  const total = samples.map((s) => s.totalWebhookMs);
  const validation = samples.map((s) => s.validationMs).filter((v): v is number => v != null);
  return {
    count: samples.length,
    validationMs: {
      p50: percentile(validation, 50),
      p95: percentile(validation, 95),
      samples: validation,
    },
    dbIngestMs: {
      p50: percentile(db, 50),
      p95: percentile(db, 95),
      samples: db,
    },
    totalWebhookMs: {
      p50: percentile(total, 50),
      p95: percentile(total, 95),
      samples: total,
    },
  };
}

function makeBody(providerMessageId: string, runId: string, index: number) {
  return {
    provider: PROVIDER,
    providerMessageId,
    phone: '201000000099',
    messageType: 'text',
    text: 'perf-smoke',
    isGroup: false,
    receivedAt: new Date().toISOString(),
    rawPayload: {
      correlationId: `${runId}-corr-${index}`,
      adapterMs: index,
    },
  };
}

async function postWebhook(body: Record<string, unknown>): Promise<{
  httpStatus: number;
  duplicate: boolean;
  totalWebhookMs: number;
}> {
  const token = resolveWhatsAppInboxWebhookTokenForTests();
  const started = performance.now();

  if (process.env.MESSAGE_INBOX_PERF_USE_HTTP === '1') {
    const res = await fetch(`${BASE_URL}/api/internal/messaging/inbox/whatsapp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    });
    const json = (await res.json()) as { duplicate?: boolean };
    return {
      httpStatus: res.status,
      duplicate: Boolean(json.duplicate),
      totalWebhookMs: Math.round(performance.now() - started),
    };
  }

  const { POST } = await import('../src/app/api/internal/messaging/inbox/whatsapp/route');
  const res = await POST(
    new NextRequest(`${BASE_URL}/api/internal/messaging/inbox/whatsapp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    }),
  );
  const json = (await res.json()) as { duplicate?: boolean };
  return {
    httpStatus: res.status,
    duplicate: Boolean(json.duplicate),
    totalWebhookMs: Math.round(performance.now() - started),
  };
}

async function measureDbIngest(body: Record<string, unknown>): Promise<{
  validationMs: number;
  dbIngestMs: number;
}> {
  const { ingestIncomingMessage } = await import(
    '../src/modules/messaging/inbox/application/ingestIncomingMessage'
  );
  const { InboxWebhookPerfTimer } = await import(
    '../src/modules/messaging/inbox/observability/inboxWebhookPerf'
  );
  const timer = InboxWebhookPerfTimer.start();
  timer.markAuthCompleted();
  await ingestIncomingMessage(body as never, timer);
  const timing = timer.snapshot();
  return {
    validationMs: timing.validationMs,
    dbIngestMs: timing.dbIngestMs ?? 0,
  };
}

async function main() {
  const { getPool, closePool } = await import('../src/lib/db');
  const { countByProviderMessage } = await import(
    '../src/modules/messaging/inbox/infra/messageInboxRepository'
  );

  const pool = await getPool();
  const runId = `phase11-perf-${Date.now()}`;
  const duplicateId = `${runId}-dup`;

  const firstInsertSamples: Sample[] = [];
  const duplicateSamples: Sample[] = [];

  console.log('message-inbox webhook perf smoke');
  console.log(`  baseUrl: ${BASE_URL}`);
  console.log(`  transport: ${process.env.MESSAGE_INBOX_PERF_USE_HTTP === '1' ? 'http' : 'handler'}`);
  console.log(`  runId: ${runId}`);

  for (let i = 0; i < FIRST_INSERT_SAMPLES; i++) {
    const providerMessageId = `${runId}-db-${i}`;
    const body = makeBody(providerMessageId, runId, i);
    const dbTiming = await measureDbIngest(body);
    firstInsertSamples.push({
      kind: 'first_insert',
      validationMs: dbTiming.validationMs,
      dbIngestMs: dbTiming.dbIngestMs,
      totalWebhookMs: dbTiming.dbIngestMs + dbTiming.validationMs,
      httpStatus: 201,
      duplicate: false,
    });
  }

  for (let i = 0; i < FIRST_INSERT_SAMPLES; i++) {
    const providerMessageId = `${runId}-webhook-${i}`;
    const body = makeBody(providerMessageId, runId, i + 100);
    const webhook = await postWebhook(body);
    const sample = firstInsertSamples[i];
    if (!sample) throw new Error('missing first insert sample slot');
    sample.totalWebhookMs = webhook.totalWebhookMs;
    sample.httpStatus = webhook.httpStatus;
    sample.duplicate = webhook.duplicate;
    if (webhook.httpStatus !== 201 || webhook.duplicate) {
      throw new Error(`Expected webhook first insert 201 for ${providerMessageId}`);
    }
  }

  const seedBody = makeBody(duplicateId, runId, 999);
  const seed = await postWebhook(seedBody);
  if (seed.httpStatus !== 201 || seed.duplicate) {
    throw new Error('Failed to seed duplicate target row');
  }

  for (let i = 0; i < DUPLICATE_SAMPLES; i++) {
    const body = makeBody(duplicateId, runId, 1000 + i);
    const dbTiming = await measureDbIngest(body);
    const webhook = await postWebhook(body);
    duplicateSamples.push({
      kind: 'duplicate',
      validationMs: dbTiming.validationMs,
      dbIngestMs: dbTiming.dbIngestMs,
      totalWebhookMs: webhook.totalWebhookMs,
      httpStatus: webhook.httpStatus,
      duplicate: webhook.duplicate,
    });
    if (webhook.httpStatus !== 200 || !webhook.duplicate) {
      throw new Error(`Expected duplicate 200 on iteration ${i}`);
    }
  }

  const dupCount = await countByProviderMessage(PROVIDER, duplicateId);
  if (dupCount !== 1) {
    throw new Error(`Expected exactly one row for duplicate id, got ${dupCount}`);
  }

  await pool
    .request()
    .input('provider', PROVIDER)
    .input('prefix', `${runId}%`)
    .query(`
      DELETE FROM dbo.TblMessageInbox
      WHERE Provider = @provider
        AND ProviderMessageID LIKE @prefix
    `);

  console.log('\nfirst_insert timing summary');
  console.log(JSON.stringify(summarize(firstInsertSamples), null, 2));
  console.log('\nduplicate timing summary');
  console.log(JSON.stringify(summarize(duplicateSamples), null, 2));
  console.log('\nregression checks');
  console.log(
    JSON.stringify(
      {
        duplicateRowCount: dupCount,
        firstInsertHttpStatuses: [...new Set(firstInsertSamples.map((s) => s.httpStatus))],
        duplicateHttpStatuses: [...new Set(duplicateSamples.map((s) => s.httpStatus))],
      },
      null,
      2,
    ),
  );

  await closePool();
  console.log('\nPhase 1.1 inbox webhook perf smoke OK');
}

main().catch((e) => {
  const message = e instanceof Error ? e.message : String(e);
  console.error('perf smoke failed', message);
  process.exit(1);
});

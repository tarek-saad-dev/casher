#!/usr/bin/env npx tsx
/**
 * Phase 2.1 conversation processor benchmark (warm pool, real SQL path).
 *
 * Measures:
 * - raw SQL SELECT 1 baseline
 * - claimDbMs
 * - processorTotalMs (existing + new conversation)
 * - workerWakeMs (inbox persisted → claim finished)
 * - inboxPersistedToConversationReadyMs
 * - active worker vs idle wake-up scenarios
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

import {
  computePersistedToReadyMs,
  percentile,
  summarizeMs,
} from '../src/modules/messaging/conversation/observability/inboxProcessorPerf';
import {
  DEFAULT_INBOX_IDLE_MAX_MS,
  getInboxWorkerConfig,
} from '../src/modules/messaging/conversation/workerPolicy';

const EXISTING_SAMPLES = 30;
const NEW_SAMPLES = 10;
const PROVIDER = 'whatsapp-web';

type PerfSample = {
  scenario: string;
  ingestDbMs: number;
  claimDbMs: number;
  processorTotalMs: number;
  conversationDbMs: number;
  workerWakeMs: number | null;
  inboxPersistedToConversationReadyMs: number | null;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function ingest(
  ingestFn: (input: Record<string, unknown>) => Promise<{ inboxId: number; createdAt?: string }>,
  providerMessageId: string,
  phone: string,
): Promise<{ inboxId: number; ingestDbMs: number; persistedAt: string }> {
  const started = performance.now();
  const result = await ingestFn({
    provider: PROVIDER,
    providerMessageId,
    phone,
    messageType: 'text',
    text: 'perf-benchmark',
    isGroup: false,
    receivedAt: new Date().toISOString(),
    rawPayload: { correlationId: providerMessageId },
  });
  const ingestDbMs = Math.max(0, Math.round(performance.now() - started));
  const { getById } = await import('../src/modules/messaging/inbox/infra/messageInboxRepository');
  const row = await getById(result.inboxId);
  return {
    inboxId: result.inboxId,
    ingestDbMs,
    persistedAt: row?.createdAt ?? new Date().toISOString(),
  };
}

async function processClaimedInbox(input: {
  batchSize: number;
  staleProcessingMs: number;
  persistedAt: string;
}): Promise<{
  claimDbMs: number;
  processorTotalMs: number;
  conversationDbMs: number;
  workerWakeMs: number | null;
  inboxPersistedToConversationReadyMs: number | null;
}> {
  const { claimPendingBatch } = await import('../src/modules/messaging/inbox/infra/messageInboxRepository');
  const { processInboxMessage } = await import(
    '../src/modules/messaging/conversation/application/processInboxMessage'
  );

  const claimStarted = performance.now();
  const claimed = await claimPendingBatch({ batchSize: input.batchSize });
  const claimDbMs = Math.max(0, Math.round(performance.now() - claimStarted));
  const claimFinishedAt = new Date();
  const workerWakeMs = computePersistedToReadyMs(input.persistedAt, claimFinishedAt);

  if (claimed.length !== 1) {
    throw new Error(`Expected 1 claimed row, got ${claimed.length}`);
  }

  const processStarted = performance.now();
  await processInboxMessage(claimed[0]!);
  const processorTotalMs = Math.max(0, Math.round(performance.now() - processStarted));

  return {
    claimDbMs,
    processorTotalMs,
    conversationDbMs: processorTotalMs,
    workerWakeMs,
    inboxPersistedToConversationReadyMs: computePersistedToReadyMs(
      input.persistedAt,
      new Date(),
    ),
  };
}

async function drainPending(staleProcessingMs: number): Promise<void> {
  const { processInboxTick } = await import(
    '../src/modules/messaging/conversation/application/processInboxTick'
  );
  for (let i = 0; i < 5; i += 1) {
    const summary = await processInboxTick({ batchSize: 1, staleProcessingMs });
    if (summary.claimed === 0) break;
  }
}

async function main() {
  const runId = `phase21-perf-${Date.now()}`;
  const phoneExisting = `2017${String(runId).slice(-8)}`;
  const phoneNewPrefix = `2016${String(runId).slice(-8)}`;

  const { getPool, closePool } = await import('../src/lib/db');
  const { benchmarkDbLatency } = await import('../src/lib/db/benchmarkDbLatency');
  const { ingestIncomingMessage } = await import(
    '../src/modules/messaging/inbox/application/ingestIncomingMessage'
  );
  const { processInboxTick } = await import(
    '../src/modules/messaging/conversation/application/processInboxTick'
  );
  const { resolveExternalContactKey } = await import(
    '../src/modules/messaging/conversation/domain/externalContactKey'
  );
  const workerConfig = getInboxWorkerConfig();

  await getPool();
  const coldProcessStart = performance.now();
  await getPool();
  const coldProcessWarmMs = Math.max(0, Math.round(performance.now() - coldProcessStart));

  const rawSql = await benchmarkDbLatency({ warmSamples: 30 });

  const samples: PerfSample[] = [];

  const seed = await ingest(ingestIncomingMessage, `${runId}-seed`, phoneExisting);
  const seedTiming = await processClaimedInbox({
    batchSize: 1,
    staleProcessingMs: workerConfig.staleProcessingMs,
    persistedAt: seed.persistedAt,
  });
  samples.push({
    scenario: 'seed_existing_conversation',
    ingestDbMs: seed.ingestDbMs,
    ...seedTiming,
  });

  for (let i = 0; i < EXISTING_SAMPLES; i += 1) {
    const row = await ingest(ingestIncomingMessage, `${runId}-existing-${i}`, phoneExisting);
    const timing = await processClaimedInbox({
      batchSize: 1,
      staleProcessingMs: workerConfig.staleProcessingMs,
      persistedAt: row.persistedAt,
    });
    samples.push({ scenario: 'existing_conversation_active', ingestDbMs: row.ingestDbMs, ...timing });
  }

  for (let i = 0; i < NEW_SAMPLES; i += 1) {
    const phone = `${phoneNewPrefix}${String(i).padStart(2, '0')}`;
    const row = await ingest(ingestIncomingMessage, `${runId}-new-${i}`, phone);
    const timing = await processClaimedInbox({
      batchSize: 1,
      staleProcessingMs: workerConfig.staleProcessingMs,
      persistedAt: row.persistedAt,
    });
    samples.push({ scenario: 'new_conversation', ingestDbMs: row.ingestDbMs, ...timing });
  }

  const burstPhone = `2015${String(runId).slice(-8)}`;
  const burstPersisted: string[] = [];
  for (let i = 0; i < 5; i += 1) {
    const row = await ingest(ingestIncomingMessage, `${runId}-burst-one-${i}`, burstPhone);
    burstPersisted.push(row.persistedAt);
  }
  const burstOneStart = performance.now();
  await processInboxTick({ batchSize: 1, staleProcessingMs: workerConfig.staleProcessingMs });
  for (let i = 1; i < 5; i += 1) {
    await processInboxTick({ batchSize: 1, staleProcessingMs: workerConfig.staleProcessingMs });
  }
  const burstOneMs = Math.max(0, Math.round(performance.now() - burstOneStart));
  samples.push({
    scenario: 'burst_single_conversation',
    ingestDbMs: 0,
    claimDbMs: 0,
    processorTotalMs: burstOneMs,
    conversationDbMs: burstOneMs,
    workerWakeMs: computePersistedToReadyMs(burstPersisted[0]!, new Date()),
    inboxPersistedToConversationReadyMs: computePersistedToReadyMs(burstPersisted[0]!, new Date()),
  });

  const burstPhones = Array.from({ length: 5 }, (_, i) => `2014${String(runId).slice(-6)}${i}`);
  const multiPersisted: string[] = [];
  for (let i = 0; i < burstPhones.length; i += 1) {
    const row = await ingest(ingestIncomingMessage, `${runId}-burst-multi-${i}`, burstPhones[i]!);
    multiPersisted.push(row.persistedAt);
  }
  const multiStart = performance.now();
  for (let i = 0; i < burstPhones.length; i += 1) {
    await processInboxTick({ batchSize: 1, staleProcessingMs: workerConfig.staleProcessingMs });
  }
  const multiMs = Math.max(0, Math.round(performance.now() - multiStart));
  samples.push({
    scenario: 'burst_multi_conversation',
    ingestDbMs: 0,
    claimDbMs: 0,
    processorTotalMs: multiMs,
    conversationDbMs: multiMs,
    workerWakeMs: computePersistedToReadyMs(multiPersisted[0]!, new Date()),
    inboxPersistedToConversationReadyMs: computePersistedToReadyMs(multiPersisted[0]!, new Date()),
  });

  await drainPending(workerConfig.staleProcessingMs);
  const idleWakeMs = DEFAULT_INBOX_IDLE_MAX_MS + 50;
  await sleep(idleWakeMs);
  const idleRow = await ingest(ingestIncomingMessage, `${runId}-idle-wake`, phoneExisting);
  const idleTiming = await processClaimedInbox({
    batchSize: 1,
    staleProcessingMs: workerConfig.staleProcessingMs,
    persistedAt: idleRow.persistedAt,
  });
  samples.push({
    scenario: 'idle_worker_wake_simulated',
    ingestDbMs: idleRow.ingestDbMs,
    ...idleTiming,
  });

  const existing = samples.filter((s) => s.scenario === 'existing_conversation_active');
  const fresh = samples.filter((s) => s.scenario === 'new_conversation');
  const activePickup = existing.map((s) => s.workerWakeMs).filter((v): v is number => v != null);
  const e2eExisting = existing
    .map((s) => s.inboxPersistedToConversationReadyMs)
    .filter((v): v is number => v != null);

  const report = {
    runId,
    coldProcessWarmMs,
    rawSql,
    connection: rawSql.connection,
    targets: {
      existingProcessorP50Max: 250,
      existingProcessorP95Max: 500,
      newProcessorP50Max: 400,
      newProcessorP95Max: 700,
      activePickupP50Max: 50,
      activePickupP95Max: 150,
      existingE2eP50Ideal: 400,
      existingE2eP95Ideal: 700,
    },
    existingConversation: {
      processorTotalMs: summarizeMs(existing.map((s) => s.processorTotalMs)),
      claimDbMs: summarizeMs(existing.map((s) => s.claimDbMs)),
      conversationDbMs: summarizeMs(existing.map((s) => s.conversationDbMs)),
      workerWakeMs: summarizeMs(activePickup),
      inboxPersistedToConversationReadyMs: summarizeMs(e2eExisting),
      ingestDbMs: summarizeMs(existing.map((s) => s.ingestDbMs)),
    },
    newConversation: {
      processorTotalMs: summarizeMs(fresh.map((s) => s.processorTotalMs)),
      claimDbMs: summarizeMs(fresh.map((s) => s.claimDbMs)),
      conversationDbMs: summarizeMs(fresh.map((s) => s.conversationDbMs)),
      workerWakeMs: summarizeMs(
        fresh.map((s) => s.workerWakeMs).filter((v): v is number => v != null),
      ),
      inboxPersistedToConversationReadyMs: summarizeMs(
        fresh.map((s) => s.inboxPersistedToConversationReadyMs).filter((v): v is number => v != null),
      ),
      ingestDbMs: summarizeMs(fresh.map((s) => s.ingestDbMs)),
    },
    burst: {
      singleConversationMs: burstOneMs,
      multiConversationMs: multiMs,
    },
    idleWorkerWake: idleTiming,
    phase1WebhookEstimateMs: {
      note: 'Run npm run messaging:verify-inbox-perf for Phase 1 webhook dbIngestMs p50/p95',
      typicalDbIngestP50: 382,
      typicalDbIngestP95: null,
    },
    endToEndEstimate: {
      whatsappToConversationReadyExistingP50:
        (percentile(e2eExisting, 50) ?? 0)
        + (percentile(existing.map((s) => s.ingestDbMs), 50) ?? 0),
      whatsappToConversationReadyExistingP95:
        (percentile(e2eExisting, 95) ?? 0)
        + (percentile(existing.map((s) => s.ingestDbMs), 95) ?? 0),
    },
    sqlRoundTripsAfterOptimization: {
      existingConversation: ['claim (1)', 'atomic processInboxMessage (1)'],
      newConversation: ['claim (1)', 'atomic processInboxMessage with inline client lookup (1)'],
    },
    sqlRoundTripsBeforeOptimization: {
      existingConversation: [
        'pre-tx getBotMessageByInboxId',
        'pre-tx getConversationByIdentity',
        'tx begin',
        'in-tx getBotMessageByInboxId',
        'in-tx getConversationByIdentity',
        'in-tx insertInboundBotMessage',
        'in-tx touchConversationLastMessage',
        'in-tx markCompleted',
        'tx commit',
      ],
      newConversation: ['+ pre-tx lookupClientIdByPhone (~235ms)'],
    },
  };

  const pool = await getPool();
  const keys = [
    resolveExternalContactKey({ phone: phoneExisting, rawPayload: null }),
    resolveExternalContactKey({ phone: burstPhone, rawPayload: null }),
    ...burstPhones.map((p) => resolveExternalContactKey({ phone: p, rawPayload: null })),
    ...Array.from({ length: NEW_SAMPLES }, (_, i) =>
      resolveExternalContactKey({
        phone: `${phoneNewPrefix}${String(i).padStart(2, '0')}`,
        rawPayload: null,
      })),
  ];

  await pool.request().input('prefix', `${runId}%`).query(`
    DELETE m
    FROM dbo.TblBotMessage m
    INNER JOIN dbo.TblMessageInbox i ON i.ID = m.InboxID
    WHERE i.ProviderMessageID LIKE @prefix;

    DELETE FROM dbo.TblMessageInbox WHERE ProviderMessageID LIKE @prefix;
  `);

  for (const key of keys) {
    await pool
      .request()
      .input('key', key)
      .query('DELETE FROM dbo.TblBotConversation WHERE ExternalContactKey = @key');
  }

  console.log('phase2.1 conversation perf benchmark');
  console.log(JSON.stringify(report, null, 2));

  await closePool();
  console.log('Phase 2.1 conversation perf benchmark OK');
}

main().catch((err) => {
  console.error('conversation perf benchmark failed', err instanceof Error ? err.message : String(err));
  process.exit(1);
});

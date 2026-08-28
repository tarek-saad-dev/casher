#!/usr/bin/env npx tsx
/**
 * Phase 2.2 — run SQL + messaging benchmarks from the current runtime.
 * Intended for production VPS: run as user `casher` in /home/casher/app.
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

async function main() {
  const { diagnoseDbTopology } = await import('../src/lib/db/diagnoseDbTopology');
  const { benchmarkDbLatency } = await import('../src/lib/db/benchmarkDbLatency');
  const { buildCandidateDbPathsFromEnv, benchmarkDbPath } = await import(
    '../src/lib/db/benchmarkDbPath'
  );
  const { closePool } = await import('../src/lib/db');

  const topology = diagnoseDbTopology();
  const pathCandidates = buildCandidateDbPathsFromEnv();
  const pathResults = [];
  for (const candidate of pathCandidates) {
    pathResults.push(await benchmarkDbPath({ ...candidate, warmSamples: 40 }));
  }

  const singletonSql = await benchmarkDbLatency({ warmSamples: 40 });

  let conversationPerf: unknown = null;
  let inboxPerf: unknown = null;
  try {
    const { ingestIncomingMessage } = await import(
      '../src/modules/messaging/inbox/application/ingestIncomingMessage'
    );
    const { claimPendingBatch } = await import(
      '../src/modules/messaging/inbox/infra/messageInboxRepository'
    );
    const { processInboxMessage } = await import(
      '../src/modules/messaging/conversation/application/processInboxMessage'
    );
    const { computePersistedToReadyMs, summarizeMs } = await import(
      '../src/modules/messaging/conversation/observability/inboxProcessorPerf'
    );

    const runId = `phase22-${Date.now()}`;
    const phone = `2013${String(runId).slice(-8)}`;
    const existingSamples: number[] = [];
    const e2eSamples: number[] = [];
    const claimSamples: number[] = [];
    const pickupSamples: number[] = [];

    const seedPersisted = await ingestIncomingMessage({
      provider: 'whatsapp-web',
      providerMessageId: `${runId}-seed`,
      phone,
      messageType: 'text',
      text: 'phase22-seed',
      isGroup: false,
      receivedAt: new Date().toISOString(),
      rawPayload: { correlationId: `${runId}-seed` },
    });
    const { getById } = await import('../src/modules/messaging/inbox/infra/messageInboxRepository');
    const seedRow = await getById(seedPersisted.inboxId);
    const claimedSeed = await claimPendingBatch({ batchSize: 1 });
    if (claimedSeed[0]) await processInboxMessage(claimedSeed[0]);

    for (let i = 0; i < 30; i += 1) {
      const ingestStarted = performance.now();
      const ingested = await ingestIncomingMessage({
        provider: 'whatsapp-web',
        providerMessageId: `${runId}-existing-${i}`,
        phone,
        messageType: 'text',
        text: 'phase22-existing',
        isGroup: false,
        receivedAt: new Date().toISOString(),
        rawPayload: { correlationId: `${runId}-existing-${i}` },
      });
      const row = await getById(ingested.inboxId);
      const persistedAt = row?.createdAt ?? new Date().toISOString();
      const claimStarted = performance.now();
      const claimed = await claimPendingBatch({ batchSize: 1 });
      const claimDbMs = Math.max(0, Math.round(performance.now() - claimStarted));
      claimSamples.push(claimDbMs);
      const claimFinishedAt = new Date();
      pickupSamples.push(computePersistedToReadyMs(persistedAt, claimFinishedAt) ?? 0);
      const processStarted = performance.now();
      if (claimed[0]) await processInboxMessage(claimed[0]);
      const processorMs = Math.max(0, Math.round(performance.now() - processStarted));
      existingSamples.push(processorMs);
      e2eSamples.push(
        computePersistedToReadyMs(persistedAt, new Date()) ??
          Math.round(performance.now() - ingestStarted),
      );
    }

    conversationPerf = {
      existingConversation: {
        processorTotalMs: summarizeMs(existingSamples),
        claimDbMs: summarizeMs(claimSamples),
        workerWakeMs: summarizeMs(pickupSamples),
        inboxPersistedToConversationReadyMs: summarizeMs(e2eSamples),
      },
    };

    const pool = await (await import('../src/lib/db')).getPool();
    await pool.request().input('prefix', `${runId}%`).query(`
      DELETE m FROM dbo.TblBotMessage m
      INNER JOIN dbo.TblMessageInbox i ON i.ID = m.InboxID
      WHERE i.ProviderMessageID LIKE @prefix;
      DELETE c FROM dbo.TblBotConversation c
      WHERE EXISTS (
        SELECT 1 FROM dbo.TblBotMessage m
        INNER JOIN dbo.TblMessageInbox i ON i.ID = m.InboxID
        WHERE m.ConversationID = c.ConversationID AND i.ProviderMessageID LIKE @prefix
      );
      DELETE FROM dbo.TblMessageInbox WHERE ProviderMessageID LIKE @prefix;
    `);
  } catch (err) {
    conversationPerf = {
      error: err instanceof Error ? err.message : String(err),
    };
  }

  try {
    const { ingestIncomingMessage } = await import(
      '../src/modules/messaging/inbox/application/ingestIncomingMessage'
    );
    const samples: number[] = [];
    const runId = `phase22-inbox-${Date.now()}`;
    for (let i = 0; i < 12; i += 1) {
      const started = performance.now();
      await ingestIncomingMessage({
        provider: 'whatsapp-web',
        providerMessageId: `${runId}-${i}`,
        phone: '201000000099',
        messageType: 'text',
        text: 'phase22-ingest',
        isGroup: false,
        receivedAt: new Date().toISOString(),
        rawPayload: { correlationId: `${runId}-${i}` },
      });
      samples.push(Math.max(0, Math.round(performance.now() - started)));
    }
    const { summarizeMs } = await import(
      '../src/modules/messaging/conversation/observability/inboxProcessorPerf'
    );
    inboxPerf = { ingestPathMs: summarizeMs(samples) };
    const pool = await (await import('../src/lib/db')).getPool();
    await pool.request().input('prefix', `${runId}%`).query(
      'DELETE FROM dbo.TblMessageInbox WHERE ProviderMessageID LIKE @prefix',
    );
  } catch (err) {
    inboxPerf = { error: err instanceof Error ? err.message : String(err) };
  }

  const reachablePaths = pathResults.filter((p) => p.reachable);
  const fastestPath = [...reachablePaths].sort(
    (a, b) => (a.warmSelect1.p50 ?? 1e9) - (b.warmSelect1.p50 ?? 1e9),
  )[0];

  const report = {
    phase: '2.2',
    topology,
    singletonPoolSql: singletonSql,
    pathComparison: pathResults,
    fastestReachablePath: fastestPath
      ? {
          label: fastestPath.label,
          path: `${fastestPath.server}:${fastestPath.port}`,
          warmSelect1P50: fastestPath.warmSelect1.p50,
          warmSelect1P95: fastestPath.warmSelect1.p95,
        }
      : null,
    messaging: {
      conversation: conversationPerf,
      inboxIngest: inboxPerf,
    },
    decisionGate: {
      warmSelect1P50: singletonSql.warmSelect1.p50,
      warmSelect1P95: singletonSql.warmSelect1.p95,
    },
  };

  console.log('[messaging-phase22-benchmarks]', JSON.stringify(report, null, 2));
  await closePool();
}

main().catch(async (err) => {
  console.error('[messaging-phase22-benchmarks] failed', err instanceof Error ? err.message : String(err));
  try {
    const { closePool } = await import('../src/lib/db');
    await closePool();
  } catch {
    /* ignore */
  }
  process.exit(1);
});

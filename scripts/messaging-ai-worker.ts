#!/usr/bin/env npx tsx
/**
 * Persistent AI conversation worker (Phase 3).
 *
 *   npm run messaging:ai-worker
 *   npx tsx scripts/messaging-ai-worker.ts --once
 */
import os from 'os';
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

function workerId(): string {
  return `${os.hostname()}:${process.pid}`.slice(0, 100);
}

async function sleep(ms: number): Promise<void> {
  if (ms <= 0) return;
  await new Promise<void>((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const { processAiTick } = await import(
    '../src/modules/messaging/ai/application/processAiTick'
  );
  const { getAiWorkerConfig, nextIdleDelayMs } = await import(
    '../src/modules/messaging/ai/workerPolicy'
  );
  const { getPool, closePool } = await import('../src/lib/db');

  const once = process.argv.includes('--once');
  const config = getAiWorkerConfig();
  if (!config.enabled) {
    console.log(
      '[messaging-ai-worker] Gemini is not configured (GEMINI_API_KEY missing); worker idle until configured',
    );
    if (once) return;
    await new Promise<void>(() => {
      /* block until SIGTERM; avoids systemd restart loop when key is absent */
    });
    return;
  }
  const id = workerId();
  let stopping = false;
  let inTick = false;
  let consecutiveIdleTicks = 0;
  let lastWorkAt = Date.now();

  const stop = () => {
    if (stopping) return;
    stopping = true;
    console.log(`[messaging-ai-worker] shutdown requested worker=${id}`);
  };

  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);

  await getPool();

  console.log('[messaging-ai-worker] started', {
    worker: id,
    enabled: config.enabled,
    model: config.geminiModel,
    idleMinMs: config.idleMinMs,
    idleMaxMs: config.idleMaxMs,
    batchSize: config.batchSize,
    burstDebounceMs: config.burstDebounceMs,
    once,
  });

  while (!stopping) {
    inTick = true;
    try {
      const summary = await processAiTick({
        batchSize: config.batchSize,
        staleProcessingMs: config.staleProcessingMs,
      });

      const didWork =
        summary.claimed > 0 ||
        summary.recoveredRequeued > 0 ||
        summary.recoveredFailed > 0;

      if (didWork) {
        consecutiveIdleTicks = 0;
        lastWorkAt = Date.now();
        console.log('[messaging-ai-worker] tick', summary);
      } else {
        consecutiveIdleTicks += 1;
      }

      if (once || stopping) break;

      const recentlyActive = Date.now() - lastWorkAt < config.recentActiveMs;
      const idleDelay = nextIdleDelayMs(
        config.idleMinMs,
        config.idleMaxMs,
        consecutiveIdleTicks,
        recentlyActive,
      );
      await sleep(idleDelay);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('[messaging-ai-worker] tick failed', message);
      consecutiveIdleTicks += 1;
      if (!stopping) {
        await sleep(
          nextIdleDelayMs(
            config.idleMinMs,
            config.idleMaxMs,
            consecutiveIdleTicks,
            false,
          ),
        );
      }
    } finally {
      inTick = false;
    }
  }

  while (inTick) {
    await sleep(25);
  }

  await closePool();
  console.log('[messaging-ai-worker] stopped', id);
}

main().catch((err) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error('[messaging-ai-worker] fatal', message);
  process.exit(1);
});

#!/usr/bin/env npx tsx
/**
 * Independent messaging outbox worker.
 * Reads dbo.TblMessageOutbox and sends stored snapshots through the generic Gateway.
 *
 *   npm run messaging:worker
 *   npx tsx scripts/messaging-outbox-worker.ts --once
 *
 * Does not run inside Next.js. Does not change Sale / Quick Message callers.
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

async function main() {
  const { processOutboxTick } = await import(
    '../src/modules/messaging/application/processOutboxTick'
  );
  const { getOutboxWorkerConfig } = await import('../src/modules/messaging/outbox/workerPolicy');
  const { closePool } = await import('../src/lib/db');

  const once = process.argv.includes('--once');
  const config = getOutboxWorkerConfig();
  const id = workerId();
  let stopping = false;
  let inTick = false;

  const stop = () => {
    if (stopping) return;
    stopping = true;
    console.log(`[messaging-outbox-worker] shutdown requested worker=${id}`);
  };

  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);

  console.log('[messaging-outbox-worker] started', {
    worker: id,
    pollMs: config.pollMs,
    batchSize: config.batchSize,
    lockTtlMs: config.lockTtlMs,
    once,
  });

  while (!stopping) {
    inTick = true;
    try {
      const summary = await processOutboxTick({
        workerId: id,
        batchSize: config.batchSize,
        lockTtlMs: config.lockTtlMs,
      });
      if (summary.claimed > 0 || summary.recovered > 0) {
        console.log('[messaging-outbox-worker] tick', summary);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('[messaging-outbox-worker] tick failed', message);
    } finally {
      inTick = false;
    }

    if (once || stopping) break;
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        clearInterval(watch);
        resolve();
      }, config.pollMs);
      const watch = setInterval(() => {
        if (!stopping) return;
        clearTimeout(timer);
        clearInterval(watch);
        resolve();
      }, 50);
    });
  }

  while (inTick) {
    await new Promise((resolve) => setTimeout(resolve, 25));
  }

  await closePool();
  console.log('[messaging-outbox-worker] stopped', id);
}

main().catch((err) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error('[messaging-outbox-worker] fatal', message);
  process.exit(1);
});

#!/usr/bin/env npx tsx
/**
 * Phase 2.1 raw SQL latency benchmark (same pool as production code).
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
  const { benchmarkDbLatency } = await import('../src/lib/db/benchmarkDbLatency');
  const { closePool } = await import('../src/lib/db');

  const result = await benchmarkDbLatency({ warmSamples: 40 });
  console.log('[benchmark-sql-latency]', JSON.stringify(result, null, 2));
  await closePool();
}

main().catch((err) => {
  console.error('[benchmark-sql-latency] failed', err instanceof Error ? err.message : String(err));
  process.exit(1);
});

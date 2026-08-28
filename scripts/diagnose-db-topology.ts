#!/usr/bin/env npx tsx
/**
 * Phase 2.2 — report effective DB topology without secrets.
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
  const report = diagnoseDbTopology();
  console.log('[diagnose-db-topology]', JSON.stringify(report, null, 2));
}

main().catch((err) => {
  console.error('[diagnose-db-topology] failed', err instanceof Error ? err.message : String(err));
  process.exit(1);
});

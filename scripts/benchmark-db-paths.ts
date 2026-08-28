#!/usr/bin/env npx tsx
/**
 * Phase 2.2 — compare safe DB connection paths from this runtime.
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
  const { buildCandidateDbPathsFromEnv, benchmarkDbPath } = await import(
    '../src/lib/db/benchmarkDbPath'
  );
  const { diagnoseDbTopology } = await import('../src/lib/db/diagnoseDbTopology');

  const topology = diagnoseDbTopology();
  const candidates = buildCandidateDbPathsFromEnv();
  const results = [];
  for (const candidate of candidates) {
    results.push(await benchmarkDbPath({ ...candidate, warmSamples: 40 }));
  }

  const reachable = results.filter((r) => r.reachable);
  const fastest =
    reachable.length > 0
      ? [...reachable].sort(
          (a, b) => (a.warmSelect1.p50 ?? Number.MAX_SAFE_INTEGER) - (b.warmSelect1.p50 ?? Number.MAX_SAFE_INTEGER),
        )[0]
      : null;

  console.log(
    '[benchmark-db-paths]',
    JSON.stringify(
      {
        topology: {
          pathKind: topology.effectiveConfig.pathKind,
          configured: `${topology.effectiveConfig.server}:${topology.effectiveConfig.port}`,
          database: topology.effectiveConfig.database,
          likelyProduction: topology.runtime.likelyProduction,
        },
        candidates: results.map((r) => ({
          label: r.label,
          path: `${r.server}:${r.port}`,
          reachable: r.reachable,
          error: r.error,
          coldConnectMs: r.coldConnectMs,
          coldSelect1Ms: r.coldSelect1Ms,
          warmSelect1P50: r.warmSelect1.p50,
          warmSelect1P95: r.warmSelect1.p95,
          warmTransactionP50: r.warmTransaction.p50,
          warmTransactionP95: r.warmTransaction.p95,
        })),
        recommendation: fastest
          ? {
              fastestPath: `${fastest.server}:${fastest.port}`,
              label: fastest.label,
              warmSelect1P50: fastest.warmSelect1.p50,
              warmSelect1P95: fastest.warmSelect1.p95,
            }
          : null,
      },
      null,
      2,
    ),
  );
}

main().catch((err) => {
  console.error('[benchmark-db-paths] failed', err instanceof Error ? err.message : String(err));
  process.exit(1);
});

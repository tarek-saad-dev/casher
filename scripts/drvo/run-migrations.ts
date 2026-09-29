#!/usr/bin/env npx tsx
/**
 * Central DRVO migration runner — production deploy and staging.
 * Production requires --allow-production and DB_NAME() = last132.
 */
import path from 'path';
import Module from 'module';
import dotenv from 'dotenv';

dotenv.config({ path: path.join(__dirname, '..', '..', '.env') });
dotenv.config({ path: path.join(__dirname, '..', '..', '.env.local'), override: true });

const moduleWithLoad = Module as unknown as {
  _load: (request: string, parent: unknown, isMain: boolean) => unknown;
};
const originalModuleLoad = moduleWithLoad._load;
moduleWithLoad._load = function patchedLoad(request: string, ...rest: unknown[]) {
  if (request === 'server-only') return {};
  return originalModuleLoad.call(moduleWithLoad, request, ...rest);
};

function parseExpectedDatabase(argv: string[]): string | undefined {
  for (const arg of argv) {
    if (arg.startsWith('--expected-database=')) {
      return arg.slice('--expected-database='.length).trim();
    }
  }
  return undefined;
}

async function main() {
  const allowProduction = process.argv.includes('--allow-production');
  const expectedDatabase = parseExpectedDatabase(process.argv.slice(2));
  const appCommitSha =
    process.env.DEPLOY_COMMIT_SHA ??
    process.env.GITHUB_SHA ??
    process.env.VERCEL_GIT_COMMIT_SHA ??
    null;

  const { getPool, closePool } = await import('../../src/lib/db');
  const { runDrvoMigrations } = await import('./runner');

  try {
    const pool = await getPool();
    const report = await runDrvoMigrations(pool, {
      allowProduction,
      expectedDatabase,
      appCommitSha,
    });
    console.log(JSON.stringify(report, null, 2));
    if (!report.ok) {
      process.exit(1);
    }
    console.log('PASS: DRVO migrations complete.');
  } finally {
    await closePool();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});

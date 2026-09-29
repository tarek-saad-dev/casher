#!/usr/bin/env npx tsx
/**
 * Production-safe DRVO-004 booking read/preview smoke.
 * Delegates to central drvo:verify — no mutations.
 */
import { spawnSync } from 'child_process';
import path from 'path';

const verifyScript = path.join(__dirname, 'drvo', 'verify-cli.ts');
const args = ['--import', 'tsx', verifyScript, ...process.argv.slice(2)];
if (!args.includes('--allow-production') && process.argv.includes('--production')) {
  args.push('--allow-production');
}
const result = spawnSync(process.execPath, args, { stdio: 'inherit', env: process.env });
if (result.status === 0) {
  console.log(
    'DRVO-004 smoke: platform readiness OK. Booking path follows source-controlled moduleManifest.rollout (legacy until a dedicated activation PR).',
  );
}
process.exit(result.status ?? 1);

#!/usr/bin/env npx tsx
/** @deprecated Use npm run drvo:verify -- --allow-production */
import { spawnSync } from 'child_process';
import path from 'path';

const script = path.join(__dirname, 'drvo', 'verify-cli.ts');
const result = spawnSync(
  process.execPath,
  ['--import', 'tsx', script, '--allow-production', ...process.argv.slice(2)],
  { stdio: 'inherit', env: process.env },
);
process.exit(result.status ?? 1);

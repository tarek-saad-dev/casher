#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Remaining financial + payroll issues audit — DB probe (READ-ONLY SELECT).
 * Usage: node scripts/audit-remaining-financial-payroll-issues.js --month=2026-07
 */
const { spawnSync } = require('child_process');
const path = require('path');
const result = spawnSync(
  'npx',
  ['tsx', path.join(__dirname, 'audit-remaining-financial-payroll-issues-runner.ts'), ...process.argv.slice(2)],
  { stdio: 'inherit', cwd: path.join(__dirname, '..'), shell: true },
);
process.exit(result.status ?? 1);

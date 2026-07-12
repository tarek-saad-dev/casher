#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Phase 4B.1 — Daily Payroll HR model diagnostic (READ-ONLY).
 *
 * Usage:
 *   node scripts/audit-daily-payroll-hr-model.js --date=YYYY-MM-DD
 *   node scripts/audit-daily-payroll-hr-model.js --date=YYYY-MM-DD --empId=5
 *
 * Does NOT generate payroll, write ledger entries, or modify TblCashMove.
 */

const { spawnSync } = require('child_process');
const path = require('path');

const args = process.argv.slice(2);
const runner = path.join(__dirname, 'audit-daily-payroll-hr-model-runner.ts');
const cwd = path.join(__dirname, '..');

const result = spawnSync('npx', ['tsx', runner, ...args], {
  stdio: 'inherit',
  cwd,
  shell: true,
});

process.exit(result.status ?? 1);

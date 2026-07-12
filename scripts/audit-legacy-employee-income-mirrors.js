#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Phase 5C — Legacy employee income mirror review (READ-ONLY).
 *
 * Usage:
 *   node scripts/audit-legacy-employee-income-mirrors.js --month=2026-07
 *   node scripts/audit-legacy-employee-income-mirrors.js --month=2026-07 --empId=7
 */

const { spawnSync } = require('child_process');
const path = require('path');

const args = process.argv.slice(2);
const runner = path.join(__dirname, 'audit-legacy-employee-income-mirrors-runner.ts');
const cwd = path.join(__dirname, '..');

const result = spawnSync('npx', ['tsx', runner, ...args], {
  stdio: 'inherit',
  cwd,
  shell: true,
});

process.exit(result.status ?? 1);

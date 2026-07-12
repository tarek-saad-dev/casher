#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Phase 5A — Financial report classification audit (READ-ONLY).
 *
 * Usage:
 *   node scripts/audit-financial-report-classification.js --month=2026-07
 */

const { spawnSync } = require('child_process');
const path = require('path');

const args = process.argv.slice(2);
const runner = path.join(__dirname, 'audit-financial-report-classification-runner.ts');
const cwd = path.join(__dirname, '..');

const result = spawnSync('npx', ['tsx', runner, ...args], {
  stdio: 'inherit',
  cwd,
  shell: true,
});

process.exit(result.status ?? 1);

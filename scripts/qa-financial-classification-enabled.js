#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Phase 5B QA — Financial report classification enabled (READ-ONLY).
 *
 * Usage:
 *   node scripts/qa-financial-classification-enabled.js --month=2026-07
 *
 * Guards:
 *   - SELECT only
 *   - No INSERT / UPDATE / DELETE
 *   - No TblCashMove / TblEmpLedgerEntry writes
 */

const { spawnSync } = require('child_process');
const path = require('path');

const args = process.argv.slice(2);
const runner = path.join(__dirname, 'qa-financial-classification-enabled-runner.ts');
const cwd = path.join(__dirname, '..');

const result = spawnSync('npx', ['tsx', runner, ...args], {
  stdio: 'inherit',
  cwd,
  shell: true,
});

process.exit(result.status ?? 1);

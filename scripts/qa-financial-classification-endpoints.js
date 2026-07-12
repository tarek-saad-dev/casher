#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Phase 5B.3 — Authenticated (optional) financial classification endpoint QA.
 *
 * Usage:
 *   AUTH_COOKIE="pos_session=..." node scripts/qa-financial-classification-endpoints.js --year=2026 --month=7
 *   node scripts/qa-financial-classification-endpoints.js --year=2026 --month=7
 *
 * Without AUTH_COOKIE: SKIPPED (not FAIL). See docs/financial-classification-endpoint-qa.md
 */

const { spawnSync } = require('child_process');
const path = require('path');

const args = process.argv.slice(2);
const runner = path.join(__dirname, 'qa-financial-classification-endpoints-runner.ts');
const cwd = path.join(__dirname, '..');

const result = spawnSync('npx', ['tsx', runner, ...args], {
  stdio: 'inherit',
  cwd,
  shell: true,
  env: process.env,
});

process.exit(result.status ?? 1);

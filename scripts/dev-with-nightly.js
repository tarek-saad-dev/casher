#!/usr/bin/env node
/**
 * Dev launcher: Next.js (port 5500) + nightly-close watcher (02:40 Africa/Cairo).
 * Exit either child → stop both.
 */
const { spawn } = require('child_process');
const path = require('path');

const root = path.join(__dirname, '..');
const children = [];
let shuttingDown = false;

function start(command, args, label) {
  const child = spawn(command, args, {
    cwd: root,
    stdio: 'inherit',
    // Windows cannot spawn .cmd without a shell; spaces in cwd break `shell: true`.
    // Always spawn node + JS entry so paths with spaces work.
    // Avoid interactive "Ok to proceed?" from npx when a package is missing.
    env: { ...process.env, npm_config_yes: 'true' },
  });
  child.on('exit', (code, signal) => {
    if (shuttingDown) return;
    console.log(`[dev] ${label} exited (code=${code}, signal=${signal}) — shutting down`);
    shutdown(code ?? 1);
  });
  children.push(child);
  return child;
}

function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) {
    if (!child.killed) {
      try {
        child.kill('SIGTERM');
      } catch {
        /* ignore */
      }
    }
  }
  // Force-exit shortly if children hang
  setTimeout(() => process.exit(code), 1500).unref?.();
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

console.log('[dev] starting Next.js (webpack) on :5500 + nightly-close watcher (02:40 Cairo)');

const nextBin = require.resolve('next/dist/bin/next');
// Webpack dev — Turbopack mis-resolves /api/public/booking/* when [code] is a sibling route.
start(process.execPath, [nextBin, 'dev', '--webpack', '--port', '5500'], 'next');

let tsxCli;
try {
  tsxCli = require.resolve('tsx/dist/cli.mjs');
} catch {
  tsxCli = null;
}
if (tsxCli) {
  start(process.execPath, [tsxCli, 'scripts/run-nightly-close.ts', '--watch'], 'nightly-close');
} else {
  console.warn('[dev] tsx not found in node_modules — nightly-close watcher skipped');
}

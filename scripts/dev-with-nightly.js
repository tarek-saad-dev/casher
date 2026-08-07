#!/usr/bin/env node
/**
 * Dev launcher: Next.js (port 5500) + nightly-close watcher (02:40 Africa/Cairo).
 * Exit either child → stop both.
 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const children = [];
let shuttingDown = false;

function localBin(name) {
  const bin = path.join(
    root,
    'node_modules',
    '.bin',
    process.platform === 'win32' ? `${name}.cmd` : name,
  );
  return fs.existsSync(bin) ? bin : null;
}

function start(command, args, label) {
  const child = spawn(command, args, {
    cwd: root,
    stdio: 'inherit',
    shell: true,
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

console.log('[dev] starting Next.js on :5500 + nightly-close watcher (02:40 Cairo)');

const nextBin = localBin('next');
if (nextBin) {
  start(nextBin, ['dev', '--port', '5500'], 'next');
} else {
  start('npx', ['--yes', 'next', 'dev', '--port', '5500'], 'next');
}

const tsxBin = localBin('tsx');
if (tsxBin) {
  start(tsxBin, ['scripts/run-nightly-close.ts', '--watch'], 'nightly-close');
} else {
  console.warn(
    '[dev] tsx not found in node_modules — using npx --yes (run: npm i -D tsx)',
  );
  start('npx', ['--yes', 'tsx', 'scripts/run-nightly-close.ts', '--watch'], 'nightly-close');
}

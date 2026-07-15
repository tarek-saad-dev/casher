#!/usr/bin/env node
/**
 * Dev launcher: Next.js (port 5500) + nightly-close watcher (01:00 Africa/Cairo).
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
    shell: true,
    env: process.env,
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

console.log('[dev] starting Next.js on :5500 + nightly-close watcher (01:00 Cairo)');
start('npx', ['next', 'dev', '--port', '5500'], 'next');
start('npx', ['tsx', 'scripts/run-nightly-close.ts', '--watch'], 'nightly-close');

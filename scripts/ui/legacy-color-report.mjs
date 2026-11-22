#!/usr/bin/env node
// Legacy colour ratchet.
//   node scripts/ui/legacy-color-report.mjs            → print summary
//   node scripts/ui/legacy-color-report.mjs --update   → rewrite baseline
//   node scripts/ui/legacy-color-report.mjs --check    → exit 1 if any file grew
// The baseline only ever goes down: migrate a file to DRVO tokens, then --update.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { listSourceFiles, scanLegacyClasses } from './legacy-classes.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const baselinePath = path.join(repo, 'scripts', 'ui', 'legacy-color-baseline.json');

export function countLegacy(root = path.join(repo, 'src')) {
  const counts = {};
  for (const file of listSourceFiles(root)) {
    const n = scanLegacyClasses(fs.readFileSync(file, 'utf8')).length;
    if (n > 0) counts[path.relative(repo, file).split(path.sep).join('/')] = n;
  }
  return counts;
}

export function compareToBaseline(counts, baseline) {
  const regressions = [];
  for (const [file, n] of Object.entries(counts)) {
    const allowed = baseline[file] ?? 0;
    if (n > allowed) regressions.push({ file, allowed, actual: n });
  }
  return regressions;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const counts = countLegacy();
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const mode = process.argv[2];
  if (mode === '--update') {
    const sorted = Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)));
    fs.writeFileSync(baselinePath, JSON.stringify(sorted, null, 2) + '\n');
    console.log(`baseline updated: ${total} legacy colour classes in ${Object.keys(counts).length} files`);
  } else if (mode === '--check') {
    const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
    const regressions = compareToBaseline(counts, baseline);
    const baseTotal = Object.values(baseline).reduce((a, b) => a + b, 0);
    if (regressions.length) {
      console.error('Legacy colour classes increased (use DRVO tokens instead):');
      for (const r of regressions) console.error(`  ${r.file}: ${r.allowed} → ${r.actual}`);
      process.exit(1);
    }
    console.log(`ok: ${total} legacy colour classes (baseline ${baseTotal}).`);
    if (total < baseTotal) console.log('Tip: run with --update to lock in the reduction.');
  } else {
    const top = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 25);
    console.log(`${total} legacy colour classes in ${Object.keys(counts).length} files`);
    for (const [f, n] of top) console.log(String(n).padStart(6), f);
  }
}

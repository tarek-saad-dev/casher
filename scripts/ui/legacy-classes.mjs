// Shared scanner for legacy (dark-era, hard-coded) Tailwind colour classes.
// Used by:
//   • generate-legacy-bridge.mjs   → builds src/app/legacy-dark-bridge.css
//   • legacy-color-report.mjs      → ratchet: counts per file, fails CI on growth
//
// "Legacy" = colour utilities that bypass DRVO semantic tokens
// (zinc/gray/slate neutrals, raw hues, white/black). New code must use tokens:
// bg-background, bg-card, text-foreground, text-muted-foreground, border-border,
// bg-primary, text-success, bg-warning-soft …
import fs from 'node:fs';
import path from 'node:path';

export const NEUTRALS = ['zinc', 'gray', 'slate'];
export const HUES = [
  'amber', 'yellow', 'emerald', 'green', 'rose', 'red', 'blue', 'sky', 'violet',
  'purple', 'orange', 'teal', 'cyan', 'indigo', 'pink', 'lime', 'fuchsia',
];

const FAMILY = [...NEUTRALS, ...HUES].join('|');
export const LEGACY_CLASS_RE = new RegExp(
  String.raw`(?<![\w-])((?:[a-z-]+:)*)(bg|text|border|divide|ring|from|via|to|placeholder|outline|fill|stroke|shadow|decoration)-(white|black|(?:${FAMILY})-(?:50|[1-9]00|950))(?:\/(\d{1,3}))?(?![\w-])`,
  'g',
);

export function listSourceFiles(root) {
  const out = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === '__tests__') continue;
        walk(full);
      } else if (/\.(tsx|ts)$/.test(entry.name) && !/\.(test|spec)\.tsx?$/.test(entry.name)) {
        out.push(full);
      }
    }
  };
  walk(root);
  return out.sort();
}

/** Returns [{ token, variants, utility, color, alpha }] for one source string. */
export function scanLegacyClasses(source) {
  const found = [];
  LEGACY_CLASS_RE.lastIndex = 0;
  let m;
  while ((m = LEGACY_CLASS_RE.exec(source))) {
    found.push({
      token: m[0],
      variants: m[1] ? m[1].split(':').filter(Boolean) : [],
      utility: m[2],
      color: m[3],
      alpha: m[4] ? Number(m[4]) : null,
    });
  }
  return found;
}

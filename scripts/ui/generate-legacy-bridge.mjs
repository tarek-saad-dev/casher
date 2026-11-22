#!/usr/bin/env node
// Generates src/app/legacy-dark-bridge.css
//
// WHY: ~11k colour classes in the codebase were written for the old dark
// "Cut Gold" UI (bg-zinc-900, text-zinc-400, text-amber-300, text-white …).
// Switching the default to DRVO Light would make every un-migrated page
// unreadable. This bridge makes those legacy classes render correctly on the
// light theme ONLY (it is inert when <html class="dark">), so the whole app is
// coherent immediately while pages are migrated to semantic tokens wave by wave.
//
// It is a TEMPORARY compatibility layer: as files migrate, their classes stop
// matching and the ratchet (legacy-color-report.mjs) baseline goes to zero.
// Then delete this file and its import.
//
// Regenerate after a migration wave:  node scripts/ui/generate-legacy-bridge.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { HUES, NEUTRALS, listSourceFiles, scanLegacyClasses } from './legacy-classes.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const outPath = path.join(repo, 'src', 'app', 'legacy-dark-bridge.css');
const themeCss = fs.readFileSync(path.join(repo, 'node_modules', 'tailwindcss', 'theme.css'), 'utf8');

const palette = {};
for (const m of themeCss.matchAll(/--color-([a-z]+)-(\d+):\s*([^;]+);/g)) {
  (palette[m[1]] ??= {})[m[2]] = m[3].trim();
}
const hue = (h, s) => {
  const v = palette[h]?.[String(s)];
  if (!v) throw new Error(`missing tailwind colour ${h}-${s}`);
  return v;
};
const withAlpha = (color, alpha) => (alpha == null || alpha >= 100 ? color : `color-mix(in oklab, ${color} ${alpha}%, transparent)`);

// :where() keeps specificity at utility level and @layer utilities keeps normal
// Tailwind ordering, so variants such as hover:text-white still win on hover.
const SCOPE = ':where(:root:not(.dark))';

// Dark-era neutral ramp → DRVO light neutral ramp (inverted).
const NEUTRAL_REMAP = {
  950: 'var(--background)', // page canvas
  900: 'var(--card)', // panels / cards
  800: 'var(--muted)', // inputs, chips, hover rows, subtle dividers
  700: 'var(--border)', // borders
  600: '#8B838F', // strong border / dim text
  500: '#6E6772', // secondary text
  400: '#5F5863', // muted text (most common label colour)
  300: '#3F3943', // body text
  200: '#312C35',
  100: 'var(--foreground)',
  50: '#1E1B21',
};

// Per-token overrides for legacy classes (only those actually used in src/).
const escapeClass = (token) => token.replace(/([:/.[\]%#()!,])/g, '\\$1');
const PROPS = {
  bg: 'background-color', text: 'color', border: 'border-color', divide: 'border-color',
  ring: '--tw-ring-color', outline: 'outline-color', placeholder: 'color', decoration: 'text-decoration-color',
};

function lightValue({ utility, color, alpha }) {
  if (color === 'white') {
    if (utility === 'border' || utility === 'divide' || utility === 'ring' || utility === 'outline') return 'var(--border)';
    if (utility === 'bg' && alpha != null && alpha <= 20) return withAlpha('#27242B', Math.max(3, Math.round(alpha * 0.8)));
    return null; // text-white handled by heuristics; solid bg-white is fine on light
  }
  if (color === 'black') return null;
  const [family, shadeStr] = [color.slice(0, color.lastIndexOf('-')), color.slice(color.lastIndexOf('-') + 1)];
  const shade = Number(shadeStr);

  if (NEUTRALS.includes(family)) {
    // Var remap covers neutrals; fix the light-designed minority it would invert.
    if (utility === 'text' && shade >= 900) return 'var(--foreground)';
    if (utility === 'text' && (shade === 700 || shade === 800)) return 'var(--muted-foreground)';
    if (utility === 'bg' && shade <= 200) return withAlpha('var(--muted)', alpha);
    if ((utility === 'border' || utility === 'divide') && shade <= 300) return 'var(--border)';
    return null;
  }

  if (!HUES.includes(family)) return null;
  const weak = ['amber', 'yellow', 'lime', 'orange'].includes(family);
  if (utility === 'text' || utility === 'placeholder' || utility === 'decoration') {
    const map = { 50: 900, 100: 800, 200: 800, 300: 700, 400: 700 };
    let target = map[shade];
    if (!target && weak && (shade === 500 || shade === 600)) target = 700;
    if (!target && family === 'emerald' && shade === 500) target = 700;
    return target ? withAlpha(hue(family, target), alpha) : null;
  }
  if (utility === 'bg' && shade >= 800) {
    return withAlpha(hue(family, 100), alpha == null ? null : Math.max(alpha, 60));
  }
  if ((utility === 'border' || utility === 'divide') && shade >= 800) return hue(family, 200);
  return null;
}

function selectorFor(token, variants) {
  const base = `.${escapeClass(token)}`;
  let sel = base;
  let pseudo = '';
  for (const v of variants) {
    if (v === 'hover') pseudo += ':hover';
    else if (v === 'focus') pseudo += ':focus';
    else if (v === 'focus-visible') pseudo += ':focus-visible';
    else if (v === 'active') pseudo += ':active';
    else if (v === 'disabled') pseudo += ':disabled';
    else if (v === 'group-hover') sel = `.group:hover ${sel}`;
    else if (v === 'placeholder') pseudo += '::placeholder';
    else return null; // responsive / data-* / dark: variants are left alone
  }
  return `${SCOPE} ${sel}${pseudo}`;
}

const tokens = new Map();
for (const file of listSourceFiles(path.join(repo, 'src'))) {
  for (const hit of scanLegacyClasses(fs.readFileSync(file, 'utf8'))) {
    if (hit.variants.includes('dark')) continue;
    tokens.set(hit.token, hit);
  }
}

const rules = [];
for (const hit of [...tokens.values()].sort((a, b) => a.token.localeCompare(b.token))) {
  const value = lightValue(hit);
  if (!value) continue;
  const sel = selectorFor(hit.token, hit.variants);
  if (!sel) continue;
  const prop = hit.utility === 'divide' ? 'border-color' : PROPS[hit.utility];
  if (!prop) continue;
  const target = hit.utility === 'divide' ? `${sel} > :not(:last-child)` : sel;
  rules.push(`${target}{${prop}:${value}}`);
}

const neutralVars = NEUTRALS.flatMap((fam) =>
  Object.entries(NEUTRAL_REMAP).map(([shade, v]) => `  --color-${fam}-${shade}: ${v};`),
).join('\n');

const textOnSurfaces = ['bg-zinc-', 'bg-gray-', 'bg-slate-', 'bg-white/', 'bg-transparent', 'bg-card', 'bg-background', 'bg-surface', 'bg-muted', 'bg-popover']
  .map((c) => `[class*="${c}"]`).join(',');

const css = `/* AUTO-GENERATED by scripts/ui/generate-legacy-bridge.mjs — do not edit by hand.
 * Temporary DRVO Light compatibility layer for legacy dark-era colour classes.
 * Inert in dark mode. Delete once scripts/ui/legacy-color-baseline.json is empty.
 * Legacy tokens bridged: ${rules.length}
 */

@layer utilities {

/* 1. Dark-era neutral ramps → DRVO light neutrals */
${SCOPE} {
${neutralVars}
}

/* 2. text-white was the dark-era foreground. Keep it white only on solid colour fills. */
${SCOPE} .text-white:not([class*="bg-"]):not([class*="from-"]),
${SCOPE} .text-white:is(${textOnSurfaces}),
${SCOPE} .hover\\:text-white:hover:not([class*="bg-"]):not([class*="from-"]),
${SCOPE} .group:hover .group-hover\\:text-white:not([class*="bg-"]) {
  color: var(--foreground);
}
${SCOPE} [class*="text-white/"]:not([class*="bg-"]):not([class*="from-"]) {
  color: color-mix(in oklab, var(--foreground) 80%, transparent);
}

/* 3. Per-token overrides (light-tuned contrast for dark-era hues, white overlays) */
${rules.join('\n')}

}
`;
fs.writeFileSync(outPath, css);
console.log(`wrote ${path.relative(repo, outPath)} (${rules.length} token rules, ${tokens.size} legacy tokens scanned)`);

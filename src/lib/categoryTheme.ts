/**
 * categoryTheme.ts
 * ──────────────────────────────────────────────────────────────────────────────
 * Central color system for service categories.
 * Uses INLINE CSS styles (not Tailwind) so colors always render regardless
 * of Tailwind's purge/JIT — dynamic class names are never safe in Tailwind.
 */

import type { CSSProperties } from 'react';

export interface CategoryTheme {
  /** Inline style for main badge (bg + border + text) */
  badgeStyle: CSSProperties;
  /** Inline style for card/row soft background */
  cardStyle: CSSProperties;
  /** Inline style for icon container */
  iconStyle: CSSProperties;
  /** Inline style for sub-badge */
  subBadgeStyle: CSSProperties;
  /** Inline style for accent dot */
  dotStyle: CSSProperties;
  /** Plain hex color (for SVG / misc uses) */
  color: string;
  /** Emoji icon */
  emoji: string;
  /** Label for debugging */
  label: string;
}

// ── Palette: [hue RGB hex, name] ─────────────────────────────────────────────
// All palettes tuned for dark backgrounds. Opacity via rgba().

const palettes: [string, string, string][] = [
  // hex,      name,        emoji
  ['59,130,246',  'blue',     '✂️'],   // 0 · blue-500
  ['16,185,129',  'emerald',  '🪒'],   // 1 · emerald-500
  ['168,85,247',  'purple',   '�'],   // 2 · purple-500
  ['249,115,22',  'orange',   '🎁'],   // 3 · orange-500
  ['6,182,212',   'cyan',     '👦'],   // 4 · cyan-500
  ['245,158,11',  'amber',    '👑'],   // 5 · amber-500
  ['236,72,153',  'pink',     '🎨'],   // 6 · pink-500
  ['244,63,94',   'rose',     '💅'],   // 7 · rose-500
  ['20,184,166',  'teal',     '💆'],   // 8 · teal-500
  ['99,102,241',  'indigo',   '💎'],   // 9 · indigo-500
  ['132,204,22',  'lime',     '🌿'],   // 10 · lime-500
  ['161,98,7',    'yellow',   '⭐'],   // 11 · yellow-700
];

function buildTheme(rgb: string, emoji: string, label: string): CategoryTheme {
  return {
    badgeStyle: {
      backgroundColor: `rgba(${rgb}, 0.15)`,
      borderColor:     `rgba(${rgb}, 0.50)`,
      color:           `rgba(${rgb}, 1)`,
      border:          '1px solid',
      borderRadius:    '9999px',
      fontWeight:      600,
      display:         'inline-flex',
      alignItems:      'center',
      gap:             '5px',
      whiteSpace:      'nowrap' as const,
    },
    cardStyle: {
      backgroundColor: `rgba(${rgb}, 0.08)`,
      borderColor:     `rgba(${rgb}, 0.35)`,
      border:          '1px solid',
    },
    iconStyle: {
      backgroundColor: `rgba(${rgb}, 0.20)`,
      color:           `rgba(${rgb}, 1)`,
    },
    subBadgeStyle: {
      backgroundColor: `rgba(${rgb}, 0.08)`,
      borderColor:     `rgba(${rgb}, 0.25)`,
      color:           `rgba(${rgb}, 0.85)`,
      border:          '1px solid',
      borderRadius:    '9999px',
      fontWeight:      500,
      display:         'inline-flex',
      alignItems:      'center',
      gap:             '4px',
      whiteSpace:      'nowrap' as const,
    },
    dotStyle: {
      backgroundColor: `rgba(${rgb}, 1)`,
      borderRadius:    '9999px',
    },
    color:  `rgb(${rgb})`,
    emoji,
    label,
  };
}

const themes: CategoryTheme[] = palettes.map(([rgb, label, emoji]) =>
  buildTheme(rgb, emoji, label)
);

// ── Keyword → palette index ───────────────────────────────────────────────────

const keywordMap: [RegExp, number][] = [
  [/شعر|hair|حلاقة|قص|تشكيل|فرد|سشوار/i,         0],
  [/دقن|لحية|beard|حلق|مرتب|داشيا/i,               1],
  [/بشرة|عناية|skin|كيرات|سبا|وجه|face|كريم/i,     2],
  [/عرض|باقة|offer|package|كومبو|combo/i,           3],
  [/طفل|أطفال|kids|child/i,                         4],
  [/vip|مميز|بريميم|premium|خاص|ذهب|gold/i,        5],
  [/صبغ|لون|color|colour|henna|حناء/i,             6],
  [/أظافر|ظفر|nail/i,                                7],
  [/مساج|massage|spa|استرخاء|relax/i,                8],
];

// ── Public helpers ────────────────────────────────────────────────────────────

/** Stable hash for strings → palette index */
function hashStr(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) & 0xffff;
  return h;
}

/**
 * Returns a CategoryTheme for any category name.
 * Keyword match → deterministic hash fallback → never returns undefined.
 */
export function getCategoryTheme(catName: string | null | undefined, catId?: number | null): CategoryTheme {
  if (!catName && catId == null) return themes[0];
  if (catName) {
    for (const [regex, idx] of keywordMap) {
      if (regex.test(catName)) return themes[idx];
    }
    return themes[hashStr(catName) % themes.length];
  }
  return themes[(catId as number) % themes.length];
}

/**
 * Returns a CategoryTheme by numeric ID (stable color per ID).
 */
export function getCategoryThemeById(catId: number | null | undefined): CategoryTheme {
  if (catId == null) return themes[0];
  return themes[Math.abs(catId) % themes.length];
}

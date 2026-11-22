// src/lib/theme.ts
// ─────────────────────────────────────────────────────────────────────────────
// Central design-token system (DRVO Light V1 — ADR-024 / ADR-041).
//
//  • ONE palette: DRVO Plum + Teal + Soft Neutrals. Business-level brand
//    overrides (ADR-026) will plug into `brandOverrides()` later — never by
//    hard-coding colours inside pages or modules.
//  • Light is the default mode. Dark stays available as a user preference.
//  • Plum  = brand / navigation context.  Teal = primary actions.
//    Status colours (success / warning / danger / info) are semantic and are
//    never replaced by brand colours.
//  • Every token is a CSS custom property consumed through Tailwind
//    (`bg-primary`, `text-muted-foreground`, `border-border` …).
//  • This file is the ONLY place colour values live. ThemeInit (first paint)
//    and ThemeProvider (runtime) both read from here.
// ─────────────────────────────────────────────────────────────────────────────

import type { CSSProperties } from 'react';

export type ThemeMode = 'light' | 'dark' | 'system';
export type ThemePalette = 'drvo';

export interface ThemeConfig {
  mode: ThemeMode;
  palette: ThemePalette;
}

export const THEME_MODE_LABELS: Record<ThemeMode, string> = {
  light: 'فاتح',
  dark: 'داكن',
  system: 'النظام',
};

export const THEME_PALETTE_LABELS: Record<ThemePalette, string> = {
  drvo: 'DRVO',
};

export const THEME_PALETTE_ORDER: ThemePalette[] = ['drvo'];

export const DEFAULT_THEME_CONFIG: ThemeConfig = {
  mode: 'light',
  palette: 'drvo',
};

/** ADR-024 founder-approved base colours (reference values, do not inline in UI). */
export const DRVO_BRAND = {
  plum: '#74536E',
  deepPlum: '#553E53',
  teal: '#1A7B80',
  canvas: '#F7F6F8',
  panel: '#FFFFFF',
  text: '#27242B',
} as const;

type TokenMap = Record<`--${string}`, string>;

/** Full token set per resolved mode. */
export const THEME_TOKENS: Record<'light' | 'dark', TokenMap> = {
  light: {
    // Surfaces & text
    '--background': DRVO_BRAND.canvas,
    '--foreground': DRVO_BRAND.text,
    '--surface': DRVO_BRAND.panel,
    '--surface-muted': '#F1EEF2',
    '--surface-elevated': DRVO_BRAND.panel,
    '--card': DRVO_BRAND.panel,
    '--card-foreground': DRVO_BRAND.text,
    '--popover': DRVO_BRAND.panel,
    '--popover-foreground': DRVO_BRAND.text,
    '--muted': '#F1EEF2',
    '--muted-foreground': '#6E6772',
    '--border': '#E6E1E8',
    '--input': '#D9D3DC',
    '--ring': DRVO_BRAND.teal,
    // Brand (Plum)
    '--brand': DRVO_BRAND.plum,
    '--brand-deep': DRVO_BRAND.deepPlum,
    '--brand-foreground': '#FFFFFF',
    '--brand-soft': '#F3ECF2',
    // Primary action (Teal)
    '--primary': DRVO_BRAND.teal,
    '--primary-hover': '#166A6E',
    '--primary-active': '#11585C',
    '--primary-foreground': '#FFFFFF',
    '--primary-soft': '#E3F1F1',
    '--secondary': '#F1EEF2',
    '--secondary-hover': '#E8E3EA',
    '--secondary-foreground': DRVO_BRAND.text,
    '--accent': '#F3ECF2',
    '--accent-foreground': DRVO_BRAND.deepPlum,
    // Semantic status (text + icon always accompany colour)
    '--success': '#167B53',
    '--success-foreground': '#FFFFFF',
    '--success-soft': '#E4F3EC',
    '--warning': '#9B6214',
    '--warning-foreground': '#FFFFFF',
    '--warning-soft': '#FDF5E9',
    '--destructive': '#B53B46',
    '--destructive-foreground': '#FFFFFF',
    '--destructive-soft': '#FAE8EA',
    '--info': '#2F6690',
    '--info-foreground': '#FFFFFF',
    '--info-soft': '#E5EEF6',
    // Shell — neutral context bar; Plum marks navigation state (ADR-024:
    // Deep Plum header remains an option pending visual sign-off).
    '--topbar-background': DRVO_BRAND.panel,
    '--topbar-foreground': DRVO_BRAND.text,
    '--topbar-border': '#E6E1E8',
    '--sidebar-background': DRVO_BRAND.panel,
    '--sidebar-foreground': '#3F3943',
    '--sidebar-hover': '#F5F2F6',
    '--sidebar-active': '#F3ECF2',
    '--sidebar-active-foreground': DRVO_BRAND.deepPlum,
    '--sidebar-border': '#E6E1E8',
    // Charts
    '--chart-1': DRVO_BRAND.teal,
    '--chart-2': DRVO_BRAND.plum,
    '--chart-3': '#C9892E',
    '--chart-4': '#2F6690',
    '--chart-5': '#167B53',
    '--chart-6': '#B53B46',
  },
  dark: {
    '--background': '#17141A',
    '--foreground': '#F3F0F4',
    '--surface': '#1F1B22',
    '--surface-muted': '#29242D',
    '--surface-elevated': '#241F27',
    '--card': '#1F1B22',
    '--card-foreground': '#F3F0F4',
    '--popover': '#241F27',
    '--popover-foreground': '#F3F0F4',
    '--muted': '#29242D',
    '--muted-foreground': '#A79FAB',
    '--border': '#352F39',
    '--input': '#423B46',
    '--ring': '#4FB3B8',
    '--brand': '#B48FAD',
    '--brand-deep': '#D8C2D3',
    '--brand-foreground': '#1E1620',
    '--brand-soft': '#2E2430',
    '--primary': '#2A9DA3',
    '--primary-hover': '#33AAB0',
    '--primary-active': '#3DB6BC',
    '--primary-foreground': '#061A1B',
    '--primary-soft': '#173235',
    '--secondary': '#29242D',
    '--secondary-hover': '#332D37',
    '--secondary-foreground': '#F3F0F4',
    '--accent': '#2E2430',
    '--accent-foreground': '#E9DDE7',
    '--success': '#3BB58A',
    '--success-foreground': '#0E1A14',
    '--success-soft': '#16291F',
    '--warning': '#E0A646',
    '--warning-foreground': '#1A1206',
    '--warning-soft': '#2D2312',
    '--destructive': '#E06C76',
    '--destructive-foreground': '#1A0A0C',
    '--destructive-soft': '#33181C',
    '--info': '#6AA8DA',
    '--info-foreground': '#0A141C',
    '--info-soft': '#16232F',
    '--topbar-background': '#2A2029',
    '--topbar-foreground': '#F3F0F4',
    '--topbar-border': '#3A2E39',
    '--sidebar-background': '#1F1B22',
    '--sidebar-foreground': '#D9D3DC',
    '--sidebar-hover': '#29242D',
    '--sidebar-active': '#2E2430',
    '--sidebar-active-foreground': '#F3F0F4',
    '--sidebar-border': '#352F39',
    '--chart-1': '#4FB3B8',
    '--chart-2': '#B48FAD',
    '--chart-3': '#E0A646',
    '--chart-4': '#6AA8DA',
    '--chart-5': '#3BB58A',
    '--chart-6': '#E06C76',
  },
};

export const THEME_STORAGE_KEY = 'drvo-theme-v2';
export const THEME_MODE_COOKIE = 'theme-mode';
export const THEME_PALETTE_COOKIE = 'theme-palette';

export function isValidThemeMode(value: string): value is ThemeMode {
  return value === 'light' || value === 'dark' || value === 'system';
}

export function isValidThemePalette(value: string): value is ThemePalette {
  return THEME_PALETTE_ORDER.includes(value as ThemePalette);
}

export function resolveThemeMode(mode: ThemeMode): 'light' | 'dark' {
  if (mode !== 'system') return mode;
  if (typeof window === 'undefined') return 'light';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function getResolvedThemeClass(mode: ThemeMode): 'light' | 'dark' {
  return resolveThemeMode(mode);
}

/** Resolved token map for a mode/palette pair (palette reserved for ADR-026 overrides). */
export function getThemeTokens(mode: ThemeMode, _palette: ThemePalette = 'drvo'): TokenMap {
  return THEME_TOKENS[resolveThemeMode(mode)];
}

/** Serialises tokens as a `:root{…}` declaration body for first-paint CSS. */
export function themeTokensToCss(tokens: TokenMap): string {
  return Object.entries(tokens)
    .map(([k, v]) => `${k}:${v};`)
    .join('');
}

export function applyThemeColors(mode: ThemeMode, palette: ThemePalette, target?: HTMLElement): void {
  if (typeof document === 'undefined') return;
  const root = target ?? document.documentElement;
  const resolvedMode = resolveThemeMode(mode);

  for (const [key, value] of Object.entries(getThemeTokens(resolvedMode, palette))) {
    root.style.setProperty(key, value);
  }

  root.setAttribute('data-theme-mode', resolvedMode);
  root.setAttribute('data-theme-palette', palette);
  root.classList.remove('light', 'dark');
  root.classList.add(resolvedMode);
}

export function applyThemeColorsToStyle(mode: ThemeMode, palette: ThemePalette): CSSProperties {
  return { ...getThemeTokens(mode, palette) } as CSSProperties;
}

export function loadThemeConfig(): ThemeConfig {
  if (typeof window === 'undefined') return DEFAULT_THEME_CONFIG;
  try {
    const raw = localStorage.getItem(THEME_STORAGE_KEY);
    if (!raw) return DEFAULT_THEME_CONFIG;
    const parsed = JSON.parse(raw) as Partial<ThemeConfig>;
    const mode: ThemeMode = isValidThemeMode(parsed.mode ?? '') ? (parsed.mode as ThemeMode) : DEFAULT_THEME_CONFIG.mode;
    const palette: ThemePalette = isValidThemePalette(parsed.palette ?? '') ? (parsed.palette as ThemePalette) : DEFAULT_THEME_CONFIG.palette;
    return { mode, palette };
  } catch {
    return DEFAULT_THEME_CONFIG;
  }
}

export function saveThemeConfig(config: ThemeConfig): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(THEME_STORAGE_KEY, JSON.stringify(config));
  } catch {
    // ignore storage errors
  }
}

export function getThemeCookieValue(config: ThemeConfig): string {
  return `${THEME_MODE_COOKIE}=${config.mode}; ${THEME_PALETTE_COOKIE}=${config.palette}`;
}

/**
 * Reads mode/palette cookies. A legacy palette cookie (cut-gold, emerald …)
 * means the user never chose the DRVO theme, so their mode falls back to the
 * new Light default instead of carrying the old dark default forward.
 */
export function parseThemeCookie(cookieHeader?: string | null): ThemeConfig {
  if (!cookieHeader) return DEFAULT_THEME_CONFIG;
  const get = (name: string) => {
    const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
    return match?.[1];
  };
  const mode = get(THEME_MODE_COOKIE);
  const palette = get(THEME_PALETTE_COOKIE);
  if (!isValidThemePalette(palette ?? '')) return DEFAULT_THEME_CONFIG;
  return {
    mode: isValidThemeMode(mode ?? '') ? (mode as ThemeMode) : DEFAULT_THEME_CONFIG.mode,
    palette: palette as ThemePalette,
  };
}

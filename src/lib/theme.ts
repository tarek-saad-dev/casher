// src/lib/theme.ts
// ─────────────────────────────────────────────────────────────────────────────
// Central design-token system for the application.
// Supports independent appearance mode (light | dark | system) and
// independent color palettes (cut-gold, emerald, royal-blue, burgundy, graphite).
// All semantic colors are exposed as CSS custom properties.
// ─────────────────────────────────────────────────────────────────────────────

import type { CSSProperties } from 'react';

export type ThemeMode = 'light' | 'dark' | 'system';
export type ThemePalette = 'cut-gold' | 'emerald' | 'royal-blue' | 'burgundy' | 'graphite';

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
  'cut-gold': 'Cut Gold',
  emerald: 'Emerald',
  'royal-blue': 'Royal Blue',
  burgundy: 'Burgundy',
  graphite: 'Graphite',
};

export const THEME_PALETTE_ORDER: ThemePalette[] = [
  'cut-gold',
  'emerald',
  'royal-blue',
  'burgundy',
  'graphite',
];

export const DEFAULT_THEME_CONFIG: ThemeConfig = {
  mode: 'dark',
  palette: 'cut-gold',
};

const MODE_COLORS = {
  light: {
    '--background': 'oklch(1 0 0)',
    '--foreground': 'oklch(0.145 0 0)',
    '--surface': 'oklch(0.98 0 0)',
    '--surface-muted': 'oklch(0.95 0 0)',
    '--surface-elevated': 'oklch(1 0 0)',
    '--card': 'oklch(1 0 0)',
    '--card-foreground': 'oklch(0.145 0 0)',
    '--popover': 'oklch(1 0 0)',
    '--popover-foreground': 'oklch(0.145 0 0)',
    '--muted': 'oklch(0.96 0 0)',
    '--muted-foreground': 'oklch(0.55 0 0)',
    '--border': 'oklch(0.9 0 0)',
    '--input': 'oklch(0.9 0 0)',
    '--ring': 'oklch(0.7 0 0)',
    '--topbar-background': 'oklch(0.97 0 0)',
    '--topbar-foreground': 'oklch(0.25 0 0)',
    '--topbar-border': 'oklch(0.88 0 0)',
    '--sidebar-background': 'oklch(0.97 0 0)',
    '--sidebar-foreground': 'oklch(0.2 0 0)',
    '--sidebar-hover': 'oklch(0.93 0 0)',
    '--sidebar-active': 'oklch(0.9 0 0)',
    '--sidebar-active-foreground': 'oklch(0.15 0 0)',
    '--sidebar-border': 'oklch(0.88 0 0)',
  },
  dark: {
    '--background': '#0A0A0B',
    '--foreground': '#F7F1E5',
    '--surface': '#111114',
    '--surface-muted': '#1A1A1F',
    '--surface-elevated': '#16161A',
    '--card': '#111114',
    '--card-foreground': '#F7F1E5',
    '--popover': '#111114',
    '--popover-foreground': '#F7F1E5',
    '--muted': '#1A1A1F',
    '--muted-foreground': '#A7A29A',
    '--border': '#2A2A30',
    '--input': '#2A2A30',
    '--ring': '#A7A29A',
    '--topbar-background': '#111114',
    '--topbar-foreground': '#F7F1E5',
    '--topbar-border': '#2A2A30',
    '--sidebar-background': '#111114',
    '--sidebar-foreground': '#F7F1E5',
    '--sidebar-hover': '#1A1A1F',
    '--sidebar-active': '#2A2A30',
    '--sidebar-active-foreground': '#F7F1E5',
    '--sidebar-border': '#2A2A30',
  },
};

export const PALETTE_CSS: Record<ThemePalette, Record<string, string>> = {
  'cut-gold': {
    '--primary': '#D6A84F',
    '--primary-hover': '#E4BE6C',
    '--primary-active': '#EBCE89',
    '--primary-foreground': '#0A0A0B',
    '--secondary': '#2A2A30',
    '--secondary-hover': '#3A3A45',
    '--secondary-foreground': '#F7F1E5',
    '--accent': '#E4BE6C',
    '--accent-foreground': '#0A0A0B',
    '--success': '#34D399',
    '--success-foreground': '#0A0A0B',
    '--warning': '#FBBF24',
    '--warning-foreground': '#0A0A0B',
    '--destructive': '#F87171',
    '--destructive-foreground': '#0A0A0B',
    '--info': '#60A5FA',
    '--info-foreground': '#0A0A0B',
    '--chart-1': '#D6A84F',
    '--chart-2': '#FBBF24',
    '--chart-3': '#34D399',
    '--chart-4': '#60A5FA',
    '--chart-5': '#F87171',
    '--chart-6': '#A78BFA',
  },
  emerald: {
    '--primary': '#10B981',
    '--primary-hover': '#34D399',
    '--primary-active': '#6EE7B7',
    '--primary-foreground': '#FFFFFF',
    '--secondary': '#064E3B',
    '--secondary-hover': '#065F46',
    '--secondary-foreground': '#F7F1E5',
    '--accent': '#34D399',
    '--accent-foreground': '#0A0A0B',
    '--success': '#34D399',
    '--success-foreground': '#0A0A0B',
    '--warning': '#FBBF24',
    '--warning-foreground': '#0A0A0B',
    '--destructive': '#F87171',
    '--destructive-foreground': '#0A0A0B',
    '--info': '#60A5FA',
    '--info-foreground': '#0A0A0B',
    '--chart-1': '#10B981',
    '--chart-2': '#34D399',
    '--chart-3': '#FBBF24',
    '--chart-4': '#60A5FA',
    '--chart-5': '#F87171',
    '--chart-6': '#A78BFA',
  },
  'royal-blue': {
    '--primary': '#3B82F6',
    '--primary-hover': '#60A5FA',
    '--primary-active': '#93C5FD',
    '--primary-foreground': '#FFFFFF',
    '--secondary': '#1E3A8A',
    '--secondary-hover': '#1E40AF',
    '--secondary-foreground': '#F7F1E5',
    '--accent': '#60A5FA',
    '--accent-foreground': '#0A0A0B',
    '--success': '#34D399',
    '--success-foreground': '#0A0A0B',
    '--warning': '#FBBF24',
    '--warning-foreground': '#0A0A0B',
    '--destructive': '#F87171',
    '--destructive-foreground': '#0A0A0B',
    '--info': '#60A5FA',
    '--info-foreground': '#0A0A0B',
    '--chart-1': '#3B82F6',
    '--chart-2': '#60A5FA',
    '--chart-3': '#34D399',
    '--chart-4': '#FBBF24',
    '--chart-5': '#F87171',
    '--chart-6': '#A78BFA',
  },
  burgundy: {
    '--primary': '#9F1239',
    '--primary-hover': '#BE123C',
    '--primary-active': '#E11D48',
    '--primary-foreground': '#FFFFFF',
    '--secondary': '#4C0519',
    '--secondary-hover': '#5C0A22',
    '--secondary-foreground': '#F7F1E5',
    '--accent': '#E11D48',
    '--accent-foreground': '#FFFFFF',
    '--success': '#34D399',
    '--success-foreground': '#0A0A0B',
    '--warning': '#FBBF24',
    '--warning-foreground': '#0A0A0B',
    '--destructive': '#F87171',
    '--destructive-foreground': '#0A0A0B',
    '--info': '#60A5FA',
    '--info-foreground': '#0A0A0B',
    '--chart-1': '#9F1239',
    '--chart-2': '#E11D48',
    '--chart-3': '#34D399',
    '--chart-4': '#FBBF24',
    '--chart-5': '#F87171',
    '--chart-6': '#A78BFA',
  },
  graphite: {
    '--primary': '#6B7280',
    '--primary-hover': '#9CA3AF',
    '--primary-active': '#D1D5DB',
    '--primary-foreground': '#FFFFFF',
    '--secondary': '#27272A',
    '--secondary-hover': '#3F3F46',
    '--secondary-foreground': '#F7F1E5',
    '--accent': '#9CA3AF',
    '--accent-foreground': '#0A0A0B',
    '--success': '#34D399',
    '--success-foreground': '#0A0A0B',
    '--warning': '#FBBF24',
    '--warning-foreground': '#0A0A0B',
    '--destructive': '#F87171',
    '--destructive-foreground': '#0A0A0B',
    '--info': '#60A5FA',
    '--info-foreground': '#0A0A0B',
    '--chart-1': '#6B7280',
    '--chart-2': '#9CA3AF',
    '--chart-3': '#34D399',
    '--chart-4': '#FBBF24',
    '--chart-5': '#F87171',
    '--chart-6': '#A78BFA',
  },
};

export const THEME_STORAGE_KEY = 'cut-theme-v1';
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
  if (typeof window === 'undefined') return 'dark';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function getResolvedThemeClass(mode: ThemeMode): 'light' | 'dark' {
  return resolveThemeMode(mode);
}

export function applyThemeColors(mode: ThemeMode, palette: ThemePalette, target?: HTMLElement): void {
  if (typeof document === 'undefined') return;
  const root = target ?? document.documentElement;
  const resolvedMode = resolveThemeMode(mode);

  // Apply mode base colors
  const modeColors = MODE_COLORS[resolvedMode];
  for (const [key, value] of Object.entries(modeColors)) {
    root.style.setProperty(key, value);
  }

  // Apply palette colors
  const paletteColors = PALETTE_CSS[palette];
  for (const [key, value] of Object.entries(paletteColors)) {
    root.style.setProperty(key, value);
  }

  // Set data attributes for Tailwind/JS selectors
  root.setAttribute('data-theme-mode', resolvedMode);
  root.setAttribute('data-theme-palette', palette);
  root.classList.remove('light', 'dark');
  root.classList.add(resolvedMode);
}

export function applyThemeColorsToStyle(mode: ThemeMode, palette: ThemePalette): CSSProperties {
  const resolvedMode = resolveThemeMode(mode);
  return {
    ...Object.fromEntries(
      Object.entries(MODE_COLORS[resolvedMode]).map(([k, v]) => [k, v])
    ),
    ...Object.fromEntries(
      Object.entries(PALETTE_CSS[palette]).map(([k, v]) => [k, v])
    ),
  } as CSSProperties;
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

export function parseThemeCookie(cookieHeader?: string | null): ThemeConfig {
  if (!cookieHeader) return DEFAULT_THEME_CONFIG;
  const get = (name: string) => {
    const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
    return match?.[1];
  };
  const mode = get(THEME_MODE_COOKIE);
  const palette = get(THEME_PALETTE_COOKIE);
  return {
    mode: isValidThemeMode(mode ?? '') ? (mode as ThemeMode) : DEFAULT_THEME_CONFIG.mode,
    palette: isValidThemePalette(palette ?? '') ? (palette as ThemePalette) : DEFAULT_THEME_CONFIG.palette,
  };
}

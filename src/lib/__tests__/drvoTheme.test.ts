import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  DEFAULT_THEME_CONFIG,
  applyThemeColors,
  loadThemeConfig,
  DRVO_BRAND,
  THEME_TOKENS,
  parseThemeCookie,
  themeTokensToCss,
} from '@/lib/theme';

function luminance(hex: string): number {
  const h = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4]
    .map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const TEXT_PAIRS: Array<[string, string]> = [
  ['--foreground', '--background'],
  ['--foreground', '--card'],
  ['--muted-foreground', '--card'],
  ['--muted-foreground', '--background'],
  ['--muted-foreground', '--muted'],
  ['--primary-foreground', '--primary'],
  ['--brand-foreground', '--brand'],
  ['--success-foreground', '--success'],
  ['--warning-foreground', '--warning'],
  ['--destructive-foreground', '--destructive'],
  ['--info-foreground', '--info'],
  ['--success', '--success-soft'],
  ['--warning', '--warning-soft'],
  ['--destructive', '--destructive-soft'],
  ['--info', '--info-soft'],
  ['--brand', '--brand-soft'],
  ['--primary', '--card'],
  ['--sidebar-active-foreground', '--sidebar-active'],
  ['--topbar-foreground', '--topbar-background'],
];

describe('DRVO Light V1 theme tokens (ADR-024 / ADR-041)', () => {
  it('defaults to light mode with the single DRVO palette', () => {
    expect(DEFAULT_THEME_CONFIG).toEqual({ mode: 'light', palette: 'drvo' });
  });

  it('uses the six founder-approved base colours in light mode', () => {
    const light = THEME_TOKENS.light;
    expect(DRVO_BRAND).toEqual({
      plum: '#74536E',
      deepPlum: '#553E53',
      teal: '#1A7B80',
      canvas: '#F7F6F8',
      panel: '#FFFFFF',
      text: '#27242B',
    });
    expect(light['--brand']).toBe('#74536E');
    expect(light['--primary']).toBe('#1A7B80');
    expect(light['--background']).toBe('#F7F6F8');
    expect(light['--card']).toBe('#FFFFFF');
    expect(light['--foreground']).toBe('#27242B');
  });

  it('light and dark define exactly the same token keys', () => {
    expect(Object.keys(THEME_TOKENS.dark).sort()).toEqual(Object.keys(THEME_TOKENS.light).sort());
  });

  for (const mode of ['light', 'dark'] as const) {
    it(`meets WCAG AA (4.5:1) for core text pairs in ${mode} mode`, () => {
      const t = THEME_TOKENS[mode];
      for (const [fg, bg] of TEXT_PAIRS) {
        const ratio = contrast(t[fg as keyof typeof t], t[bg as keyof typeof t]);
        expect(ratio, `${fg} on ${bg} = ${ratio.toFixed(2)}`).toBeGreaterThanOrEqual(4.5);
      }
    });
  }

  it('drops legacy palettes (cut-gold …) back to the DRVO light default', () => {
    expect(parseThemeCookie('theme-mode=dark; theme-palette=cut-gold')).toEqual(DEFAULT_THEME_CONFIG);
    expect(parseThemeCookie('theme-mode=dark; theme-palette=drvo')).toEqual({ mode: 'dark', palette: 'drvo' });
    expect(parseThemeCookie(null)).toEqual(DEFAULT_THEME_CONFIG);
  });

  it('uses the server preference when localStorage is empty or unavailable', () => {
    const fallback = { mode: 'dark', palette: 'drvo' } as const;
    vi.stubGlobal('window', {});
    vi.stubGlobal('localStorage', { getItem: () => null });
    try {
      expect(loadThemeConfig(fallback)).toEqual(fallback);
      vi.stubGlobal('localStorage', { getItem: () => { throw new Error('unavailable'); } });
      expect(loadThemeConfig(fallback)).toEqual(fallback);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('updates native colour scheme alongside semantic tokens at runtime', () => {
    const root = {
      style: { setProperty: vi.fn(), colorScheme: '' },
      setAttribute: vi.fn(),
      classList: { remove: vi.fn(), add: vi.fn() },
    };
    vi.stubGlobal('document', { documentElement: root });
    try {
      applyThemeColors('dark', 'drvo');
      expect(root.style.colorScheme).toBe('dark');
      expect(root.style.setProperty).toHaveBeenCalledWith('--background', THEME_TOKENS.dark['--background']);
      applyThemeColors('light', 'drvo');
      expect(root.style.colorScheme).toBe('light');
      expect(root.classList.add).toHaveBeenLastCalledWith('light');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('serialises tokens for first-paint CSS', () => {
    const css = themeTokensToCss(THEME_TOKENS.light);
    expect(css).toContain('--primary:#1A7B80;');
    expect(css).toContain('--brand:#74536E;');
  });

  it('ThemeInit reads values from lib/theme instead of duplicating hex values', () => {
    const src = readFileSync(join(process.cwd(), 'src/components/theme/ThemeInit.tsx'), 'utf8');
    expect(src).toContain('getThemeTokens');
    expect(src).not.toMatch(/#[0-9A-Fa-f]{6}/);
    expect(src).toContain("getThemeTokens('dark', config.palette)");
    expect(src).toContain(':root.dark{');
    expect(src).toContain('color-scheme:dark');
    expect(src).toContain('<script');
    expect(src).not.toContain('afterInteractive');
  });

  it('globals.css maps tokens but holds no colour values of its own', () => {
    const css = readFileSync(join(process.cwd(), 'src/app/globals.css'), 'utf8');
    expect(css).toContain('--color-brand: var(--brand);');
    expect(css).toContain('--color-primary: var(--primary);');
    expect(css).not.toMatch(/--(background|primary|brand|card|foreground):\s*(#|oklch)/);
  });

  it('resolves inline queue and booking theme tokens in both modes', () => {
    const paths = [
      'src/app/queue/live/page.tsx',
      'src/app/queue/new/page.tsx',
      'src/app/bookings/page.tsx',
      'src/app/bookings/new/page.tsx',
      'src/app/bookings/calendar/page.tsx',
      'src/app/admin/queue-booking-settings/page.tsx',
    ];
    for (const path of paths) {
      const source = readFileSync(join(process.cwd(), path), 'utf8');
      const tokens = [...source.matchAll(/var\((--[a-z-]+)\)/g)].map((match) => match[1]);
      expect(tokens.length, path).toBeGreaterThan(0);
      for (const token of tokens) {
        expect(THEME_TOKENS.light, `${path}: ${token}`).toHaveProperty(token);
        expect(THEME_TOKENS.dark, `${path}: ${token}`).toHaveProperty(token);
      }
      expect(source, path).not.toMatch(/\$\{(?:cfg|act)\.color\}[0-9a-f]{2}/i);
    }
  });

});

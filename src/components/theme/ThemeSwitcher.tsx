'use client';

import { useTheme } from '@/hooks/useTheme';
import {
  THEME_MODE_LABELS,
  THEME_PALETTE_LABELS,
  THEME_PALETTE_ORDER,
  type ThemeMode,
  type ThemePalette,
} from '@/lib/theme';
import { Monitor, Moon, Sun, Palette } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ThemeSwitcherProps {
  className?: string;
  variant?: 'dropdown' | 'segmented';
}

const MODE_ICONS: Record<ThemeMode, React.ReactNode> = {
  light: <Sun className="h-4 w-4" />,
  dark: <Moon className="h-4 w-4" />,
  system: <Monitor className="h-4 w-4" />,
};

export function ThemeModeSwitch({ className }: { className?: string }) {
  const { mode, setMode } = useTheme();
  const modes: ThemeMode[] = ['light', 'dark', 'system'];

  return (
    <div className={cn('inline-flex items-center gap-1 rounded-lg border border-border bg-surface p-1', className)}>
      {modes.map((m) => (
        <button
          key={m}
          type="button"
          onClick={() => setMode(m)}
          className={cn(
            'flex items-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium transition-colors',
            mode === m
              ? 'bg-primary text-primary-foreground'
              : 'text-muted-foreground hover:text-foreground hover:bg-surface-muted'
          )}
          title={THEME_MODE_LABELS[m]}
        >
          {MODE_ICONS[m]}
          <span className="hidden sm:inline">{THEME_MODE_LABELS[m]}</span>
        </button>
      ))}
    </div>
  );
}

export function ThemePaletteSwitch({ className }: { className?: string }) {
  const { palette, setPalette } = useTheme();

  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      {THEME_PALETTE_ORDER.map((p) => (
        <button
          key={p}
          type="button"
          onClick={() => setPalette(p)}
          className={cn(
            'flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-medium transition-colors',
            palette === p
              ? 'border-primary bg-primary/10 text-primary'
              : 'border-border bg-surface text-muted-foreground hover:bg-surface-muted hover:text-foreground'
          )}
        >
          <span
            className="h-4 w-4 rounded-full border border-current/30"
            style={{ backgroundColor: `var(--primary)` }}
            data-palette={p}
          />
          {THEME_PALETTE_LABELS[p]}
        </button>
      ))}
    </div>
  );
}

export default function ThemeSwitcher({ className, variant = 'dropdown' }: ThemeSwitcherProps) {
  const { mode, palette, setMode, setPalette } = useTheme();
  const modes: ThemeMode[] = ['light', 'dark', 'system'];

  if (variant === 'segmented') {
    return (
      <div className={cn('space-y-3', className)}>
        <div>
          <p className="mb-2 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <Sun className="h-3.5 w-3.5" />
            الوضع المظهري
          </p>
          <ThemeModeSwitch />
        </div>
        <div>
          <p className="mb-2 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <Palette className="h-3.5 w-3.5" />
            لوحة الألوان
          </p>
          <ThemePaletteSwitch />
        </div>
      </div>
    );
  }

  return (
    <div className={cn('space-y-3 rounded-xl border border-border bg-surface p-3', className)}>
      <div>
        <p className="mb-2 text-xs font-medium text-muted-foreground">الوضع المظهري</p>
        <div className="grid grid-cols-3 gap-1 rounded-lg border border-border bg-surface-muted p-1">
          {modes.map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              className={cn(
                'flex items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium transition-colors',
                mode === m
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              {MODE_ICONS[m]}
              <span>{THEME_MODE_LABELS[m]}</span>
            </button>
          ))}
        </div>
      </div>
      <div>
        <p className="mb-2 text-xs font-medium text-muted-foreground">لوحة الألوان</p>
        <div className="grid grid-cols-1 gap-1">
          {THEME_PALETTE_ORDER.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setPalette(p)}
              className={cn(
                'flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-medium transition-colors',
                palette === p
                  ? 'border-primary bg-primary/10 text-primary'
                  : 'border-border bg-surface text-muted-foreground hover:bg-surface-muted hover:text-foreground'
              )}
            >
              <span
                className="h-4 w-4 rounded-full border border-current/30"
                style={{ backgroundColor: PALETTE_CSS_PREVIEW[p] }}
              />
              {THEME_PALETTE_LABELS[p]}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

const PALETTE_CSS_PREVIEW: Record<ThemePalette, string> = {
  'cut-gold': '#D6A84F',
  emerald: '#10B981',
  'royal-blue': '#3B82F6',
  burgundy: '#9F1239',
  graphite: '#6B7280',
};

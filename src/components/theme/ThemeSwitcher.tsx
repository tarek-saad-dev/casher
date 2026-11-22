'use client';

import { useTheme } from '@/hooks/useTheme';
import { THEME_MODE_LABELS, type ThemeMode } from '@/lib/theme';
import { Monitor, Moon, Sun } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ThemeSwitcherProps {
  className?: string;
  /** Kept for call-site compatibility; both render the same mode control. */
  variant?: 'dropdown' | 'segmented';
}

const MODES: ThemeMode[] = ['light', 'dark', 'system'];

const MODE_ICONS: Record<ThemeMode, React.ReactNode> = {
  light: <Sun className="h-4 w-4" aria-hidden />,
  dark: <Moon className="h-4 w-4" aria-hidden />,
  system: <Monitor className="h-4 w-4" aria-hidden />,
};

/**
 * Appearance mode control. DRVO has a single palette (Plum/Teal, ADR-024);
 * business-specific branding will come from the Business Theme Engine
 * (ADR-026), not from a per-user palette picker.
 */
export function ThemeModeSwitch({ className }: { className?: string }) {
  const { mode, setMode } = useTheme();

  return (
    <div
      role="radiogroup"
      aria-label="الوضع المظهري"
      className={cn('inline-flex items-center gap-1 rounded-lg border border-border bg-muted p-1', className)}
    >
      {MODES.map((m) => (
        <button
          key={m}
          type="button"
          role="radio"
          aria-checked={mode === m}
          onClick={() => setMode(m)}
          className={cn(
            'flex h-8 items-center gap-1.5 rounded-md px-3 text-xs font-medium transition-colors',
            mode === m
              ? 'bg-card text-foreground shadow-xs'
              : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {MODE_ICONS[m]}
          <span>{THEME_MODE_LABELS[m]}</span>
        </button>
      ))}
    </div>
  );
}

export default function ThemeSwitcher({ className }: ThemeSwitcherProps) {
  return (
    <div className={cn('space-y-2', className)}>
      <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <Sun className="h-3.5 w-3.5" aria-hidden />
        الوضع المظهري
      </p>
      <ThemeModeSwitch />
      <p className="text-xs text-muted-foreground">
        الوضع الفاتح هو الافتراضي. ألوان هوية النشاط ستُضبط من إعدادات الهوية لاحقاً.
      </p>
    </div>
  );
}

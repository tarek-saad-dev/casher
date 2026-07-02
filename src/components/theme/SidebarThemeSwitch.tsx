'use client';

import { useTheme } from '@/hooks/useTheme';
import { Sun, Moon, Monitor } from 'lucide-react';
import { cn } from '@/lib/utils';

const MODES = [
  { id: 'light', icon: Sun },
  { id: 'dark', icon: Moon },
  { id: 'system', icon: Monitor },
] as const;

export default function SidebarThemeSwitch() {
  const { mode, setMode } = useTheme();

  return (
    <div className="flex items-center justify-center gap-1 rounded-lg border border-sidebar-border bg-sidebar-hover p-1">
      {MODES.map((m) => {
        const Icon = m.icon;
        const active = mode === m.id;
        return (
          <button
            key={m.id}
            type="button"
            onClick={() => setMode(m.id)}
            className={cn(
              'flex h-6 w-6 items-center justify-center rounded-md transition-colors',
              active
                ? 'bg-sidebar-active text-sidebar-active-foreground'
                : 'text-sidebar-foreground hover:bg-sidebar-active/50'
            )}
            title={m.id === 'light' ? 'فاتح' : m.id === 'dark' ? 'داكن' : 'النظام'}
          >
            <Icon className="h-3.5 w-3.5" />
          </button>
        );
      })}
    </div>
  );
}

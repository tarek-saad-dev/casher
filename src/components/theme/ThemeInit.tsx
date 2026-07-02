import { cookies } from 'next/headers';
import {
  DEFAULT_THEME_CONFIG,
  parseThemeCookie,
  resolveThemeMode,
  THEME_MODE_COOKIE,
  THEME_PALETTE_COOKIE,
} from '@/lib/theme';

/**
 * Server-side theme initializer.
 * Reads the theme cookie and renders:
 *  1. A style tag that applies the initial CSS variables.
 *  2. The correct class on <html> to avoid hydration flash.
 *
 * Use this inside the root layout <head>.
 */
export async function ThemeInit() {
  const jar = await cookies();
  const cookieHeader = jar.toString();
  const config = parseThemeCookie(cookieHeader);
  const mode = resolveThemeMode(config.mode);
  const palette = config.palette;

  // Build a CSS string that matches the palette/mode variables used by ThemeProvider.
  // We inject the variables on the root so the first paint is already themed.
  const modeVars = mode === 'dark'
    ? `--background:#0A0A0B;--foreground:#F7F1E5;--surface:#111114;--surface-muted:#1A1A1F;--surface-elevated:#16161A;--card:#111114;--card-foreground:#F7F1E5;--popover:#111114;--popover-foreground:#F7F1E5;--muted:#1A1A1F;--muted-foreground:#A7A29A;--border:#2A2A30;--input:#2A2A30;--ring:#A7A29A;--topbar-background:#111114;--topbar-foreground:#F7F1E5;--topbar-border:#2A2A30;--sidebar-background:#111114;--sidebar-foreground:#F7F1E5;--sidebar-hover:#1A1A1F;--sidebar-active:#2A2A30;--sidebar-active-foreground:#F7F1E5;--sidebar-border:#2A2A30;`
    : `--background:#FFFFFF;--foreground:#18181B;--surface:#FAFAFA;--surface-muted:#F4F4F5;--surface-elevated:#FFFFFF;--card:#FFFFFF;--card-foreground:#18181B;--popover:#FFFFFF;--popover-foreground:#18181B;--muted:#F4F4F5;--muted-foreground:#71717A;--border:#E4E4E7;--input:#E4E4E7;--ring:#A1A1AA;--topbar-background:#F4F4F5;--topbar-foreground:#27272A;--topbar-border:#E4E4E7;--sidebar-background:#F4F4F5;--sidebar-foreground:#18181B;--sidebar-hover:#E4E4E7;--sidebar-active:#D4D4D8;--sidebar-active-foreground:#18181B;--sidebar-border:#E4E4E7;`;

  const paletteVarsMap: Record<string, string> = {
    'cut-gold': `--primary:#D6A84F;--primary-hover:#E4BE6C;--primary-active:#EBCE89;--primary-foreground:#0A0A0B;--secondary:#2A2A30;--secondary-hover:#3A3A45;--secondary-foreground:#F7F1E5;--accent:#E4BE6C;--accent-foreground:#0A0A0B;--success:#34D399;--success-foreground:#0A0A0B;--warning:#FBBF24;--warning-foreground:#0A0A0B;--destructive:#F87171;--destructive-foreground:#0A0A0B;--info:#60A5FA;--info-foreground:#0A0A0B;--chart-1:#D6A84F;--chart-2:#FBBF24;--chart-3:#34D399;--chart-4:#60A5FA;--chart-5:#F87171;--chart-6:#A78BFA;`,
    emerald: `--primary:#10B981;--primary-hover:#34D399;--primary-active:#6EE7B7;--primary-foreground:#FFFFFF;--secondary:#064E3B;--secondary-hover:#065F46;--secondary-foreground:#F7F1E5;--accent:#34D399;--accent-foreground:#0A0A0B;--success:#34D399;--success-foreground:#0A0A0B;--warning:#FBBF24;--warning-foreground:#0A0A0B;--destructive:#F87171;--destructive-foreground:#0A0A0B;--info:#60A5FA;--info-foreground:#0A0A0B;--chart-1:#10B981;--chart-2:#34D399;--chart-3:#FBBF24;--chart-4:#60A5FA;--chart-5:#F87171;--chart-6:#A78BFA;`,
    'royal-blue': `--primary:#3B82F6;--primary-hover:#60A5FA;--primary-active:#93C5FD;--primary-foreground:#FFFFFF;--secondary:#1E3A8A;--secondary-hover:#1E40AF;--secondary-foreground:#F7F1E5;--accent:#60A5FA;--accent-foreground:#0A0A0B;--success:#34D399;--success-foreground:#0A0A0B;--warning:#FBBF24;--warning-foreground:#0A0A0B;--destructive:#F87171;--destructive-foreground:#0A0A0B;--info:#60A5FA;--info-foreground:#0A0A0B;--chart-1:#3B82F6;--chart-2:#60A5FA;--chart-3:#34D399;--chart-4:#FBBF24;--chart-5:#F87171;--chart-6:#A78BFA;`,
    burgundy: `--primary:#9F1239;--primary-hover:#BE123C;--primary-active:#E11D48;--primary-foreground:#FFFFFF;--secondary:#4C0519;--secondary-hover:#5C0A22;--secondary-foreground:#F7F1E5;--accent:#E11D48;--accent-foreground:#FFFFFF;--success:#34D399;--success-foreground:#0A0A0B;--warning:#FBBF24;--warning-foreground:#0A0A0B;--destructive:#F87171;--destructive-foreground:#0A0A0B;--info:#60A5FA;--info-foreground:#0A0A0B;--chart-1:#9F1239;--chart-2:#E11D48;--chart-3:#34D399;--chart-4:#FBBF24;--chart-5:#F87171;--chart-6:#A78BFA;`,
    graphite: `--primary:#6B7280;--primary-hover:#9CA3AF;--primary-active:#D1D5DB;--primary-foreground:#FFFFFF;--secondary:#27272A;--secondary-hover:#3F3F46;--secondary-foreground:#F7F1E5;--accent:#9CA3AF;--accent-foreground:#0A0A0B;--success:#34D399;--success-foreground:#0A0A0B;--warning:#FBBF24;--warning-foreground:#0A0A0B;--destructive:#F87171;--destructive-foreground:#0A0A0B;--info:#60A5FA;--info-foreground:#0A0A0B;--chart-1:#6B7280;--chart-2:#9CA3AF;--chart-3:#34D399;--chart-4:#FBBF24;--chart-5:#F87171;--chart-6:#A78BFA;`,
  };

  const paletteVars = paletteVarsMap[palette] ?? paletteVarsMap['cut-gold'];

  return (
    <>
      <style
        id="theme-init"
        dangerouslySetInnerHTML={{
          __html: `:root{${modeVars}${paletteVars}}`,
        }}
      />
      <script
        id="theme-init-script"
        dangerouslySetInnerHTML={{
          __html: `
            (function() {
              try {
                var html = document.documentElement;
                html.classList.remove('light', 'dark');
                html.classList.add('${mode}');
                html.setAttribute('data-theme-mode', '${mode}');
                html.setAttribute('data-theme-palette', '${palette}');
              } catch (e) {}
            })();
          `,
        }}
      />
    </>
  );
}

export { THEME_MODE_COOKIE, THEME_PALETTE_COOKIE, DEFAULT_THEME_CONFIG };

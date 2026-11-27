import { cookies } from 'next/headers';
import {
  DEFAULT_THEME_CONFIG,
  getThemeTokens,
  parseThemeCookie,
  resolveThemeMode,
  themeTokensToCss,
  THEME_MODE_COOKIE,
  THEME_PALETTE_COOKIE,
} from '@/lib/theme';

/**
 * Server-side theme initializer (first paint).
 *  1. Emits the resolved DRVO tokens on :root so the first paint is themed.
 *     Values come from `lib/theme.ts` — never duplicate them here.
 *  2. The html `light|dark` class is rendered by the root layout on the server.
 *     For `system` mode the server cannot know the OS preference, so a small
 *     synchronous inline head script resolves the class before body paint.
 *     Both token sets are already available in the stylesheet for system mode.
 */
export async function ThemeInit() {
  const jar = await cookies();
  const config = parseThemeCookie(jar.toString());
  const mode = resolveThemeMode(config.mode);
  const followSystem = config.mode === 'system';
  const css = `:root{${themeTokensToCss(getThemeTokens(mode, config.palette))}color-scheme:${mode};}`;
  const systemDarkCss = followSystem
    ? `:root.dark{${themeTokensToCss(getThemeTokens('dark', config.palette))}color-scheme:dark;}`
    : '';

  return (
    <>
      <style
        id="theme-init"
        dangerouslySetInnerHTML={{ __html: css + systemDarkCss }}
      />
      {followSystem ? (
        <script
          id="theme-init-script"
          dangerouslySetInnerHTML={{
            __html: `
              (function() {
                try {
                  var dark = window.matchMedia('(prefers-color-scheme: dark)').matches;
                  var mode = dark ? 'dark' : 'light';
                  var html = document.documentElement;
                  html.classList.remove('light', 'dark');
                  html.classList.add(mode);
                  html.setAttribute('data-theme-mode', mode);
                } catch (e) {}
              })();
            `,
          }}
        />
      ) : null}
    </>
  );
}

export { THEME_MODE_COOKIE, THEME_PALETTE_COOKIE, DEFAULT_THEME_CONFIG };

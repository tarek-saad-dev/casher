import { cookies } from 'next/headers';
import Script from 'next/script';
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
 *     next/script resolves it on the client (ThemeProvider then applies tokens).
 */
export async function ThemeInit() {
  const jar = await cookies();
  const config = parseThemeCookie(jar.toString());
  const mode = resolveThemeMode(config.mode);
  const css = themeTokensToCss(getThemeTokens(mode, config.palette));
  const followSystem = config.mode === 'system';

  return (
    <>
      <style
        id="theme-init"
        dangerouslySetInnerHTML={{ __html: `:root{${css}color-scheme:${mode};}` }}
      />
      {followSystem ? (
        <Script
          id="theme-init-script"
          strategy="afterInteractive"
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

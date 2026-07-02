'use client';

import {
  createContext,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  type ThemeConfig,
  type ThemeMode,
  type ThemePalette,
  DEFAULT_THEME_CONFIG,
  applyThemeColors,
  loadThemeConfig,
  saveThemeConfig,
  resolveThemeMode,
  THEME_MODE_COOKIE,
  THEME_PALETTE_COOKIE,
} from '@/lib/theme';

interface ThemeContextValue extends ThemeConfig {
  resolvedMode: 'light' | 'dark';
  setMode: (mode: ThemeMode) => void;
  setPalette: (palette: ThemePalette) => void;
  setTheme: (config: ThemeConfig) => void;
  isReady: boolean;
}

export const ThemeContext = createContext<ThemeContextValue>({
  ...DEFAULT_THEME_CONFIG,
  resolvedMode: 'dark',
  setMode: () => {},
  setPalette: () => {},
  setTheme: () => {},
  isReady: false,
});

interface ThemeProviderProps {
  children: ReactNode;
  /** Initial config from the server (cookie). Falls back to defaults. */
  initialConfig?: ThemeConfig;
}

export default function ThemeProvider({ children, initialConfig }: ThemeProviderProps) {
  const [config, setConfig] = useState<ThemeConfig>(initialConfig ?? DEFAULT_THEME_CONFIG);
  const [isReady, setIsReady] = useState(false);

  const apply = useCallback((next: ThemeConfig) => {
    applyThemeColors(next.mode, next.palette);
  }, []);

  // On mount, load persisted config from localStorage and apply it.
  useEffect(() => {
    const persisted = loadThemeConfig();
    setConfig(persisted);
    apply(persisted);
    setIsReady(true);
  }, [apply]);

  // Keep colors in sync when config changes (covers initial server config too).
  useEffect(() => {
    apply(config);
  }, [apply, config]);

  // Listen for system preference changes when mode is 'system'.
  useEffect(() => {
    if (config.mode !== 'system') return;
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const listener = () => apply(config);
    media.addEventListener('change', listener);
    return () => media.removeEventListener('change', listener);
  }, [apply, config]);

  const setCookie = useCallback((config: ThemeConfig) => {
    if (typeof document === 'undefined') return;
    const maxAge = 60 * 60 * 24 * 365;
    document.cookie = `${THEME_MODE_COOKIE}=${config.mode};path=/;max-age=${maxAge};SameSite=Lax`;
    document.cookie = `${THEME_PALETTE_COOKIE}=${config.palette};path=/;max-age=${maxAge};SameSite=Lax`;
  }, []);

  const setMode = useCallback(
    (mode: ThemeMode) => {
      setConfig((prev) => {
        const next = { ...prev, mode };
        saveThemeConfig(next);
        setCookie(next);
        return next;
      });
    },
    [setCookie]
  );

  const setPalette = useCallback(
    (palette: ThemePalette) => {
      setConfig((prev) => {
        const next = { ...prev, palette };
        saveThemeConfig(next);
        setCookie(next);
        return next;
      });
    },
    [setCookie]
  );

  const setTheme = useCallback((next: ThemeConfig) => {
    saveThemeConfig(next);
    setCookie(next);
    setConfig(next);
  }, [setCookie]);

  const resolvedMode = resolveThemeMode(config.mode);

  const value = useMemo(
    () => ({
      ...config,
      resolvedMode,
      setMode,
      setPalette,
      setTheme,
      isReady,
    }),
    [config, resolvedMode, setMode, setPalette, setTheme, isReady]
  );

  return (
    <ThemeContext.Provider value={value}>
      {children}
    </ThemeContext.Provider>
  );
}

export { THEME_MODE_COOKIE, THEME_PALETTE_COOKIE };

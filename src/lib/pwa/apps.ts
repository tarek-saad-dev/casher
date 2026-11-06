export type CutPwaAppId = 'cut-system' | 'cut-staff';

export type CutPwaAppConfig = {
  id: CutPwaAppId;
  /** Stable Web App Manifest identity (same-origin URL form). */
  manifestId: string;
  name: string;
  shortName: string;
  description: string;
  startUrl: string;
  scope: string;
  manifestUrl: string;
  serviceWorkerUrl: string;
  themeColor: string;
  backgroundColor: string;
  icon192: string;
  icon512: string;
  appleTouchIcon: string;
};

export const CUT_SYSTEM_PWA: CutPwaAppConfig = {
  id: 'cut-system',
  manifestId: '/apps/cut-system',
  name: 'CUT SYSTEM',
  shortName: 'CUT SYSTEM',
  description: 'CUT Salon POS and admin system',
  startUrl: '/',
  scope: '/',
  manifestUrl: '/manifests/cut-system.webmanifest',
  serviceWorkerUrl: '/sw-cut-system.js',
  themeColor: '#0B1220',
  backgroundColor: '#0B1220',
  icon192: '/icons/cut-system/icon-192.png',
  icon512: '/icons/cut-system/icon-512.png',
  appleTouchIcon: '/icons/cut-system/apple-touch-icon.png',
};

export const CUT_STAFF_PWA: CutPwaAppConfig = {
  id: 'cut-staff',
  manifestId: '/apps/cut-staff',
  name: 'CUT STAFF',
  shortName: 'CUT STAFF',
  description: 'CUT Salon employee portal',
  startUrl: '/employee-portal',
  scope: '/employee-portal',
  manifestUrl: '/employee-portal/manifest.webmanifest',
  serviceWorkerUrl: '/employee-portal/sw.js',
  themeColor: '#1A140C',
  backgroundColor: '#0D0D11',
  icon192: '/icons/cut-staff/icon-192.png',
  icon512: '/icons/cut-staff/icon-512.png',
  appleTouchIcon: '/icons/cut-staff/apple-touch-icon.png',
};

export function resolveCutPwaApp(pathname: string | null | undefined): CutPwaAppConfig {
  const path = pathname || '/';
  if (path === '/employee-portal' || path.startsWith('/employee-portal/')) {
    return CUT_STAFF_PWA;
  }
  return CUT_SYSTEM_PWA;
}

export function buildWebManifest(app: CutPwaAppConfig) {
  return {
    id: app.manifestId,
    name: app.name,
    short_name: app.shortName,
    description: app.description,
    start_url: app.startUrl,
    scope: app.scope,
    display: 'standalone' as const,
    orientation: 'any' as const,
    lang: 'ar',
    dir: 'rtl' as const,
    theme_color: app.themeColor,
    background_color: app.backgroundColor,
    icons: [
      {
        src: app.icon192,
        sizes: '192x192',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: app.icon512,
        sizes: '512x512',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: app.icon512,
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  };
}

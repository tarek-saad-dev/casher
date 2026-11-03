import type { Metadata, Viewport } from 'next';
import { CUT_STAFF_PWA } from '@/lib/pwa/apps';

export const metadata: Metadata = {
  applicationName: CUT_STAFF_PWA.name,
  title: {
    absolute: CUT_STAFF_PWA.name,
    template: `%s · ${CUT_STAFF_PWA.shortName}`,
  },
  description: CUT_STAFF_PWA.description,
  manifest: CUT_STAFF_PWA.manifestUrl,
  appleWebApp: {
    capable: true,
    title: CUT_STAFF_PWA.shortName,
    statusBarStyle: 'black-translucent',
  },
  icons: {
    apple: CUT_STAFF_PWA.appleTouchIcon,
    icon: [
      { url: CUT_STAFF_PWA.icon192, sizes: '192x192', type: 'image/png' },
      { url: CUT_STAFF_PWA.icon512, sizes: '512x512', type: 'image/png' },
    ],
  },
  other: {
    'mobile-web-app-capable': 'yes',
  },
};

export const viewport: Viewport = {
  themeColor: CUT_STAFF_PWA.themeColor,
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

export default function EmployeePortalLayout({ children }: { children: React.ReactNode }) {
  return children;
}

'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { resolveCutPwaApp, type CutPwaAppConfig } from '@/lib/pwa/apps';

function upsertLink(rel: string, href: string, attrs: Record<string, string> = {}) {
  const selector = Object.entries(attrs).reduce(
    (acc, [key, value]) => `${acc}[${key}="${value}"]`,
    `link[rel="${rel}"]`,
  );
  let link = document.head.querySelector<HTMLLinkElement>(selector);
  if (!link) {
    link = document.createElement('link');
    link.rel = rel;
    for (const [key, value] of Object.entries(attrs)) {
      link.setAttribute(key, value);
    }
    document.head.appendChild(link);
  }
  if (link.href !== new URL(href, window.location.origin).href) {
    link.href = href;
  }
}

function upsertMeta(name: string, content: string) {
  let meta = document.head.querySelector<HTMLMetaElement>(`meta[name="${name}"]`);
  if (!meta) {
    meta = document.createElement('meta');
    meta.name = name;
    document.head.appendChild(meta);
  }
  if (meta.content !== content) meta.content = content;
}

function applyDocumentHead(app: CutPwaAppConfig) {
  upsertLink('manifest', app.manifestUrl);
  upsertLink('apple-touch-icon', app.appleTouchIcon);
  upsertMeta('theme-color', app.themeColor);
  upsertMeta('apple-mobile-web-app-capable', 'yes');
  upsertMeta('apple-mobile-web-app-title', app.shortName);
  upsertMeta('mobile-web-app-capable', 'yes');
  upsertMeta('application-name', app.shortName);
}

async function registerServiceWorker(app: CutPwaAppConfig) {
  if (!('serviceWorker' in navigator)) return;
  try {
    await navigator.serviceWorker.register(app.serviceWorkerUrl, {
      scope: app.scope,
      updateViaCache: 'none',
    });
  } catch (error) {
    console.warn(`[pwa] failed to register ${app.id}`, error);
  }
}

export default function PwaBootstrap() {
  const pathname = usePathname();
  const app = resolveCutPwaApp(pathname);

  useEffect(() => {
    applyDocumentHead(app);
    void registerServiceWorker(app);
  }, [app]);

  return null;
}

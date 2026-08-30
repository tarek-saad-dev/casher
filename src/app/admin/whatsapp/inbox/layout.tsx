'use client';

import { useLayoutEffect, useRef } from 'react';

/**
 * Lock the Inbox shell to the remaining viewport below ERP chrome.
 * Height is measured from the shell’s top edge → window bottom so chat
 * history can never grow the page / scroll `<main>`.
 */
export default function WhatsAppInboxLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const shellRef = useRef<HTMLDivElement | null>(null);

  useLayoutEffect(() => {
    const shell = shellRef.current;
    if (!shell) return;

    const main = document.querySelector('main');
    const prevMainOverflow =
      main instanceof HTMLElement ? main.style.overflow : null;
    if (main instanceof HTMLElement) {
      main.style.overflow = 'hidden';
    }

    const syncHeight = () => {
      const top = shell.getBoundingClientRect().top;
      const next = Math.max(240, Math.floor(window.innerHeight - top));
      shell.style.height = `${next}px`;
      shell.style.maxHeight = `${next}px`;
    };

    syncHeight();
    window.addEventListener('resize', syncHeight);
    const ro =
      typeof ResizeObserver !== 'undefined'
        ? new ResizeObserver(syncHeight)
        : null;
    if (main) ro?.observe(main);
    else ro?.observe(document.body);

    return () => {
      window.removeEventListener('resize', syncHeight);
      ro?.disconnect();
      if (main instanceof HTMLElement && prevMainOverflow != null) {
        main.style.overflow = prevMainOverflow;
      }
    };
  }, []);

  return (
    <div
      ref={shellRef}
      className="-m-6 flex min-h-0 flex-col overflow-hidden"
    >
      {children}
    </div>
  );
}

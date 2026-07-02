'use client';

import { useEffect } from 'react';

export default function AutoPrint({ filename }: { filename: string }) {
  useEffect(() => {
    document.title = filename;
    const timer = setTimeout(() => window.print(), 400);
    return () => clearTimeout(timer);
  }, [filename]);

  return null;
}

'use client';

import { createPortal } from 'react-dom';
import { useEffect, useState } from 'react';
import TopNav from './TopNav';

export default function TopNavPortal() {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) return null;

  return createPortal(
    <div
      style={{
        position: 'fixed',
        top: 84,
        left: 0,
        right: 215,      // sidebar width
        zIndex: 9999,
        pointerEvents: 'none',
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'flex-start',
      }}
    >
      <div style={{ pointerEvents: 'auto' }}>
        <TopNav />
      </div>
    </div>,
    document.body
  );
}

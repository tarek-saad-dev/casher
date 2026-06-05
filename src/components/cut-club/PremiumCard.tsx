'use client';

import { ReactNode } from 'react';

interface PremiumCardProps {
  children: ReactNode;
  className?: string;
  noPadding?: boolean;
  hover?: boolean;
}

export default function PremiumCard({
  children,
  className = '',
  noPadding = false,
  hover = false,
}: PremiumCardProps) {
  return (
    <div
      className={`
        relative overflow-hidden rounded-xl border border-zinc-800/50 
        bg-gradient-to-br from-zinc-900/90 to-zinc-900/50 backdrop-blur-sm
        ${hover ? 'transition-all hover:border-zinc-700/50 hover:shadow-lg hover:shadow-yellow-500/5' : ''}
        ${noPadding ? '' : 'p-6'}
        ${className}
      `}
    >
      {children}
      <div className="pointer-events-none absolute -right-8 -top-8 h-32 w-32 rounded-full bg-gradient-to-br from-yellow-500/3 to-transparent blur-3xl" />
    </div>
  );
}

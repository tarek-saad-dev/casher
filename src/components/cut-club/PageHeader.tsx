'use client';

import { LucideIcon } from 'lucide-react';
import { ReactNode } from 'react';

interface PageHeaderProps {
  icon: LucideIcon;
  title: string;
  description: string;
  actions?: ReactNode;
  gradient?: string;
}

export default function PageHeader({
  icon: Icon,
  title,
  description,
  actions,
  gradient = 'from-yellow-500/20 to-amber-600/20',
}: PageHeaderProps) {
  return (
    <div className="border-b border-zinc-800 bg-[#0a0a0a]/80 backdrop-blur sticky top-0 z-10">
      <div className="px-4 sm:px-6 py-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div
              className={`flex h-14 w-14 items-center justify-center rounded-xl bg-gradient-to-br ${gradient} border border-yellow-500/30`}
            >
              <Icon className="h-7 w-7 text-yellow-500" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-white">{title}</h1>
              <p className="text-sm text-zinc-400 mt-1">{description}</p>
            </div>
          </div>
          {actions && <div className="flex items-center gap-2">{actions}</div>}
        </div>
      </div>
    </div>
  );
}

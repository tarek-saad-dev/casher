'use client';

import { LucideIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
}

export default function EmptyState({
  icon: Icon,
  title,
  description,
  actionLabel,
  onAction,
}: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-4">
      <div className="flex h-20 w-20 items-center justify-center rounded-full bg-zinc-800/50 border border-zinc-700/50">
        <Icon className="h-10 w-10 text-zinc-500" />
      </div>
      <h3 className="mt-6 text-lg font-semibold text-white">{title}</h3>
      <p className="mt-2 text-sm text-zinc-400 text-center max-w-md">{description}</p>
      {actionLabel && onAction && (
        <Button
          onClick={onAction}
          className="mt-6 bg-yellow-500 hover:bg-yellow-600 text-black font-semibold"
        >
          {actionLabel}
        </Button>
      )}
    </div>
  );
}

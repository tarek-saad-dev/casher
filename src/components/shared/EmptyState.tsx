'use client';

import { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { FileX, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface EmptyStateProps {
  title: string;
  description?: string;
  icon?: ReactNode;
  action?: {
    label: string;
    onClick: () => void;
  };
  className?: string;
}

export default function EmptyState({
  title,
  description,
  icon,
  action,
  className,
}: EmptyStateProps) {
  return (
    <div className={cn(
      'flex flex-col items-center justify-center py-16 px-4 text-center',
      className
    )}>
      <div className="flex items-center justify-center w-16 h-16 rounded-2xl bg-zinc-800/50 mb-4">
        {icon || <FileX className="w-8 h-8 text-zinc-500" />}
      </div>
      <h3 className="text-lg font-semibold text-white mb-2">{title}</h3>
      {description && (
        <p className="text-sm text-zinc-400 max-w-md mb-6">{description}</p>
      )}
      {action && (
        <Button onClick={action.onClick} className="gap-2">
          <Plus className="w-4 h-4" />
          {action.label}
        </Button>
      )}
    </div>
  );
}

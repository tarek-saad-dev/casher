'use client';

import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { FileX, Lock, Plus, SearchX, TriangleAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';

type EmptyKind = 'empty' | 'no-results' | 'error' | 'no-access';

interface EmptyStateProps {
  title: string;
  description?: string;
  icon?: ReactNode;
  /**
   * Distinguish WHY nothing is shown (ADR app-shell state matrix):
   * empty = no records yet · no-results = filters matched nothing ·
   * error = failed to load · no-access = missing permission.
   */
  kind?: EmptyKind;
  action?: {
    label: string;
    onClick: () => void;
  };
  className?: string;
}

const KIND_ICON: Record<EmptyKind, ReactNode> = {
  empty: <FileX className="size-6" aria-hidden />,
  'no-results': <SearchX className="size-6" aria-hidden />,
  error: <TriangleAlert className="size-6" aria-hidden />,
  'no-access': <Lock className="size-6" aria-hidden />,
};

const KIND_TONE: Record<EmptyKind, string> = {
  empty: 'bg-brand-soft text-brand',
  'no-results': 'bg-muted text-muted-foreground',
  error: 'bg-destructive-soft text-destructive',
  'no-access': 'bg-warning-soft text-warning',
};

export default function EmptyState({ title, description, icon, kind = 'empty', action, className }: EmptyStateProps) {
  return (
    <div
      role={kind === 'error' ? 'alert' : undefined}
      className={cn('flex flex-col items-center justify-center px-4 py-12 text-center', className)}
    >
      <div className={cn('mb-3 flex size-12 items-center justify-center rounded-xl', KIND_TONE[kind])}>
        {icon || KIND_ICON[kind]}
      </div>
      <h3 className="mb-1 text-base font-bold text-foreground">{title}</h3>
      {description && <p className="mb-5 max-w-md text-sm text-muted-foreground">{description}</p>}
      {action && (
        <Button onClick={action.onClick}>
          {kind === 'empty' ? <Plus aria-hidden /> : null}
          {action.label}
        </Button>
      )}
    </div>
  );
}

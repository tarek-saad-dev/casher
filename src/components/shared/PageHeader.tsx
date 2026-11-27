'use client';

import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface PageHeaderProps {
  title: string;
  description?: string;
  /** Primary + secondary actions. Keep ONE primary (Teal) action. */
  children?: ReactNode;
  /** Optional small context line above the title (e.g. module › section). */
  eyebrow?: ReactNode;
  /** Optional icon shown beside the title. */
  icon?: ReactNode;
  /** Optional status / meta row under the title (StatusPill, counts …). */
  meta?: ReactNode;
  className?: string;
}

/** Standard work-area header: identity + state + actions in the first viewport. */
export default function PageHeader({ title, description, children, eyebrow, icon, meta, className }: PageHeaderProps) {
  return (
    <header className={cn('mb-5', className)}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          {icon ? (
            <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-brand-soft text-brand [&_svg]:size-5">
              {icon}
            </div>
          ) : null}
          <div className="min-w-0">
            {eyebrow ? <div className="mb-0.5 text-xs font-medium text-muted-foreground">{eyebrow}</div> : null}
            <h1 className="text-xl font-bold leading-tight tracking-tight text-foreground">{title}</h1>
            {description ? <p className="mt-1 text-sm text-muted-foreground">{description}</p> : null}
            {meta ? <div className="mt-2 flex flex-wrap items-center gap-2">{meta}</div> : null}
          </div>
        </div>
        {children ? <div className="flex shrink-0 flex-wrap items-center gap-2">{children}</div> : null}
      </div>
    </header>
  );
}

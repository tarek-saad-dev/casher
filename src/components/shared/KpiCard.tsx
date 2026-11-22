'use client';

import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react';

interface KpiCardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  icon?: ReactNode;
  trend?: 'up' | 'down' | 'neutral';
  trendValue?: string;
  className?: string;
  variant?: 'default' | 'primary' | 'success' | 'warning' | 'danger' | 'info';
}

const iconStyles = {
  default: 'bg-muted text-muted-foreground',
  primary: 'bg-brand-soft text-brand',
  success: 'bg-success-soft text-success',
  warning: 'bg-warning-soft text-warning',
  danger: 'bg-destructive-soft text-destructive',
  info: 'bg-info-soft text-info',
};

const accentStyles = {
  default: 'before:bg-border',
  primary: 'before:bg-brand',
  success: 'before:bg-success',
  warning: 'before:bg-warning',
  danger: 'before:bg-destructive',
  info: 'before:bg-info',
};

/** KPI tile. Only show verified numbers; pass a "—" value with a subtitle when data is missing. */
export default function KpiCard({
  title,
  value,
  subtitle,
  icon,
  trend,
  trendValue,
  className,
  variant = 'default',
}: KpiCardProps) {
  const TrendIcon = trend === 'up' ? ArrowUpRight : trend === 'down' ? ArrowDownRight : Minus;
  return (
    <div
      className={cn(
        'relative overflow-hidden rounded-xl border border-border bg-card p-4 shadow-xs',
        'before:absolute before:inset-y-3 before:start-0 before:w-[3px] before:rounded-full',
        accentStyles[variant],
        className,
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold text-muted-foreground">{title}</p>
          <p className="num mt-1.5 truncate text-2xl font-bold text-foreground">{value}</p>
          {subtitle && <p className="mt-0.5 text-xs text-muted-foreground">{subtitle}</p>}
          {trend && trendValue && (
            <div
              className={cn(
                'mt-1.5 inline-flex items-center gap-1 text-xs font-semibold',
                trend === 'up' && 'text-success',
                trend === 'down' && 'text-destructive',
                trend === 'neutral' && 'text-muted-foreground',
              )}
            >
              <TrendIcon className="size-3.5" aria-hidden />
              <span className="num">{trendValue}</span>
            </div>
          )}
        </div>
        {icon && (
          <div className={cn('flex size-9 shrink-0 items-center justify-center rounded-lg [&_svg]:size-4.5', iconStyles[variant])}>
            {icon}
          </div>
        )}
      </div>
    </div>
  );
}

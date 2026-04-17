'use client';

import { ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface KpiCardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  icon?: ReactNode;
  trend?: 'up' | 'down' | 'neutral';
  trendValue?: string;
  className?: string;
  variant?: 'default' | 'primary' | 'success' | 'warning' | 'danger';
}

const variantStyles = {
  default: 'bg-zinc-900/50 border-zinc-800/50',
  primary: 'bg-amber-500/5 border-amber-500/20',
  success: 'bg-emerald-500/5 border-emerald-500/20',
  warning: 'bg-yellow-500/5 border-yellow-500/20',
  danger: 'bg-rose-500/5 border-rose-500/20',
};

const iconStyles = {
  default: 'bg-zinc-800/50 text-zinc-400',
  primary: 'bg-amber-500/10 text-amber-400',
  success: 'bg-emerald-500/10 text-emerald-400',
  warning: 'bg-yellow-500/10 text-yellow-400',
  danger: 'bg-rose-500/10 text-rose-400',
};

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
  return (
    <div className={cn(
      'rounded-xl border p-4 transition-all duration-200 hover:border-zinc-700/50',
      variantStyles[variant],
      className
    )}>
      <div className="flex items-start justify-between">
        <div className="flex-1 min-w-0">
          <p className="text-xs font-medium text-zinc-500 uppercase tracking-wider">{title}</p>
          <p className="mt-2 text-2xl font-bold text-white truncate">{value}</p>
          {subtitle && (
            <p className="mt-1 text-xs text-zinc-400">{subtitle}</p>
          )}
          {trend && trendValue && (
            <div className={cn(
              'mt-2 flex items-center gap-1 text-xs',
              trend === 'up' && 'text-emerald-400',
              trend === 'down' && 'text-rose-400',
              trend === 'neutral' && 'text-zinc-400'
            )}>
              <span>{trend === 'up' ? '↑' : trend === 'down' ? '↓' : '→'}</span>
              <span>{trendValue}</span>
            </div>
          )}
        </div>
        {icon && (
          <div className={cn(
            'flex items-center justify-center w-10 h-10 rounded-lg shrink-0',
            iconStyles[variant]
          )}>
            {icon}
          </div>
        )}
      </div>
    </div>
  );
}

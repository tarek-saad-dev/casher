'use client';

import { LucideIcon } from 'lucide-react';

interface StatCardProps {
  title: string;
  value: string | number;
  icon: LucideIcon;
  trend?: {
    value: string;
    isPositive: boolean;
  };
  className?: string;
  iconColor?: string;
  iconBgColor?: string;
}

export default function StatCard({
  title,
  value,
  icon: Icon,
  trend,
  className = '',
  iconColor = 'text-yellow-400',
  iconBgColor = 'bg-yellow-500/10',
}: StatCardProps) {
  return (
    <div
      className={`relative overflow-hidden rounded-xl border border-zinc-800/50 bg-gradient-to-br from-zinc-900/90 to-zinc-900/50 p-6 backdrop-blur-sm transition-all hover:border-zinc-700/50 hover:shadow-lg hover:shadow-yellow-500/5 ${className}`}
    >
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <p className="text-sm font-medium text-zinc-400">{title}</p>
          <p className="mt-2 text-3xl font-bold text-white">{value}</p>
          {trend && (
            <div className="mt-2 flex items-center gap-1">
              <span
                className={`text-xs font-semibold ${trend.isPositive ? 'text-emerald-400' : 'text-red-400'
                  }`}
              >
                {trend.isPositive ? '↑' : '↓'} {trend.value}
              </span>
              <span className="text-xs text-zinc-500">vs last month</span>
            </div>
          )}
        </div>
        <div
          className={`flex h-12 w-12 items-center justify-center rounded-lg ${iconBgColor} border border-zinc-800/50`}
        >
          <Icon className={`h-6 w-6 ${iconColor}`} />
        </div>
      </div>
      <div className="absolute -right-4 -top-4 h-24 w-24 rounded-full bg-gradient-to-br from-yellow-500/5 to-transparent blur-2xl" />
    </div>
  );
}

'use client';

import { Badge } from '@/components/ui/badge';

interface TierBadgeProps {
  tier: 'BRONZE' | 'SILVER' | 'GOLD' | 'VIP' | string;
  size?: 'sm' | 'md' | 'lg';
}

const tierConfig = {
  BRONZE: {
    bg: 'bg-amber-700/20',
    text: 'text-amber-600',
    border: 'border-amber-700/30',
    glow: 'shadow-amber-500/20',
  },
  SILVER: {
    bg: 'bg-slate-400/20',
    text: 'text-slate-400',
    border: 'border-slate-400/30',
    glow: 'shadow-slate-400/20',
  },
  GOLD: {
    bg: 'bg-yellow-500/20',
    text: 'text-yellow-500',
    border: 'border-yellow-500/30',
    glow: 'shadow-yellow-500/20',
  },
  VIP: {
    bg: 'bg-purple-500/20',
    text: 'text-purple-400',
    border: 'border-purple-500/30',
    glow: 'shadow-purple-500/20',
  },
};

export default function TierBadge({ tier, size = 'md' }: TierBadgeProps) {
  const config = tierConfig[tier as keyof typeof tierConfig] || tierConfig.BRONZE;
  
  const sizeClasses = {
    sm: 'text-xs px-2 py-0.5',
    md: 'text-sm px-3 py-1',
    lg: 'text-base px-4 py-1.5',
  };

  return (
    <Badge
      className={`
        ${config.bg} ${config.text} ${config.border} ${config.glow}
        border font-semibold ${sizeClasses[size]}
        shadow-lg
      `}
    >
      {tier}
    </Badge>
  );
}

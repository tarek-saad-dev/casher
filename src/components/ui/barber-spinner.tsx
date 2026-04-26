'use client';

import { Loader2, Scissors } from 'lucide-react';
import { cn } from '@/lib/utils';

interface BarberSpinnerProps {
  size?: 'sm' | 'md' | 'lg';
  text?: string;
  className?: string;
}

export default function BarberSpinner({ size = 'md', text, className }: BarberSpinnerProps) {
  const sizeClasses = {
    sm: 'w-4 h-4',
    md: 'w-6 h-6',
    lg: 'w-8 h-8'
  };

  const textSizes = {
    sm: 'text-xs',
    md: 'text-sm',
    lg: 'text-base'
  };

  return (
    <div className={cn('flex items-center gap-2', className)}>
      <div className="relative">
        <Scissors className={cn('text-amber-500 animate-pulse', sizeClasses[size])} />
        <Loader2 className={cn('absolute inset-0 text-amber-600 animate-spin', sizeClasses[size])} />
      </div>
      {text && (
        <span className={cn('text-amber-200 font-medium', textSizes[size])}>
          {text}
        </span>
      )}
    </div>
  );
}

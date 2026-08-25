'use client';

import { cn } from '@/lib/utils';

export type MobileBarberSelection = number | 'all';

interface BarberOption {
  empId: number;
  empName: string;
}

interface Props {
  barbers: BarberOption[];
  selected: MobileBarberSelection;
  onSelect: (value: MobileBarberSelection) => void;
  className?: string;
}

export function BarberMobileSelector({ barbers, selected, onSelect, className }: Props) {
  if (barbers.length === 0) return null;

  return (
    <div className={cn('shrink-0', className)}>
      <div className="flex gap-1 overflow-x-auto pb-0.5 scrollbar-luxury [-ms-overflow-style:none] [scrollbar-width:thin]">
        <button
          type="button"
          onClick={() => onSelect('all')}
          className={cn(
            'shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-medium transition-colors md:px-4 md:py-2 md:text-sm md:font-semibold',
            selected === 'all'
              ? 'border-primary bg-primary/15 text-primary'
              : 'border-border bg-surface-muted/50 text-muted-foreground hover:bg-surface-muted',
          )}
        >
          عرض الكل
        </button>
        {barbers.map((barber) => (
          <button
            key={barber.empId}
            type="button"
            onClick={() => onSelect(barber.empId)}
            className={cn(
              'shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-medium transition-colors md:px-4 md:py-2 md:text-sm md:font-semibold',
              selected === barber.empId
                ? 'border-primary bg-primary/15 text-primary'
                : 'border-border bg-surface-muted/50 text-muted-foreground hover:bg-surface-muted',
            )}
          >
            {barber.empName}
          </button>
        ))}
      </div>
    </div>
  );
}

'use client';

import { User } from 'lucide-react';
import type { Barber } from '@/lib/types';

interface BarberGridProps {
  barbers: Barber[];
  selected: Barber | null;
  onSelect: (barber: Barber) => void;
}

const BARBER_COLORS = [
  'bg-blue-500/20 text-blue-400 border-blue-500/30',
  'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
  'bg-purple-500/20 text-purple-400 border-purple-500/30',
  'bg-amber-500/20 text-amber-400 border-amber-500/30',
  'bg-rose-500/20 text-rose-400 border-rose-500/30',
  'bg-cyan-500/20 text-cyan-400 border-cyan-500/30',
];

export default function BarberGrid({ barbers, selected, onSelect }: BarberGridProps) {
  return (
    <div>
      <h3 className="text-sm font-semibold text-muted-foreground mb-2">الحلاق</h3>
      <div className="grid grid-cols-4 gap-2">
        {barbers.map((b, idx) => {
          const isSelected = selected?.EmpID === b.EmpID;
          const colorClass = BARBER_COLORS[idx % BARBER_COLORS.length];
          return (
            <button
              key={b.EmpID}
              onClick={() => onSelect(b)}
              className={`
                flex flex-col items-center gap-1.5 p-3 rounded-lg border transition-all
                ${isSelected
                  ? 'border-primary bg-primary/10 ring-2 ring-primary/40 scale-[1.02]'
                  : `border-border hover:border-muted-foreground/30 hover:bg-accent ${colorClass}`
                }
              `}
            >
              <div className={`
                flex items-center justify-center w-10 h-10 rounded-full
                ${isSelected ? 'bg-primary text-primary-foreground' : colorClass}
              `}>
                <User className="w-5 h-5" />
              </div>
              <span className={`text-xs font-medium ${isSelected ? 'text-primary' : ''}`}>
                {b.EmpName}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

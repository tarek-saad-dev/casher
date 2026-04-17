'use client';

import { Banknote, CreditCard, Wallet } from 'lucide-react';
import type { PaymentMethod } from '@/lib/types';

interface PaymentMethodSelectProps {
  methods: PaymentMethod[];
  selected: number | null;
  onSelect: (id: number) => void;
}

const ICONS: Record<string, React.ReactNode> = {
  'كاش': <Banknote className="w-4 h-4" />,
  'فيزا': <CreditCard className="w-4 h-4" />,
};

export default function PaymentMethodSelect({ methods, selected, onSelect }: PaymentMethodSelectProps) {
  return (
    <div>
      <h3 className="text-sm font-semibold text-muted-foreground mb-2">طريقة الدفع</h3>
      <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-thin scrollbar-thumb-zinc-600 scrollbar-track-transparent">
        {methods.map((m) => {
          const isSelected = selected === m.ID;
          const icon = ICONS[m.Name] || <Wallet className="w-4 h-4" />;
          return (
            <button
              key={m.ID}
              onClick={() => onSelect(m.ID)}
              className={`
                flex-shrink-0 flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg border transition-all text-sm font-medium whitespace-nowrap
                ${isSelected
                  ? 'border-primary bg-primary/10 text-primary ring-2 ring-primary/30'
                  : 'border-border hover:border-muted-foreground/30 hover:bg-accent text-muted-foreground'
                }
              `}
            >
              {icon}
              {m.Name}
            </button>
          );
        })}
      </div>
    </div>
  );
}

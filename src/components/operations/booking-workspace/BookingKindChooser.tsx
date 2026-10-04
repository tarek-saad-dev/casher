'use client';

import { Package, Scissors, type LucideIcon } from 'lucide-react';
import { GOLD, GOLD_BG, type BookingKind } from './types';

const OPTIONS: Array<{ kind: BookingKind; title: string; description: string; Icon: LucideIcon }> = [
  {
    kind: 'services',
    title: 'حجز خدمات',
    description: 'اختر خدمة أو أكثر من قائمة الخدمات',
    Icon: Scissors,
  },
  {
    kind: 'package',
    title: 'حجز باكدجات',
    description: 'باكدج جاهز بسعر ومدة محددين',
    Icon: Package,
  },
];

export function BookingKindChooser({ onChoose }: { onChoose: (kind: BookingKind) => void }) {
  return (
    <div className="flex min-h-full items-center justify-center py-6">
      <div className="w-full max-w-2xl space-y-6">
        <div className="text-center">
          <h3 className="text-lg font-bold text-foreground">نوع الحجز</h3>
          <p className="text-xs text-muted-foreground mt-1">اختر طريقة الحجز للمتابعة</p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          {OPTIONS.map(({ kind, title, description, Icon }) => (
            <button
              key={kind}
              type="button"
              onClick={() => onChoose(kind)}
              className="flex flex-col items-center gap-4 rounded-2xl border border-border p-8 text-center min-h-[200px] transition-colors hover:border-primary/60 hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              <span
                className="flex size-16 items-center justify-center rounded-2xl"
                style={{ background: GOLD_BG, color: GOLD }}
              >
                <Icon size={30} aria-hidden />
              </span>
              <span className="text-lg font-bold text-foreground">{title}</span>
              <span className="text-xs text-muted-foreground">{description}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

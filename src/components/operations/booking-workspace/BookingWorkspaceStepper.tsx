'use client';

import { Check } from 'lucide-react';
import { BOOKING_STEPS, BORDER, GOLD, GOLD_BG, type BookingStep } from './types';

interface Props {
  step: BookingStep;
  summaries: Partial<Record<BookingStep, string | undefined>>;
  onGoToStep: (step: BookingStep) => void;
}

export function BookingWorkspaceStepper({ step, summaries, onGoToStep }: Props) {
  return (
    <nav className="hidden xl:flex flex-col w-56 shrink-0 border-l p-4 gap-1 overflow-y-auto" style={{ borderColor: BORDER }} aria-label="خطوات الحجز">
      {BOOKING_STEPS.map((s) => {
        const done = step > s.id;
        const active = step === s.id;
        const summary = summaries[s.id];
        return (
          <button
            key={s.id}
            type="button"
            disabled={s.id > step}
            onClick={() => done && onGoToStep(s.id)}
            className="text-right rounded-xl p-3 transition-all min-h-[56px] disabled:cursor-default"
            style={{
              background: active ? GOLD_BG : 'transparent',
              border: `1px solid ${active ? 'color-mix(in srgb, var(--primary) 35%, transparent)' : 'transparent'}`,
              opacity: s.id > step ? 0.45 : 1,
            }}
            aria-current={active ? 'step' : undefined}
          >
            <div className="flex items-center gap-2">
              <div
                className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0"
                style={{
                  background: done || active ? GOLD : BORDER,
                  color: done || active ? 'var(--primary-foreground)' : 'var(--muted-foreground)',
                }}
              >
                {done ? <Check className="w-3.5 h-3.5" /> : s.id}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-bold" style={{ color: active ? GOLD : 'var(--foreground)' }}>{s.label}</p>
                {summary && (
                  <p className="text-[11px] text-muted-foreground truncate mt-0.5">{summary}</p>
                )}
              </div>
            </div>
          </button>
        );
      })}
    </nav>
  );
}

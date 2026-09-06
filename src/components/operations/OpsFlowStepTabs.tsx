'use client';

import { cn } from '@/lib/utils';

export type OpsFlowStepTab = { id: number; label: string };

/**
 * Compact RTL step tabs used by Queue lane/general (and aligned with Booking chip language).
 * Replaces duplicated STEPS.map blocks that shared the same selected/done/muted styles.
 */
export function OpsFlowStepTabs({
  steps,
  step,
}: {
  steps: readonly OpsFlowStepTab[];
  step: number;
}) {
  return (
    <div className="mt-3 flex gap-2" role="list" aria-label="خطوات التدفق">
      {steps.map((s) => {
        const active = step === s.id;
        const done = step > s.id;
        return (
          <div
            key={s.id}
            role="listitem"
            aria-current={active ? 'step' : undefined}
            className={cn(
              'flex-1 rounded-lg border px-2 py-1.5 text-center text-xs font-semibold',
              active
                ? 'border-primary/50 bg-primary/10 text-primary'
                : done
                  ? 'border-success/30 bg-success/10 text-success'
                  : 'border-border text-muted-foreground',
            )}
          >
            {s.label}
          </div>
        );
      })}
    </div>
  );
}

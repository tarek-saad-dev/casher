'use client';

import { ChevronLeft, ChevronRight } from 'lucide-react';
import { BORDER, GOLD, type BookingStep } from './types';

interface Props {
  step: BookingStep;
  canGoBack: boolean;
  canProceed: boolean;
  isFinalStep: boolean;
  submitting: boolean;
  stepHint: string | null;
  onBack: () => void;
  onPrimary: () => void;
}

export function BookingWorkspaceFooter({
  step,
  canGoBack,
  canProceed,
  isFinalStep,
  submitting,
  stepHint,
  onBack,
  onPrimary,
}: Props) {
  return (
    <footer
      className="shrink-0 border-t px-4 py-3 sm:px-5 sm:py-4 flex items-center justify-between gap-3"
      style={{ borderColor: BORDER }}
    >
      <button
        type="button"
        onClick={onBack}
        disabled={!canGoBack || submitting}
        className="flex items-center gap-1 px-4 min-h-[48px] rounded-xl border text-sm font-semibold disabled:opacity-30 transition-opacity"
        style={{ borderColor: BORDER }}
      >
        <ChevronRight size={16} />
        رجوع
      </button>

      <div className="flex-1 text-center hidden sm:block lg:hidden">
        {stepHint && !canProceed && (
          <p className="text-xs text-muted-foreground">{stepHint}</p>
        )}
      </div>

      <button
        type="button"
        onClick={onPrimary}
        disabled={!canProceed || submitting}
        className="flex lg:hidden items-center gap-2 px-6 min-h-[48px] min-w-[140px] rounded-xl text-sm font-bold disabled:opacity-40 transition-opacity justify-center"
        style={{
          background: isFinalStep
            ? 'linear-gradient(135deg, var(--success), var(--success-active))'
            : `linear-gradient(135deg, ${GOLD}, var(--primary-active))`,
          color: isFinalStep ? 'var(--foreground)' : 'var(--primary-foreground)',
        }}
      >
        {submitting ? 'جاري...' : isFinalStep ? 'تأكيد الحجز' : 'التالي'}
        {!isFinalStep && !submitting && <ChevronLeft size={16} />}
      </button>
    </footer>
  );
}

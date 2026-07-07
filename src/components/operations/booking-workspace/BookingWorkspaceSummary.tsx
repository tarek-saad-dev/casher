'use client';

import { AlertTriangle, Loader2 } from 'lucide-react';
import {
  BORDER,
  GOLD,
  GOLD_BG,
  GOLD_BDR,
  SURFACE,
  type AvailableSlot,
  type BookingMode,
  type BookingService,
  type BookingStep,
  formatDateLabel,
  slotDisplayLabel,
} from './types';

interface Props {
  step: BookingStep;
  mode: BookingMode;
  bookingDate: string;
  selectedBarberName: string;
  selectedServices: BookingService[];
  totalDuration: number;
  totalPrice: number;
  selectedSlot: AvailableSlot | null;
  customerName: string;
  selectedClientName?: string;
  stepHint: string | null;
  error: string | null;
  canProceed: boolean;
  isFinalStep: boolean;
  submitting: boolean;
  onPrimary: () => void;
}

export function BookingWorkspaceSummary({
  step,
  mode,
  bookingDate,
  selectedBarberName,
  selectedServices,
  totalDuration,
  totalPrice,
  selectedSlot,
  customerName,
  selectedClientName,
  stepHint,
  error,
  canProceed,
  isFinalStep,
  submitting,
  onPrimary,
}: Props) {
  const customerDisplay = selectedClientName || customerName.trim();

  return (
    <aside
      className="hidden lg:flex flex-col w-72 xl:w-80 shrink-0 border-r p-4 gap-4 overflow-y-auto"
      style={{ borderColor: BORDER, background: 'color-mix(in srgb, var(--surface) 60%, transparent)' }}
      aria-label="ملخص الحجز"
    >
      <div>
        <p className="text-xs font-bold text-muted-foreground mb-2">الحالة الحالية</p>
        <p className="text-sm font-semibold text-foreground">
          الخطوة {step} من 5
        </p>
      </div>

      <div className="space-y-3 text-sm">
        <SummaryRow label="التاريخ" value={formatDateLabel(bookingDate)} />
        <SummaryRow
          label="الحلاق / الوضع"
          value={mode === 'nearest' ? 'أقرب حلاق متاح' : (selectedBarberName || '—')}
        />
        <div>
          <p className="text-xs text-muted-foreground mb-1">الخدمات</p>
          {selectedServices.length === 0 ? (
            <p className="text-xs text-muted-foreground">لم تُختر بعد</p>
          ) : (
            <ul className="space-y-1">
              {selectedServices.map((s, i) => (
                <li key={s.ProID} className="text-xs text-foreground">
                  {i + 1}. {s.ProName} — {s.DurationMinutes ?? 30} د
                </li>
              ))}
            </ul>
          )}
        </div>
        {selectedServices.length > 0 && (
          <>
            <SummaryRow label="المدة الإجمالية" value={`${totalDuration} دقيقة`} highlight />
            <SummaryRow label="السعر" value={`${totalPrice} ج.م`} highlight />
          </>
        )}
        <SummaryRow
          label="الموعد"
          value={selectedSlot ? slotDisplayLabel(selectedSlot) : '—'}
        />
        {selectedSlot && mode === 'nearest' && (
          <SummaryRow label="الحلاق" value={selectedSlot.barberName} />
        )}
        <SummaryRow label="العميل" value={customerDisplay || '—'} />
      </div>

      {(stepHint || error) && (
        <div
          className="flex gap-2 p-3 rounded-xl border text-xs"
          style={{
            borderColor: error ? 'color-mix(in srgb, var(--destructive) 35%, transparent)' : 'color-mix(in srgb, var(--warning) 35%, transparent)',
            background: error ? 'color-mix(in srgb, var(--destructive) 8%, transparent)' : 'color-mix(in srgb, var(--warning) 8%, transparent)',
          }}
        >
          <AlertTriangle size={14} className="shrink-0 mt-0.5" style={{ color: error ? 'var(--destructive)' : 'var(--warning)' }} />
          <p style={{ color: error ? 'var(--destructive)' : 'var(--warning)' }}>{error || stepHint}</p>
        </div>
      )}

      <div className="mt-auto pt-2">
        <button
          type="button"
          onClick={onPrimary}
          disabled={!canProceed || submitting}
          className="w-full min-h-[48px] rounded-xl text-sm font-bold disabled:opacity-40 flex items-center justify-center gap-2 transition-opacity"
          style={{
            background: isFinalStep
              ? 'linear-gradient(135deg, var(--success), var(--success-active))'
              : `linear-gradient(135deg, ${GOLD}, var(--primary-active))`,
            color: isFinalStep ? 'var(--foreground)' : 'var(--primary-foreground)',
          }}
        >
          {submitting ? (
            <><Loader2 size={16} className="animate-spin" /> جاري الحجز...</>
          ) : isFinalStep ? (
            'تأكيد الحجز'
          ) : (
            'التالي'
          )}
        </button>
      </div>
    </aside>
  );
}

function SummaryRow({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="flex justify-between gap-2 items-start">
      <span className="text-xs text-muted-foreground shrink-0">{label}</span>
      <span className="text-xs font-semibold text-right" style={{ color: highlight ? GOLD : 'var(--foreground)' }}>{value}</span>
    </div>
  );
}

/** Mobile/tablet sticky summary strip */
export function BookingWorkspaceSummaryMobile({
  totalDuration,
  totalPrice,
  selectedServicesCount,
  stepHint,
  canProceed,
  isFinalStep,
  submitting,
  onPrimary,
}: Pick<Props, 'totalDuration' | 'totalPrice' | 'stepHint' | 'canProceed' | 'isFinalStep' | 'submitting' | 'onPrimary'> & { selectedServicesCount: number }) {
  if (selectedServicesCount === 0 && !stepHint) return null;
  return (
    <div className="lg:hidden shrink-0 border-t px-4 py-2" style={{ borderColor: BORDER, background: SURFACE }}>
      <div className="flex items-center justify-between gap-2 text-xs mb-2">
        <span className="font-bold" style={{ color: GOLD }}>{totalDuration} د · {totalPrice} ج.م</span>
        {stepHint && <span className="text-warning truncate">{stepHint}</span>}
      </div>
      <button
        type="button"
        onClick={onPrimary}
        disabled={!canProceed || submitting}
        className="w-full min-h-[44px] rounded-xl text-sm font-bold disabled:opacity-40"
        style={{ background: `linear-gradient(135deg, ${GOLD}, var(--primary-active))`, color: 'var(--primary-foreground)' }}
      >
        {submitting ? 'جاري الحجز...' : isFinalStep ? 'تأكيد الحجز' : 'التالي'}
      </button>
    </div>
  );
}

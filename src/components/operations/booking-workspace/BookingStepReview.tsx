'use client';

import { AlertTriangle } from 'lucide-react';
import {
  BORDER,
  GOLD,
  SURFACE,
  type AvailableSlot,
  type BookingMode,
  type BookingService,
  formatDateLabel,
  slotDisplayLabel,
} from './types';

interface Props {
  mode: BookingMode;
  bookingDate: string;
  selectedBarberName: string;
  selectedServices: BookingService[];
  totalDuration: number;
  totalPrice: number;
  selectedSlot: AvailableSlot | null;
  customerName: string;
  customerPhone: string;
  selectedClientName?: string;
  notes: string;
  error: string | null;
}

export function BookingStepReview({
  mode,
  bookingDate,
  selectedBarberName,
  selectedServices,
  totalDuration,
  totalPrice,
  selectedSlot,
  customerName,
  customerPhone,
  selectedClientName,
  notes,
  error,
}: Props) {
  const customerDisplay = selectedClientName || customerName.trim();
  const phoneDisplay = customerPhone.trim();

  return (
    <div className="space-y-5 max-w-2xl">
      <div>
        <h3 className="text-base font-bold text-foreground">مراجعة الحجز</h3>
        <p className="text-xs text-muted-foreground mt-0.5">تأكد من البيانات قبل إنشاء الحجز</p>
      </div>

      <div className="rounded-2xl border p-5 space-y-4" style={{ borderColor: BORDER, background: SURFACE }}>
        <ReviewSection title="العميل">
          <p className="text-sm font-semibold">{customerDisplay || '—'}</p>
          {phoneDisplay && <p className="text-xs text-muted-foreground mt-0.5" dir="ltr">{phoneDisplay}</p>}
        </ReviewSection>

        <ReviewSection title="الحلاق / الوضع">
          <p className="text-sm font-semibold">
            {mode === 'nearest' ? `أقرب حلاق — ${selectedSlot?.barberName ?? '—'}` : selectedBarberName}
          </p>
        </ReviewSection>

        <ReviewSection title="التاريخ والموعد">
          <p className="text-sm">{formatDateLabel(bookingDate)}</p>
          <p className="text-base font-bold mt-1" style={{ color: GOLD }}>
            {selectedSlot ? slotDisplayLabel(selectedSlot) : '—'}
          </p>
        </ReviewSection>

        <ReviewSection title="الخدمات">
          <ol className="space-y-1 text-sm">
            {selectedServices.map((s, i) => (
              <li key={s.ProID}>
                {i + 1}. {s.ProName} — {s.DurationMinutes ?? 30} دقيقة
              </li>
            ))}
          </ol>
          <div className="flex justify-between mt-3 pt-3 border-t text-sm font-bold" style={{ borderColor: BORDER }}>
            <span style={{ color: GOLD }}>المدة: {totalDuration} دقيقة</span>
            <span style={{ color: GOLD }}>{totalPrice} ج.م</span>
          </div>
        </ReviewSection>

        {notes.trim() && (
          <ReviewSection title="ملاحظات">
            <p className="text-sm text-muted-foreground">{notes}</p>
          </ReviewSection>
        )}
      </div>

      {error && (
        <div className="flex gap-2 p-4 rounded-xl border border-destructive/30 bg-destructive/5">
          <AlertTriangle size={18} className="text-destructive shrink-0" />
          <p className="text-sm text-destructive">{error}</p>
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        سيتم التحقق من توفر الموعد مرة أخرى عند التأكيد.
      </p>
    </div>
  );
}

function ReviewSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs font-bold text-muted-foreground mb-1.5">{title}</p>
      {children}
    </div>
  );
}

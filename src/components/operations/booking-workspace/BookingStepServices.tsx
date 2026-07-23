'use client';

import { X } from 'lucide-react';
import { BookingServiceSelect } from '../BookingServiceSelect';
import { BORDER, GOLD, GOLD_BDR, type BookingService } from './types';

interface Props {
  services: BookingService[];
  selectedServices: BookingService[];
  serviceIds: number[];
  loadingServices: boolean;
  totalDuration: number;
  totalPrice: number;
  onSelectMain: (id: number) => void;
  onToggleAddon: (id: number) => void;
  onRemoveService: (id: number) => void;
}

export function BookingStepServices({
  services,
  selectedServices,
  serviceIds,
  loadingServices,
  totalDuration,
  totalPrice,
  onSelectMain,
  onToggleAddon,
  onRemoveService,
}: Props) {
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h3 className="text-base font-bold text-foreground">اختر الخدمات</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            خدمة أساسية و/أو إضافات — أو إضافات فقط · المدة تحدد المواعيد المتاحة
          </p>
        </div>
        {selectedServices.length > 0 && (
          <div className="px-4 py-2 rounded-xl border text-right" style={{ borderColor: GOLD_BDR, background: 'color-mix(in srgb, var(--primary) 8%, transparent)' }}>
            <p className="text-lg font-bold" style={{ color: GOLD }}>{totalDuration} دقيقة</p>
            <p className="text-xs text-muted-foreground">{totalPrice} ج.م</p>
          </div>
        )}
      </div>

      {selectedServices.length > 0 && (
        <div className="rounded-xl border p-4 space-y-2" style={{ borderColor: BORDER }}>
          <p className="text-xs font-bold text-muted-foreground">{selectedServices.length} خدمة مختارة</p>
          <ul className="space-y-2">
            {selectedServices.map((s, i) => (
              <li key={s.ProID} className="flex items-center justify-between gap-2 text-sm">
                <span className="text-foreground">
                  <span className="text-muted-foreground ml-1">{i + 1}.</span>
                  {s.ProName} — {s.DurationMinutes ?? 30} دقيقة
                </span>
                <button
                  type="button"
                  onClick={() => onRemoveService(s.ProID)}
                  className="p-2 min-h-[44px] min-w-[44px] rounded-lg hover:bg-surface-muted text-muted-foreground"
                  aria-label={`إزالة ${s.ProName}`}
                >
                  <X size={14} />
                </button>
              </li>
            ))}
          </ul>
          <div className="pt-2 border-t flex justify-between text-sm font-bold" style={{ borderColor: BORDER }}>
            <span style={{ color: GOLD }}>الإجمالي: {totalDuration} دقيقة</span>
            <span style={{ color: GOLD }}>{totalPrice} ج.م</span>
          </div>
        </div>
      )}

      <BookingServiceSelect
        services={services}
        selectedIds={serviceIds}
        onSelectMain={onSelectMain}
        onToggleAddon={onToggleAddon}
        isLoading={loadingServices}
      />
    </div>
  );
}

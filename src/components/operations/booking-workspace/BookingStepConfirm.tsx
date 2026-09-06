'use client';

import { OpsFlowErrorBanner } from '../OpsFlowErrorBanner';
import { BookingStepCustomer } from './BookingStepCustomer';
import {
  BORDER,
  GOLD,
  SURFACE,
  type AvailableSlot,
  type BookingClient,
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
  notes: string;
  clientSearch: string;
  clients: BookingClient[];
  selectedClient: BookingClient | null;
  showClients: boolean;
  selectedBranchCode?: string | null;
  error: string | null;
  onCustomerNameChange: (v: string) => void;
  onCustomerPhoneChange: (v: string) => void;
  onNotesChange: (v: string) => void;
  onClientSearchChange: (v: string) => void;
  onSelectClient: (c: BookingClient) => void;
  onClearClient: () => void;
  onShowClients: (v: boolean) => void;
  onEditServices: () => void;
  onEditTime: () => void;
}

/**
 * Final step — customer entry + compact confirm summary (merged former steps 4+5).
 */
export function BookingStepConfirm({
  mode,
  bookingDate,
  selectedBarberName,
  selectedServices,
  totalDuration,
  totalPrice,
  selectedSlot,
  customerName,
  customerPhone,
  notes,
  clientSearch,
  clients,
  selectedClient,
  showClients,
  selectedBranchCode,
  error,
  onCustomerNameChange,
  onCustomerPhoneChange,
  onNotesChange,
  onClientSearchChange,
  onSelectClient,
  onClearClient,
  onShowClients,
  onEditServices,
  onEditTime,
}: Props) {
  const customerDisplay = selectedClient?.Name || customerName.trim();
  const barberDisplay =
    mode === 'nearest'
      ? `أقرب حلاق${selectedSlot?.barberName ? ` — ${selectedSlot.barberName}` : ''}`
      : selectedBarberName || '—';

  return (
    <div className="space-y-5 min-w-0">
      <div>
        <h3 className="text-base font-bold text-foreground">العميل والتأكيد</h3>
        <p className="text-xs text-muted-foreground mt-0.5">
          أكمل بيانات العميل ثم أكّد الحجز — يمكنك تعديل الخدمات أو الموعد دون إعادة البدء
        </p>
      </div>

      <div className="rounded-xl border p-4 space-y-3" style={{ borderColor: BORDER, background: SURFACE }}>
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-[11px] font-bold text-muted-foreground">ملخص الحجز</p>
            <p className="text-sm font-semibold mt-1 truncate">
              {selectedServices.map((s) => s.ProName).join(' + ') || '—'}
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              {formatDateLabel(bookingDate)}
              {selectedSlot ? ` · ${slotDisplayLabel(selectedSlot)}` : ''}
              {selectedBranchCode ? ` · ${selectedBranchCode}` : ''}
            </p>
            <p className="text-xs mt-1">{barberDisplay}</p>
            <p className="text-sm font-bold mt-2" style={{ color: GOLD }}>
              {totalDuration} د · {totalPrice} ج.م
            </p>
            {customerDisplay && (
              <p className="text-xs text-muted-foreground mt-1">العميل: {customerDisplay}</p>
            )}
          </div>
          <div className="flex flex-col gap-1 shrink-0">
            <button
              type="button"
              onClick={onEditServices}
              className="px-2.5 py-1.5 rounded-lg border text-[11px] font-semibold min-h-[36px]"
              style={{ borderColor: BORDER }}
            >
              تعديل الخدمات
            </button>
            <button
              type="button"
              onClick={onEditTime}
              className="px-2.5 py-1.5 rounded-lg border text-[11px] font-semibold min-h-[36px]"
              style={{ borderColor: BORDER }}
            >
              تعديل الموعد
            </button>
          </div>
        </div>
      </div>

      <BookingStepCustomer
        customerName={customerName}
        customerPhone={customerPhone}
        notes={notes}
        clientSearch={clientSearch}
        clients={clients}
        selectedClient={selectedClient}
        showClients={showClients}
        onCustomerNameChange={onCustomerNameChange}
        onCustomerPhoneChange={onCustomerPhoneChange}
        onNotesChange={onNotesChange}
        onClientSearchChange={onClientSearchChange}
        onSelectClient={onSelectClient}
        onClearClient={onClearClient}
        onShowClients={onShowClients}
      />

      {error && <OpsFlowErrorBanner message={error} />}

      <p className="text-xs text-muted-foreground">
        سيتم التحقق من توفر الموعد مرة أخرى عند التأكيد.
      </p>
    </div>
  );
}

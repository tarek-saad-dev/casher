'use client';

import { Search, X } from 'lucide-react';
import { BORDER, SURFACE, type BookingClient } from './types';

interface Props {
  customerName: string;
  customerPhone: string;
  notes: string;
  clientSearch: string;
  clients: BookingClient[];
  selectedClient: BookingClient | null;
  showClients: boolean;
  onCustomerNameChange: (v: string) => void;
  onCustomerPhoneChange: (v: string) => void;
  onNotesChange: (v: string) => void;
  onClientSearchChange: (v: string) => void;
  onSelectClient: (c: BookingClient) => void;
  onClearClient: () => void;
  onShowClients: (v: boolean) => void;
}

export function BookingStepCustomer({
  customerName,
  customerPhone,
  notes,
  clientSearch,
  clients,
  selectedClient,
  showClients,
  onCustomerNameChange,
  onCustomerPhoneChange,
  onNotesChange,
  onClientSearchChange,
  onSelectClient,
  onClearClient,
  onShowClients,
}: Props) {
  return (
    <div className="space-y-5 max-w-xl">
      <div>
        <h3 className="text-base font-bold text-foreground">بيانات العميل</h3>
        <p className="text-xs text-muted-foreground mt-0.5">ابحث عن عميل موجود أو أدخل بيانات جديدة</p>
      </div>

      <div className="relative">
        <p className="text-xs font-semibold text-muted-foreground mb-2">بحث عن عميل</p>
        {selectedClient ? (
          <div className="flex items-center justify-between p-4 rounded-xl border min-h-[52px]" style={{ borderColor: 'var(--success)', background: 'color-mix(in srgb, var(--success) 5%, transparent)' }}>
            <div>
              <p className="text-sm font-bold">{selectedClient.Name}</p>
              {selectedClient.Mobile && <p className="text-xs text-muted-foreground mt-0.5" dir="ltr">{selectedClient.Mobile}</p>}
            </div>
            <button type="button" onClick={onClearClient} className="p-2 min-h-[44px] min-w-[44px] rounded-lg" aria-label="إلغاء اختيار العميل">
              <X size={16} />
            </button>
          </div>
        ) : (
          <>
            <div className="flex items-center gap-2 p-3 rounded-xl border min-h-[48px]" style={{ borderColor: BORDER, background: SURFACE }}>
              <Search size={18} className="text-muted-foreground shrink-0" />
              <input
                className="flex-1 bg-transparent text-sm outline-none"
                placeholder="ابحث بالاسم أو الهاتف..."
                value={clientSearch}
                onChange={(e) => { onClientSearchChange(e.target.value); onShowClients(true); }}
                aria-label="بحث عن عميل"
              />
            </div>
            {showClients && clients.length > 0 && (
              <div className="absolute top-full left-0 right-0 mt-1 rounded-xl border shadow-xl z-20 overflow-hidden max-h-48 overflow-y-auto" style={{ background: 'var(--surface-elevated)', borderColor: BORDER }}>
                {clients.slice(0, 8).map((c) => (
                  <button
                    key={c.ClientID}
                    type="button"
                    className="w-full text-right px-4 py-3 min-h-[44px] hover:bg-surface-muted text-sm border-b last:border-0"
                    style={{ borderColor: BORDER }}
                    onClick={() => onSelectClient(c)}
                  >
                    <span className="font-semibold">{c.Name}</span>
                    {c.Mobile && <span className="text-muted-foreground mr-2 text-xs" dir="ltr">{c.Mobile}</span>}
                  </button>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      <div className="space-y-3">
        <label className="block">
          <span className="text-xs font-semibold text-muted-foreground mb-1.5 block">اسم العميل *</span>
          <input
            type="text"
            value={customerName}
            onChange={(e) => onCustomerNameChange(e.target.value)}
            placeholder="اسم العميل"
            className="w-full min-h-[48px] rounded-xl border px-4 text-sm bg-transparent"
            style={{ borderColor: BORDER }}
          />
        </label>
        <label className="block">
          <span className="text-xs font-semibold text-muted-foreground mb-1.5 block">رقم الهاتف (اختياري)</span>
          <input
            type="tel"
            value={customerPhone}
            onChange={(e) => onCustomerPhoneChange(e.target.value)}
            placeholder="01xxxxxxxxx"
            className="w-full min-h-[48px] rounded-xl border px-4 text-sm bg-transparent"
            style={{ borderColor: BORDER }}
            dir="ltr"
          />
        </label>
        <label className="block">
          <span className="text-xs font-semibold text-muted-foreground mb-1.5 block">ملاحظات (اختياري)</span>
          <textarea
            value={notes}
            onChange={(e) => onNotesChange(e.target.value)}
            placeholder="ملاحظات للحجز..."
            rows={3}
            className="w-full rounded-xl border px-4 py-3 text-sm bg-transparent resize-none"
            style={{ borderColor: BORDER }}
          />
        </label>
      </div>
    </div>
  );
}

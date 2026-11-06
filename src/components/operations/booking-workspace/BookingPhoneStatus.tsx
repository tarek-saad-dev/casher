'use client';

import { useEffect, useState } from 'react';
import { CheckCircle2, CircleAlert, LoaderCircle, UserRoundPlus } from 'lucide-react';
import type { BookingClient } from './types';

type Lookup =
  | { status: 'empty' | 'typing' | 'checking' | 'invalid' | 'error' | 'new' }
  | { status: 'existing'; customer: BookingClient };

export function BookingPhoneStatus({
  phone,
  selectedClient,
  onSelectClient,
}: {
  phone: string;
  selectedClient: BookingClient | null;
  onSelectClient: (client: BookingClient) => void;
}) {
  const [lookup, setLookup] = useState<Lookup>({ status: 'empty' });

  useEffect(() => {
    const raw = phone.trim();
    if (!raw) {
      setLookup({ status: 'empty' });
      return;
    }
    if (selectedClient && selectedClient.Mobile === raw) {
      setLookup({ status: 'existing', customer: selectedClient });
      return;
    }
    // Don't query the server on every intermediate character.
    if ((raw.match(/[0-9٠-٩۰-۹]/g) ?? []).length < 8) {
      setLookup({ status: 'typing' });
      return;
    }

    const controller = new AbortController();
    setLookup({ status: 'checking' });
    const timer = window.setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/customers/lookup-phone?phone=${encodeURIComponent(raw)}`,
          { cache: 'no-store', signal: controller.signal },
        );
        if (!res.ok) throw new Error('lookup_failed');
        const data = (await res.json()) as {
          status?: 'existing' | 'new' | 'invalid';
          customer?: BookingClient;
        };
        if (controller.signal.aborted) return;
        if (data.status === 'existing' && data.customer) {
          setLookup({ status: 'existing', customer: data.customer });
        } else if (data.status === 'new') {
          setLookup({ status: 'new' });
        } else {
          setLookup({ status: 'invalid' });
        }
      } catch {
        if (!controller.signal.aborted) setLookup({ status: 'error' });
      }
    }, 350);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [phone, selectedClient]);

  if (lookup.status === 'empty') {
    return <p className="mt-1.5 text-xs text-muted-foreground">اختياري — لو سبت الرقم فاضي هنحفظ الحجز بدون رقم هاتف.</p>;
  }
  if (lookup.status === 'typing') {
    return <p className="mt-1.5 text-xs text-muted-foreground">كمّل رقم الموبايل عشان نتحقق منه.</p>;
  }
  if (lookup.status === 'checking') {
    return (
      <p role="status" className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
        <LoaderCircle size={14} className="animate-spin" aria-hidden="true" /> جاري التحقق من الرقم…
      </p>
    );
  }
  if (lookup.status === 'existing') {
    return (
      <div role="status" className="mt-2 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-emerald-500/25 bg-emerald-500/10 px-3 py-2.5">
        <div className="flex items-center gap-2 text-xs text-emerald-300">
          <CheckCircle2 size={16} aria-hidden="true" />
          <span>عميل مسجل: <strong>{lookup.customer.Name}</strong></span>
        </div>
        {selectedClient?.ClientID !== lookup.customer.ClientID && (
          <button
            type="button"
            onClick={() => onSelectClient(lookup.customer)}
            className="min-h-9 rounded-lg border border-emerald-400/35 px-3 text-xs font-bold text-emerald-200 focus-visible:outline-2 focus-visible:outline-emerald-400"
          >
            استخدام بياناته
          </button>
        )}
      </div>
    );
  }
  if (lookup.status === 'new') {
    return (
      <p role="status" className="mt-2 flex items-center gap-2 rounded-xl border border-amber-500/25 bg-amber-500/10 px-3 py-2.5 text-xs font-semibold text-amber-200">
        <UserRoundPlus size={16} aria-hidden="true" /> رقم جديد — هنُسجّل العميل تلقائيًا عند تأكيد الحجز.
      </p>
    );
  }
  return (
    <p role="status" className={`mt-2 flex items-center gap-2 text-xs ${lookup.status === 'invalid' ? 'text-rose-400' : 'text-amber-300'}`}>
      <CircleAlert size={15} aria-hidden="true" />
      {lookup.status === 'invalid'
        ? 'رقم الهاتف غير صالح. صحّحه أو سيبه فاضي لو الحجز بدون رقم.'
        : 'تعذر التحقق الآن؛ هنراجع بيانات العميل عند التأكيد.'}
    </p>
  );
}

'use client';

import { useEffect, useState } from 'react';
import type { TenantBrandProfile } from '@/platform/branding/brandProfile';

type BrandDraft = {
  displayName: string;
  logoUrl: string;
  phone: string;
  address: string;
  primaryColor: string;
  accentColor: string;
  receiptFooter: string;
  timezone: string;
  publicBookingOrigins: string;
};

function toDraft(b: TenantBrandProfile): BrandDraft {
  return {
    displayName: b.displayName,
    logoUrl: b.logoUrl ?? '',
    phone: b.phone ?? '',
    address: b.address ?? '',
    primaryColor: b.primaryColor ?? '',
    accentColor: b.accentColor ?? '',
    receiptFooter: b.receiptFooter ?? '',
    timezone: b.timezone,
    publicBookingOrigins: b.publicBookingOrigins.join('\n'),
  };
}

const FIELDS: Array<{ key: keyof BrandDraft; label: string; placeholder?: string; dir?: 'ltr' }> = [
  { key: 'displayName', label: 'الاسم الظاهر' },
  { key: 'logoUrl', label: 'رابط الشعار', placeholder: '/logo.png أو https://…', dir: 'ltr' },
  { key: 'phone', label: 'الهاتف', dir: 'ltr' },
  { key: 'address', label: 'العنوان' },
  { key: 'primaryColor', label: 'اللون الأساسي', placeholder: '#RRGGBB', dir: 'ltr' },
  { key: 'accentColor', label: 'اللون الثانوي', placeholder: '#RRGGBB', dir: 'ltr' },
  { key: 'receiptFooter', label: 'تذييل الإيصال' },
  { key: 'timezone', label: 'المنطقة الزمنية', placeholder: 'Africa/Cairo', dir: 'ltr' },
];

/**
 * Shared brand editor. `save` receives the API payload (with expectedRevision) and returns the
 * stored profile; used by tenant settings (/api/tenant/brand) and the operator console.
 */
export default function BrandProfileForm({
  brand,
  save,
  readOnly = false,
}: {
  brand: TenantBrandProfile;
  save: (payload: Record<string, unknown>) => Promise<TenantBrandProfile>;
  readOnly?: boolean;
}) {
  const [draft, setDraft] = useState<BrandDraft>(() => toDraft(brand));
  const [revision, setRevision] = useState(brand.revision);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    setDraft(toDraft(brand));
    setRevision(brand.revision);
  }, [brand]);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      const saved = await save({
        displayName: draft.displayName,
        logoUrl: draft.logoUrl || null,
        phone: draft.phone || null,
        address: draft.address || null,
        primaryColor: draft.primaryColor || null,
        accentColor: draft.accentColor || null,
        receiptFooter: draft.receiptFooter || null,
        timezone: draft.timezone,
        publicBookingOrigins: draft.publicBookingOrigins
          .split(/[\n,]/)
          .map((s) => s.trim())
          .filter(Boolean),
        ...(revision > 0 ? { expectedRevision: revision } : {}),
      });
      setDraft(toDraft(saved));
      setRevision(saved.revision);
      setMessage({ ok: true, text: 'تم الحفظ' });
    } catch (err) {
      setMessage({ ok: false, text: err instanceof Error ? err.message : 'تعذر الحفظ' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <div className="flex items-center gap-3 rounded-xl border border-border p-3">
        {draft.logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={draft.logoUrl} alt="" className="h-12 w-12 rounded-lg object-contain bg-muted" />
        ) : (
          <div
            className="flex h-12 w-12 items-center justify-center rounded-lg text-lg font-bold text-white"
            style={{ background: draft.primaryColor || '#64748B' }}
          >
            {draft.displayName.trim().charAt(0) || '؟'}
          </div>
        )}
        <div>
          <div className="font-bold" style={{ color: draft.primaryColor || undefined }}>
            {draft.displayName || '—'}
          </div>
          <div className="text-xs text-muted-foreground">{draft.receiptFooter || 'بدون تذييل'}</div>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {FIELDS.map((f) => (
          <label key={f.key} className="space-y-1 text-sm">
            <span className="text-muted-foreground">{f.label}</span>
            <input
              className="w-full rounded-lg border border-border bg-background px-3 py-2"
              value={draft[f.key]}
              placeholder={f.placeholder}
              dir={f.dir}
              disabled={readOnly || busy}
              onChange={(e) => setDraft((d) => ({ ...d, [f.key]: e.target.value }))}
            />
          </label>
        ))}
        <label className="space-y-1 text-sm sm:col-span-2">
          <span className="text-muted-foreground">نطاقات الحجز العام (سطر لكل نطاق — بيانات فقط)</span>
          <textarea
            className="min-h-20 w-full rounded-lg border border-border bg-background px-3 py-2"
            dir="ltr"
            value={draft.publicBookingOrigins}
            placeholder="https://booking.example.com"
            disabled={readOnly || busy}
            onChange={(e) => setDraft((d) => ({ ...d, publicBookingOrigins: e.target.value }))}
          />
        </label>
      </div>

      {!readOnly && (
        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={busy}
            className="rounded-lg bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-50"
          >
            {busy ? 'جاري الحفظ…' : 'حفظ الهوية'}
          </button>
          {message && (
            <span className={message.ok ? 'text-sm text-emerald-500' : 'text-sm text-rose-500'}>
              {message.text}
            </span>
          )}
        </div>
      )}
    </form>
  );
}

'use client';

import { Check, Loader2 } from 'lucide-react';
import type { OpsBookablePackage } from '@/lib/operations/opsBookablePackagesTypes';
import { BORDER, GOLD, GOLD_BDR, GOLD_BG } from './types';

interface Props {
  packages: OpsBookablePackage[];
  loading: boolean;
  error: string | null;
  selectedPackage: OpsBookablePackage | null;
  branchCode?: string | null;
  onSelect: (packageId: number) => void;
}

const GROUPS: Array<{ kind: OpsBookablePackage['kind']; title: string }> = [
  { kind: 'regular', title: 'الباكدجات' },
  { kind: 'groom', title: 'باكدجات العريس' },
];

export function BookingStepPackages({
  packages,
  loading,
  error,
  selectedPackage,
  branchCode,
  onSelect,
}: Props) {
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h3 className="text-base font-bold text-foreground">اختر الباكدج</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            الباكدجات المتاحة{branchCode ? ` في فرع ${branchCode}` : ''} · السعر والمدة من إعدادات الباكدج
          </p>
        </div>
        {selectedPackage && (
          <div className="px-4 py-2 rounded-xl border text-right" style={{ borderColor: GOLD_BDR, background: 'color-mix(in srgb, var(--primary) 8%, transparent)' }}>
            <p className="text-lg font-bold" style={{ color: GOLD }}>{selectedPackage.durationMinutes} دقيقة</p>
            <p className="text-xs text-muted-foreground">{selectedPackage.price} ج.م</p>
          </div>
        )}
      </div>

      {loading && packages.length === 0 && (
        <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
          <Loader2 size={16} className="animate-spin" /> جاري تحميل الباكدجات...
        </div>
      )}

      {error && (
        <p className="rounded-xl border p-3 text-sm text-destructive" style={{ borderColor: 'color-mix(in srgb, var(--destructive) 35%, transparent)' }}>
          {error}
        </p>
      )}

      {!loading && !error && packages.length === 0 && (
        <p className="py-10 text-center text-sm text-muted-foreground">لا توجد باكدجات متاحة حاليًا</p>
      )}

      {GROUPS.map(({ kind, title }) => {
        const list = packages.filter((p) => p.kind === kind);
        if (list.length === 0) return null;
        return (
          <section key={kind} className="space-y-2">
            <p className="text-xs font-bold text-muted-foreground">{title}</p>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {list.map((pkg) => (
                <PackageCard
                  key={pkg.packageId}
                  pkg={pkg}
                  selected={selectedPackage?.packageId === pkg.packageId}
                  onSelect={onSelect}
                />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function PackageCard({
  pkg,
  selected,
  onSelect,
}: {
  pkg: OpsBookablePackage;
  selected: boolean;
  onSelect: (packageId: number) => void;
}) {
  const showOriginal = pkg.originalPrice != null && pkg.originalPrice > pkg.price;
  return (
    <button
      type="button"
      disabled={!pkg.available}
      onClick={() => onSelect(pkg.packageId)}
      aria-pressed={selected}
      className="relative flex flex-col gap-2 rounded-xl border p-4 text-right transition-colors min-h-[120px] disabled:cursor-not-allowed disabled:opacity-60"
      style={{
        borderColor: selected ? GOLD : BORDER,
        background: selected ? GOLD_BG : 'transparent',
      }}
    >
      {selected && (
        <span className="absolute left-3 top-3 flex size-6 items-center justify-center rounded-full" style={{ background: GOLD, color: 'var(--primary-foreground)' }}>
          <Check size={14} />
        </span>
      )}
      <span className="text-sm font-bold text-foreground pl-8">{pkg.nameAr}</span>
      <span className="flex items-baseline gap-2">
        <span className="text-lg font-bold" style={{ color: GOLD }}>{pkg.price} ج.م</span>
        {showOriginal && (
          <span className="text-xs text-muted-foreground line-through">{pkg.originalPrice} ج.م</span>
        )}
      </span>
      <span className="text-xs text-muted-foreground">
        {pkg.services.length} خدمات · {pkg.durationMinutes} دقيقة
      </span>
      {pkg.services.length > 0 && (
        <span className="text-[11px] text-muted-foreground line-clamp-2">
          {pkg.services.map((s) => s.nameAr).join(' + ')}
        </span>
      )}
      {!pkg.available && pkg.unavailableReason && (
        <span className="text-[11px] font-semibold text-warning">{pkg.unavailableReason}</span>
      )}
    </button>
  );
}

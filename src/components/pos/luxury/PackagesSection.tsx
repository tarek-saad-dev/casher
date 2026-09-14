'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Check, Clock, Crown, Loader2, Plus, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Barber, CartItem } from '@/lib/types';
import {
  buildPackageCartItems,
  findOverlappingRequiredCartItems,
  findReusableAddonProIds,
} from '@/lib/pos/groomPackageCart';

type OptionalItem = {
  serviceId: number;
  nameAr: string;
  nameEn: string;
  name: string;
  price: number;
  group: 'groom_addons' | 'home_visit';
  availableAsOptional: boolean;
  durationMinutes: number | null;
};

type PackageCard = {
  packageId: number;
  nameAr: string;
  nameEn: string;
  name: string;
  price: number;
  durationMinutes: number | null;
  popular: boolean;
  includes: Array<{
    serviceId: number;
    nameAr: string;
    nameEn: string;
    name: string;
    optional: boolean;
  }>;
  optionalExtras: OptionalItem[];
  optionalGroups: Array<{
    key: 'groom_addons' | 'home_visit';
    labelEn: string;
    labelAr: string;
    multiSelect: boolean;
    mutuallyExclusive: boolean;
    items: OptionalItem[];
  }>;
};

function mapApiPackage(raw: Record<string, unknown>): PackageCard {
  const groom = (raw.groom ?? null) as {
    optionalExtras?: OptionalItem[];
    optionalGroups?: PackageCard['optionalGroups'];
  } | null;
  return {
    packageId: Number(raw.packageId),
    nameAr: String(raw.nameAr ?? ''),
    nameEn: String(raw.nameEn ?? ''),
    name: String(raw.name ?? raw.nameEn ?? ''),
    price: Number(raw.price) || 0,
    durationMinutes:
      raw.durationMinutes == null ? null : Number(raw.durationMinutes),
    popular: Boolean(raw.popular),
    includes: Array.isArray(raw.includes)
      ? (raw.includes as PackageCard['includes'])
      : [],
    optionalExtras: groom?.optionalExtras ?? [],
    optionalGroups: groom?.optionalGroups ?? [],
  };
}

interface GroomPackagesSectionProps {
  selectedBarber: Barber | null;
  cartItems: CartItem[];
  onAddPackageItems: (
    items: CartItem[],
    opts?: { removeIds?: string[] },
  ) => void;
  onToast?: (type: 'success' | 'error' | 'info', message: string) => void;
  /** When set, auto-open this package panel (e.g. booking hydration). */
  hydratePackageId?: number | null;
  hydrateAddonProIds?: number[];
}

function money(n: number) {
  return n.toLocaleString('en-EG');
}

export default function GroomPackagesSection({
  selectedBarber,
  cartItems,
  onAddPackageItems,
  onToast,
  hydratePackageId,
  hydrateAddonProIds,
}: GroomPackagesSectionProps) {
  const [packages, setPackages] = useState<PackageCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [active, setActive] = useState<PackageCard | null>(null);
  const [selectedAddonIds, setSelectedAddonIds] = useState<number[]>([]);
  const [homeVisitId, setHomeVisitId] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [overlapConfirm, setOverlapConfirm] = useState<{
    names: string[];
    removeIds: string[];
  } | null>(null);
  const [hydratedOnce, setHydratedOnce] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setLoadError('');
      try {
        const res = await fetch('/api/pos/groom-packages');
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'فشل تحميل الباقات');
        if (!cancelled) {
          const list = Array.isArray(data.packages) ? data.packages : [];
          setPackages(list.map((p: Record<string, unknown>) => mapApiPackage(p)));
        }
      } catch (e) {
        if (!cancelled) {
          setLoadError(e instanceof Error ? e.message : 'فشل تحميل الباقات');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const openPackage = useCallback(
    (pkg: PackageCard, preselectAddons: number[] = []) => {
      setActive(pkg);
      const optionalIds = new Set(
        (pkg.optionalExtras ?? [])
          .filter((x) => x.availableAsOptional)
          .map((x) => x.serviceId),
      );
      const homeIds = new Set(
        (pkg.optionalExtras ?? [])
          .filter((x) => x.group === 'home_visit' && x.availableAsOptional)
          .map((x) => x.serviceId),
      );
      const reusable = findReusableAddonProIds(cartItems, [...optionalIds]);
      const merged = [...new Set([...preselectAddons, ...reusable])].filter((id) =>
        optionalIds.has(id),
      );
      const home = merged.find((id) => homeIds.has(id)) ?? null;
      setHomeVisitId(home);
      setSelectedAddonIds(merged.filter((id) => !homeIds.has(id)));
      setOverlapConfirm(null);
    },
    [cartItems],
  );

  useEffect(() => {
    if (hydratedOnce || !hydratePackageId || packages.length === 0) return;
    const pkg = packages.find((p) => p.packageId === hydratePackageId);
    if (!pkg) return;
    setHydratedOnce(true);
    openPackage(pkg, hydrateAddonProIds ?? []);
  }, [hydratePackageId, hydrateAddonProIds, packages, hydratedOnce, openPackage]);

  const requiredIncludes = useMemo(
    () => (active?.includes ?? []).filter((i) => !i.optional),
    [active],
  );

  const addonOptions = useMemo(
    () =>
      (active?.optionalExtras ?? []).filter(
        (i) => i.group === 'groom_addons' && i.availableAsOptional,
      ),
    [active],
  );

  const homeVisitOptions = useMemo(
    () =>
      (active?.optionalExtras ?? []).filter(
        (i) => i.group === 'home_visit' && i.availableAsOptional,
      ),
    [active],
  );

  const liveTotal = useMemo(() => {
    if (!active) return { price: 0, duration: 0 };
    let price = Number(active.price) || 0;
    let duration = Number(active.durationMinutes) || 0;
    for (const id of selectedAddonIds) {
      const opt = addonOptions.find((o) => o.serviceId === id);
      if (!opt) continue;
      price += Number(opt.price) || 0;
      if (opt.durationMinutes != null && Number(opt.durationMinutes) > 0) {
        duration += Number(opt.durationMinutes);
      }
    }
    if (homeVisitId != null) {
      const hv = homeVisitOptions.find((o) => o.serviceId === homeVisitId);
      if (hv) {
        price += Number(hv.price) || 0;
        if (hv.durationMinutes != null && Number(hv.durationMinutes) > 0) {
          duration += Number(hv.durationMinutes);
        }
      }
    }
    return { price, duration };
  }, [active, selectedAddonIds, homeVisitId, addonOptions, homeVisitOptions]);

  const closePanel = () => {
    setActive(null);
    setSelectedAddonIds([]);
    setHomeVisitId(null);
    setOverlapConfirm(null);
  };

  const toggleAddon = (serviceId: number) => {
    setSelectedAddonIds((prev) =>
      prev.includes(serviceId)
        ? prev.filter((id) => id !== serviceId)
        : [...prev, serviceId],
    );
  };

  const commitResolved = async (removeIds: string[] = []) => {
    if (!active || !selectedBarber) return;
    setSubmitting(true);
    try {
      const addonProIds = [
        ...selectedAddonIds,
        ...(homeVisitId != null ? [homeVisitId] : []),
      ];
      const res = await fetch('/api/pos/groom-packages/resolve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          packageId: active.packageId,
          addonProIds,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        throw new Error(data.error || data.code || 'تعذر إضافة الباقة');
      }

      // Also drop reusable standalone addon lines that are now package addons
      const reusable = findReusableAddonProIds(
        cartItems,
        addonProIds,
      );
      const extraRemove = cartItems
        .filter((i) => !i.packageMeta && reusable.includes(i.ProID))
        .map((i) => i.id);

      const items = buildPackageCartItems({
        resolved: {
          packageId: data.packageId,
          nameEn: data.nameEn,
          nameAr: data.nameAr,
          packagePrice: data.packagePrice,
          packageDurationMinutes: data.packageDurationMinutes,
          totalDurationMinutes: data.totalDurationMinutes,
          requiredServiceIds: data.requiredServiceIds,
          addonProIds: data.addonProIds,
          services: data.services,
          metadataNote: data.metadataNote,
        },
        barber: selectedBarber,
      });

      onAddPackageItems(items, {
        removeIds: [...new Set([...removeIds, ...extraRemove])],
      });
      onToast?.(
        'success',
        `تمت إضافة ${data.nameAr || data.nameEn} — ${money(data.totalPrice)} ج.م`,
      );
      closePanel();
    } catch (e) {
      onToast?.(
        'error',
        e instanceof Error ? e.message : 'تعذر إضافة الباقة',
      );
    } finally {
      setSubmitting(false);
    }
  };

  const handleConfirmAdd = async () => {
    if (!active || !selectedBarber) {
      onToast?.('error', 'اختر الحلاق أولاً');
      return;
    }

    const requiredIds = requiredIncludes.map((i) => i.serviceId);
    const overlaps = findOverlappingRequiredCartItems(cartItems, requiredIds);
    if (overlaps.length > 0) {
      setOverlapConfirm({
        names: overlaps.map((o) => o.ProName),
        removeIds: overlaps.map((o) => o.id),
      });
      return;
    }
    await commitResolved([]);
  };

  const isDisabled = !selectedBarber;

  return (
    <div className="w-full mt-4" dir="rtl">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Crown className="w-5 h-5 text-primary" />
          <div>
            <h3 className="text-base font-bold text-foreground">باقات العريس</h3>
            <p className="text-xs text-muted-foreground">Groom Packages</p>
          </div>
        </div>
      </div>

      {loading && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground py-6 justify-center">
          <Loader2 className="w-4 h-4 animate-spin" />
          جاري تحميل الباقات…
        </div>
      )}

      {loadError && !loading && (
        <div className="rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {loadError}
        </div>
      )}

      {!loading && !loadError && packages.length === 0 && (
        <p className="text-sm text-muted-foreground py-4 text-center">لا توجد باقات عريس نشطة</p>
      )}

      {!loading && packages.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
          {packages.map((pkg) => {
            const includedCount = (pkg.includes ?? []).filter((i) => !i.optional).length;
            return (
              <div
                key={pkg.packageId}
                className={cn(
                  'relative rounded-2xl border bg-surface p-4 transition-all',
                  pkg.popular
                    ? 'border-primary/50 shadow-md shadow-primary/10'
                    : 'border-border hover:border-border/80',
                )}
              >
                {pkg.popular && (
                  <span className="absolute top-3 left-3 inline-flex items-center gap-1 rounded-full bg-primary px-2 py-0.5 text-[10px] font-bold text-primary-foreground">
                    <Crown className="w-3 h-3" />
                    الأكثر طلباً
                  </span>
                )}
                <h4 className="text-base font-bold text-foreground mb-1 pe-16">
                  {pkg.nameAr || pkg.nameEn}
                </h4>
                {pkg.nameAr && pkg.nameEn && pkg.nameAr !== pkg.nameEn && (
                  <p className="text-xs text-muted-foreground mb-2">{pkg.nameEn}</p>
                )}
                <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground mb-3">
                  <span>{includedCount} خدمات</span>
                  {pkg.durationMinutes != null && pkg.durationMinutes > 0 && (
                    <span className="inline-flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      {pkg.durationMinutes} دقيقة
                    </span>
                  )}
                </div>
                <div className="text-xl font-bold text-primary mb-3">
                  {money(pkg.price)} ج.م
                </div>
                <button
                  type="button"
                  disabled={isDisabled}
                  onClick={() => openPackage(pkg)}
                  className={cn(
                    'w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-medium transition-all',
                    isDisabled
                      ? 'bg-muted text-muted-foreground/40 cursor-not-allowed'
                      : 'bg-primary/10 text-primary border border-primary/30 hover:bg-primary hover:text-primary-foreground active:scale-[0.98]',
                  )}
                >
                  <Plus className="w-4 h-4" />
                  إضافة الباقة
                </button>
              </div>
            );
          })}
        </div>
      )}

      {isDisabled && packages.length > 0 && (
        <p className="mt-2 text-xs text-muted-foreground">اختر الحلاق أولاً لإضافة باقة</p>
      )}

      {/* Compact selection panel */}
      {active && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/40" onClick={closePanel}>
          <div
            className="h-full w-full max-w-md bg-background border-s border-border shadow-2xl flex flex-col"
            onClick={(e) => e.stopPropagation()}
            dir="rtl"
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-border">
              <div>
                <h3 className="font-bold text-foreground">{active.nameAr || active.nameEn}</h3>
                <p className="text-xs text-muted-foreground">
                  {money(active.price)} ج.م · {active.durationMinutes ?? '—'} دقيقة
                </p>
              </div>
              <button
                type="button"
                onClick={closePanel}
                className="p-2 rounded-lg hover:bg-muted text-muted-foreground"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-5">
              <section>
                <h4 className="text-sm font-semibold mb-2">الخدمات المشمولة · Included</h4>
                <ul className="space-y-1.5">
                  {requiredIncludes.map((inc) => (
                    <li
                      key={inc.serviceId}
                      className="flex items-center gap-2 text-sm text-foreground"
                    >
                      <Check className="w-3.5 h-3.5 text-success shrink-0" />
                      <span>{inc.nameAr || inc.nameEn}</span>
                    </li>
                  ))}
                </ul>
                <p className="mt-2 text-[11px] text-muted-foreground">
                  سعر الباقة التجاري هو المرجع — لا تُضاف أسعار الخدمات المشمولة منفردة.
                </p>
              </section>

              {addonOptions.length > 0 && (
                <section>
                  <h4 className="text-sm font-semibold mb-2">إضافات اختيارية</h4>
                  <div className="space-y-2">
                    {addonOptions.map((opt) => {
                      const selected = selectedAddonIds.includes(opt.serviceId);
                      return (
                        <button
                          key={opt.serviceId}
                          type="button"
                          onClick={() => toggleAddon(opt.serviceId)}
                          className={cn(
                            'w-full flex items-center justify-between rounded-xl border px-3 py-2.5 text-sm transition-colors',
                            selected
                              ? 'border-primary bg-primary/10 text-foreground'
                              : 'border-border hover:bg-muted/50',
                          )}
                        >
                          <span className="text-start">
                            <span className="font-medium block">{opt.nameAr || opt.nameEn}</span>
                            {opt.durationMinutes != null && opt.durationMinutes > 0 && (
                              <span className="text-[11px] text-muted-foreground">
                                +{opt.durationMinutes} دقيقة
                              </span>
                            )}
                          </span>
                          <span className="font-bold" dir="ltr">
                            +{money(opt.price)}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </section>
              )}

              {homeVisitOptions.length > 0 && (
                <section>
                  <h4 className="text-sm font-semibold mb-1">زيارة خارجية — اختياري</h4>
                  <p className="text-xs text-muted-foreground mb-2">Home Visit — Optional</p>
                  <div className="space-y-2">
                    <button
                      type="button"
                      onClick={() => setHomeVisitId(null)}
                      className={cn(
                        'w-full rounded-xl border px-3 py-2.5 text-sm text-start',
                        homeVisitId == null
                          ? 'border-primary bg-primary/10'
                          : 'border-border hover:bg-muted/50',
                      )}
                    >
                      بدون زيارة خارجية
                    </button>
                    {homeVisitOptions.map((opt) => (
                      <button
                        key={opt.serviceId}
                        type="button"
                        onClick={() => setHomeVisitId(opt.serviceId)}
                        className={cn(
                          'w-full flex items-center justify-between rounded-xl border px-3 py-2.5 text-sm',
                          homeVisitId === opt.serviceId
                            ? 'border-primary bg-primary/10'
                            : 'border-border hover:bg-muted/50',
                        )}
                      >
                        <span className="text-start">
                          <span className="font-medium block">{opt.nameAr || opt.nameEn}</span>
                          <span className="text-[11px] text-muted-foreground">
                            {opt.durationMinutes != null && opt.durationMinutes > 0
                              ? `${opt.durationMinutes} دقيقة`
                              : 'المدة غير محددة'}
                          </span>
                        </span>
                        <span className="font-bold" dir="ltr">
                          {money(opt.price)} ج.م
                        </span>
                      </button>
                    ))}
                  </div>
                </section>
              )}

              <section className="rounded-xl border border-border bg-muted/30 p-3">
                <h4 className="text-sm font-semibold mb-2">الحلاق</h4>
                <p className="text-sm">
                  {selectedBarber
                    ? selectedBarber.EmpName
                    : 'اختر حلاقاً من الشريط أعلاه'}
                </p>
                <p className="text-[11px] text-muted-foreground mt-1">
                  يُنسب الحلاق لكل خدمات الباقة والإضافات تلقائياً.
                </p>
              </section>

              {overlapConfirm && (
                <section className="rounded-xl border border-warning/40 bg-warning/10 p-3 space-y-2">
                  <p className="text-sm font-medium text-warning">
                    خدمات موجودة مسبقاً ومشمولة في الباقة:
                  </p>
                  <ul className="text-xs text-foreground space-y-1">
                    {overlapConfirm.names.map((n) => (
                      <li key={n}>• {n}</li>
                    ))}
                  </ul>
                  <p className="text-xs text-muted-foreground">
                    هل تريد إزالة الخدمة المنفردة وإضافة الباقة؟
                  </p>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      className="flex-1 rounded-lg border border-border py-2 text-xs"
                      onClick={() => setOverlapConfirm(null)}
                    >
                      إلغاء
                    </button>
                    <button
                      type="button"
                      className="flex-1 rounded-lg bg-primary text-primary-foreground py-2 text-xs font-medium"
                      disabled={submitting}
                      onClick={() => commitResolved(overlapConfirm.removeIds)}
                    >
                      استبدال ومتابعة
                    </button>
                  </div>
                </section>
              )}
            </div>

            <div className="border-t border-border p-4 space-y-3 bg-background">
              <div className="text-sm space-y-1" dir="ltr">
                <div className="flex justify-between">
                  <span>{active.nameEn}</span>
                  <span>{money(active.price)}</span>
                </div>
                {selectedAddonIds.map((id) => {
                  const opt = addonOptions.find((o) => o.serviceId === id);
                  if (!opt) return null;
                  return (
                    <div key={id} className="flex justify-between text-muted-foreground">
                      <span>{opt.nameEn || opt.nameAr}</span>
                      <span>{money(opt.price)}</span>
                    </div>
                  );
                })}
                {homeVisitId != null && (() => {
                  const hv = homeVisitOptions.find((o) => o.serviceId === homeVisitId);
                  if (!hv) return null;
                  return (
                    <div className="flex justify-between text-muted-foreground">
                      <span>{hv.nameEn || hv.nameAr}</span>
                      <span>{money(hv.price)}</span>
                    </div>
                  );
                })()}
                <div className="flex justify-between font-bold border-t border-border pt-1 mt-1">
                  <span>Total</span>
                  <span>{money(liveTotal.price)} EGP</span>
                </div>
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>Total duration</span>
                  <span>{liveTotal.duration} min</span>
                </div>
              </div>
              <button
                type="button"
                disabled={submitting || !selectedBarber || !!overlapConfirm}
                onClick={handleConfirmAdd}
                className={cn(
                  'w-full rounded-xl py-3 text-sm font-bold transition-all',
                  submitting || !selectedBarber
                    ? 'bg-muted text-muted-foreground cursor-not-allowed'
                    : 'bg-primary text-primary-foreground hover:opacity-90',
                )}
              >
                {submitting ? (
                  <span className="inline-flex items-center gap-2">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    جاري الإضافة…
                  </span>
                ) : (
                  'إضافة للفاتورة'
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

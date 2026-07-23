'use client';

import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import {
  Scissors, Clock, Banknote, Check, Sparkles, Droplets, Plus, Paintbrush, HandHelping,
  type LucideIcon,
} from 'lucide-react';
import type { Service } from '@/lib/types';
import { searchServices } from '@/lib/serviceSearch';
import ServiceSearchInput from '@/components/pos/ServiceSearchInput';

export interface BookingSelectService {
  ProID: number;
  ProName: string;
  SPrice: number;
  DurationMinutes: number | null;
  CatName?: string | null;
}

interface Props {
  services: BookingSelectService[];
  selectedIds: number[];
  onSelectMain: (id: number) => void;
  onToggleAddon: (id: number) => void;
  isLoading?: boolean;
}

const GOLD = 'var(--primary)';
const GOLD_BG = 'color-mix(in srgb, var(--primary) 10%, transparent)';
const GOLD_BDR = 'color-mix(in srgb, var(--primary) 35%, transparent)';
const BORDER = 'var(--border)';

function normalizeName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, ' ')
    .replace(/[&+]/g, ' and ')
    .replace(/\s+/g, ' ')
    .trim();
}

function flexMatch(serviceName: string, targetNames: string[]): boolean {
  const norm = normalizeName(serviceName);
  return targetNames.some((t) => {
    const nt = normalizeName(t);
    return norm === nt || norm.includes(nt) || nt.includes(norm);
  });
}

function isServiceVisible(s: BookingSelectService): boolean {
  return Boolean(s.ProName?.trim()) && (s.SPrice ?? 0) > 0;
}

const PRIMARY_SLOTS: { names: string[] }[] = [
  { names: ['Hair Cut', 'Haircut', 'Detailed Cut', 'Detail Cut', 'DetailedCut'] },
  { names: ['Beard Styling & Fade', 'Beard Styling', 'Beard'] },
  { names: ['Haircut & Beard', 'Hair & Beard', 'Hair cut & Beard', 'Hair cut + Beard', 'Hair and Beard'] },
];
const SECONDARY_NAMES = ['Advanced Cut', 'Fade Cut'];
const ALL_MAIN_VARIATIONS = PRIMARY_SLOTS.flatMap((s) => s.names).concat(SECONDARY_NAMES);

type AddonCatKey = 'skincare' | 'masks' | 'hair' | 'beard_face' | 'comfort' | 'other';

interface AddonCat {
  key: AddonCatKey;
  label: string;
  icon: LucideIcon;
  serviceNames: string[];
}

const ADDON_CATEGORIES: AddonCat[] = [
  {
    key: 'skincare',
    label: 'عناية البشرة',
    icon: Droplets,
    serviceNames: ['Basic Skin Care', 'Deep SkinCare', 'Medical Skin Care'],
  },
  {
    key: 'masks',
    label: 'ماسكات',
    icon: Sparkles,
    serviceNames: ['Face Mask', 'Gold Mask', 'Coffee Mask', 'peel-off Mask', 'Hair Mask'],
  },
  {
    key: 'hair',
    label: 'شعر',
    icon: Paintbrush,
    serviceNames: [
      'Basic Hair Color', 'Dry-Hair', 'Hair & Beard Color', 'Hair Botox', 'Hair Design',
      'Hair Oil Treatment', 'Hair Straightening', 'Hair Styling', 'Long Hair Protein',
      'Short Hair Protein', 'Silver Highlights', 'Smoothing Cream', 'Toppik Hair Spray',
      'Wavy Styling', 'بلوب كيرلي', 'معالج الشعر', 'بلسم', 'ثيرم', 'حمام كريم', 'شامبو',
    ],
  },
  {
    key: 'beard_face',
    label: 'دقن ووجه',
    icon: Scissors,
    serviceNames: [
      'Zero Beard Shave', 'Beard Bleaching', 'Face Threading', 'Threading',
      'Full Wax', 'Partial Wax',
    ],
  },
  {
    key: 'comfort',
    label: 'راحة ولمسة نهائية',
    icon: HandHelping,
    serviceNames: [
      'Hot / Cold Towel', 'Hot Towel', 'Cold Towel',
      'باديكير قدم', 'باديكير يد', 'برفيوم SF',
    ],
  },
];

function PrimaryCard({
  service,
  isSelected,
  onSelect,
  badge,
}: {
  service: BookingSelectService;
  isSelected: boolean;
  onSelect: () => void;
  badge?: string;
}) {
  const duration = service.DurationMinutes ?? 30;
  return (
    <button
      type="button"
      onClick={onSelect}
      className="w-full rounded-2xl border text-right transition-all overflow-hidden"
      style={{
        borderColor: isSelected ? GOLD : BORDER,
        background: isSelected ? GOLD_BG : 'transparent',
        boxShadow: isSelected ? '0 0 20px color-mix(in srgb, var(--primary) 12%, transparent)' : undefined,
      }}
    >
      <div
        className="h-1 w-full"
        style={{
          background: isSelected
            ? GOLD
            : 'linear-gradient(to left, color-mix(in srgb, var(--primary) 15%, transparent), transparent)',
        }}
      />
      <div className="p-4">
        {badge && (
          <span
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold mb-2"
            style={{ background: GOLD_BG, color: GOLD, border: `1px solid ${GOLD_BDR}` }}
          >
            <Sparkles className="w-2.5 h-2.5" />
            {badge}
          </span>
        )}
        <div className="flex items-start gap-3">
          <div
            className="w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0"
            style={{ background: isSelected ? GOLD : 'var(--surface-muted)' }}
          >
            <Scissors className="w-5 h-5" style={{ color: isSelected ? 'var(--primary-foreground)' : 'var(--muted-foreground)' }} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-2">
              <h4 className="font-bold text-sm text-foreground leading-tight">{service.ProName}</h4>
              <div
                className="w-6 h-6 rounded-full border-2 flex items-center justify-center flex-shrink-0"
                style={{
                  borderColor: isSelected ? GOLD : BORDER,
                  background: isSelected ? GOLD : 'transparent',
                }}
              >
                {isSelected && <Check className="w-3.5 h-3.5" style={{ color: 'var(--primary-foreground)' }} />}
              </div>
            </div>
            <div className="flex items-center gap-3 mt-2 text-xs">
              <span className="inline-flex items-center gap-1 font-bold" style={{ color: GOLD }}>
                <Banknote className="w-3.5 h-3.5" />
                {service.SPrice} ج.م
              </span>
              <span className="text-muted-foreground">·</span>
              <span className="inline-flex items-center gap-1 text-muted-foreground">
                <Clock className="w-3.5 h-3.5" />
                {duration} دقيقة
              </span>
            </div>
          </div>
        </div>
      </div>
    </button>
  );
}

function SecondaryCard({
  service,
  isSelected,
  onSelect,
}: {
  service: BookingSelectService;
  isSelected: boolean;
  onSelect: () => void;
}) {
  const duration = service.DurationMinutes ?? 30;
  return (
    <button
      type="button"
      onClick={onSelect}
      className="w-full rounded-xl border p-3 text-right transition-all"
      style={{
        borderColor: isSelected ? GOLD : BORDER,
        background: isSelected ? GOLD_BG : 'transparent',
      }}
    >
      <div className="flex items-center gap-3">
        <div
          className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0"
          style={{ background: isSelected ? GOLD : 'var(--surface-muted)' }}
        >
          <Scissors className="w-4 h-4" style={{ color: isSelected ? 'var(--primary-foreground)' : 'var(--muted-foreground)' }} />
        </div>
        <div className="flex-1 min-w-0 text-right">
          <p className="font-bold text-sm text-foreground">{service.ProName}</p>
          <p className="text-xs text-muted-foreground mt-1 flex items-center gap-2 justify-end">
            <span className="font-bold" style={{ color: GOLD }}>{service.SPrice} ج.م</span>
            <span>·</span>
            <span>{duration} د</span>
          </p>
        </div>
        <div
          className="w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0"
          style={{
            borderColor: isSelected ? GOLD : BORDER,
            background: isSelected ? GOLD : 'transparent',
          }}
        >
          {isSelected && <Check className="w-3 h-3" style={{ color: 'var(--primary-foreground)' }} />}
        </div>
      </div>
    </button>
  );
}

function UpsellCard({
  service,
  isSelected,
  onToggle,
}: {
  service: BookingSelectService;
  isSelected: boolean;
  onToggle: () => void;
}) {
  const duration = service.DurationMinutes ?? 30;
  return (
    <button
      type="button"
      onClick={onToggle}
      className="w-full rounded-xl border p-3 text-right transition-all"
      style={{
        borderColor: isSelected ? GOLD : BORDER,
        background: isSelected ? GOLD_BG : 'var(--surface-muted)',
      }}
    >
      <div className="flex items-center gap-3">
        <div
          className="w-5 h-5 rounded-md border-2 flex items-center justify-center flex-shrink-0"
          style={{
            borderColor: isSelected ? GOLD : BORDER,
            background: isSelected ? GOLD : 'transparent',
          }}
        >
          {isSelected && <Check className="w-3 h-3" style={{ color: 'var(--primary-foreground)' }} />}
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-bold text-sm text-foreground">{service.ProName}</p>
          {service.CatName && (
            <p className="text-[10px] text-muted-foreground mt-0.5">{service.CatName}</p>
          )}
        </div>
        <div className="text-left flex-shrink-0">
          <p className="font-bold text-xs" style={{ color: GOLD }}>+{service.SPrice} ج</p>
          <p className="text-[10px] text-muted-foreground">{duration} د</p>
        </div>
      </div>
    </button>
  );
}

const PRIMARY_BADGES: Record<string, string> = {
  'Hair Cut': 'الأكثر طلبًا',
  'Haircut & Beard': 'باكدج مميز',
  'Hair & Beard': 'باكدج مميز',
};

export function BookingServiceSelect({
  services,
  selectedIds,
  onSelectMain,
  onToggleAddon,
  isLoading = false,
}: Props) {
  const [activeAddonTab, setActiveAddonTab] = useState<AddonCatKey>('skincare');
  const [serviceSearchQuery, setServiceSearchQuery] = useState('');
  const deferredSearchQuery = useDeferredValue(serviceSearchQuery);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const clearSearch = useCallback(() => {
    setServiceSearchQuery('');
  }, []);

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      if (event.key !== '/') return;
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase();
      const isEditable =
        tag === 'input' ||
        tag === 'textarea' ||
        tag === 'select' ||
        target?.isContentEditable;
      if (isEditable) return;
      event.preventDefault();
      searchInputRef.current?.focus();
    };
    window.addEventListener('keydown', handleShortcut);
    return () => window.removeEventListener('keydown', handleShortcut);
  }, []);

  const findByNames = (names: string[]): BookingSelectService | null => {
    for (const n of names) {
      const s = services.find((sv) => sv.ProName.trim() === n && isServiceVisible(sv));
      if (s) return s;
    }
    for (const n of names) {
      const s = services.find((sv) => flexMatch(sv.ProName, [n]) && isServiceVisible(sv));
      if (s) return s;
    }
    return null;
  };

  const mainPrimary = useMemo(() => {
    const result: BookingSelectService[] = [];
    for (const slot of PRIMARY_SLOTS) {
      const s = findByNames(slot.names);
      if (s) result.push(s);
    }
    return result;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [services]);

  const mainSecondary = useMemo(() => {
    return SECONDARY_NAMES
      .map((n) => {
        const exact = services.find((s) => s.ProName.trim() === n && isServiceVisible(s));
        if (exact) return exact;
        return services.find((s) => flexMatch(s.ProName, [n]) && isServiceVisible(s)) ?? null;
      })
      .filter((s): s is BookingSelectService => s != null);
  }, [services]);

  const allMainIds = useMemo(() => {
    const ids = new Set<number>();
    services.forEach((s) => {
      if (flexMatch(s.ProName, ALL_MAIN_VARIATIONS)) ids.add(s.ProID);
    });
    mainPrimary.forEach((s) => ids.add(s.ProID));
    mainSecondary.forEach((s) => ids.add(s.ProID));
    return ids;
  }, [services, mainPrimary, mainSecondary]);

  const addonServices = useMemo(
    () => services.filter((s) => isServiceVisible(s) && !allMainIds.has(s.ProID)),
    [services, allMainIds],
  );

  const addonGrouped = useMemo(() => {
    const map: Record<AddonCatKey, BookingSelectService[]> = {
      skincare: [], masks: [], hair: [], beard_face: [], comfort: [], other: [],
    };
    const placed = new Set<number>();

    for (const cat of ADDON_CATEGORIES) {
      for (const s of addonServices) {
        if (placed.has(s.ProID)) continue;
        if (flexMatch(s.ProName, cat.serviceNames)) {
          map[cat.key].push(s);
          placed.add(s.ProID);
        }
      }
    }

    for (const s of addonServices) {
      if (placed.has(s.ProID)) continue;
      const lower = s.ProName.toLowerCase();
      if (lower.includes('mask') || lower.includes('ماسك')) map.masks.push(s);
      else if (lower.includes('skin') || lower.includes('بشرة')) map.skincare.push(s);
      else if (lower.includes('beard') || lower.includes('دقن') || lower.includes('wax') || lower.includes('thread') || lower.includes('فتلة')) map.beard_face.push(s);
      else if (lower.includes('towel') || lower.includes('فوطة') || lower.includes('باديكير')) map.comfort.push(s);
      else map.other.push(s);
    }

    return map;
  }, [addonServices]);

  const visibleTabs = useMemo(() => {
    const tabs = ADDON_CATEGORIES.filter((c) => addonGrouped[c.key].length > 0);
    if (addonGrouped.other.length > 0) {
      tabs.push({ key: 'other', label: 'إضافات أخرى', icon: Plus, serviceNames: [] });
    }
    return tabs;
  }, [addonGrouped]);

  const selectedMainId = useMemo(
    () => selectedIds.find((id) => allMainIds.has(id)) ?? null,
    [selectedIds, allMainIds],
  );

  const hasMainSelection = selectedMainId !== null;
  const effectiveTab = visibleTabs.find((t) => t.key === activeAddonTab)?.key ?? visibleTabs[0]?.key ?? 'skincare';

  const visibleServices = useMemo(
    () => services.filter(isServiceVisible),
    [services],
  );
  const showFallbackList = mainPrimary.length + mainSecondary.length === 0 && visibleServices.length > 0;

  const selectedAddonCount = useMemo(
    () => selectedIds.filter((id) => !allMainIds.has(id)).length,
    [selectedIds, allMainIds],
  );
  const addonsOnly = !hasMainSelection && selectedAddonCount > 0;

  const searchablePool = useMemo((): Service[] => {
    return visibleServices.map((s) => ({
      ProID: s.ProID,
      ProName: s.ProName,
      ProNameAr: null,
      SPrice1: s.SPrice,
      Bonus: 0,
      CatID: null,
      CatName: s.CatName ?? null,
      SalesCount: 0,
      ImageUrl: null,
    }));
  }, [visibleServices]);

  const searchMatchedServices = useMemo(() => {
    const ranked = searchServices(searchablePool, deferredSearchQuery);
    const byId = new Map(visibleServices.map((s) => [s.ProID, s]));
    return ranked
      .map((s) => byId.get(s.ProID))
      .filter((s): s is BookingSelectService => s != null);
  }, [searchablePool, deferredSearchQuery, visibleServices]);

  const isSearchActive = serviceSearchQuery.trim().length > 0;

  const handleSearchResultSelect = useCallback(
    (service: BookingSelectService) => {
      if (allMainIds.has(service.ProID)) {
        onSelectMain(service.ProID);
      } else {
        onToggleAddon(service.ProID);
      }
    },
    [allMainIds, onSelectMain, onToggleAddon],
  );

  if (isLoading) {
    return (
      <div className="space-y-3 py-2">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-24 rounded-2xl border animate-pulse" style={{ borderColor: BORDER, background: 'var(--surface-muted)' }} />
        ))}
      </div>
    );
  }

  if (services.length === 0) {
    return (
      <div className="py-8 text-center">
        <Scissors className="w-8 h-8 mx-auto text-muted-foreground/50 mb-2" />
        <p className="text-sm text-muted-foreground">لا توجد خدمات متاحة</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-bold text-foreground">اختر الخدمات</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            خدمة أساسية و/أو إضافات — أو إضافات فقط بدون خدمة رئيسية
          </p>
        </div>
        {addonsOnly && (
          <span
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[10px] font-bold"
            style={{ background: GOLD_BG, color: GOLD, border: `1px solid ${GOLD_BDR}` }}
          >
            <Plus className="w-3 h-3" />
            حجز إضافات فقط
          </span>
        )}
      </div>

      <ServiceSearchInput
        ref={searchInputRef}
        value={serviceSearchQuery}
        onChange={setServiceSearchQuery}
        onClear={clearSearch}
        resultCount={isSearchActive ? searchMatchedServices.length : undefined}
        className="w-full"
      />

      {isSearchActive ? (
        <div className="space-y-2">
          {searchMatchedServices.length === 0 ? (
            <div className="py-8 text-center rounded-xl border" style={{ borderColor: BORDER }}>
              <Scissors className="w-8 h-8 mx-auto text-muted-foreground/50 mb-2" />
              <p className="text-sm text-muted-foreground">لا توجد خدمات مطابقة للبحث</p>
              <button
                type="button"
                onClick={clearSearch}
                className="mt-3 text-xs font-bold underline"
                style={{ color: GOLD }}
              >
                مسح البحث
              </button>
            </div>
          ) : (
            searchMatchedServices.map((s) => {
              const isMain = allMainIds.has(s.ProID);
              const isSelected = selectedIds.includes(s.ProID);
              if (isMain) {
                return (
                  <SecondaryCard
                    key={s.ProID}
                    service={s}
                    isSelected={isSelected}
                    onSelect={() => handleSearchResultSelect(s)}
                  />
                );
              }
              return (
                <UpsellCard
                  key={s.ProID}
                  service={s}
                  isSelected={isSelected}
                  onToggle={() => handleSearchResultSelect(s)}
                />
              );
            })
          )}
        </div>
      ) : (
        <>
          {showFallbackList && (
            <div className="space-y-2">
              {visibleServices.map((s) => (
                <PrimaryCard
                  key={s.ProID}
                  service={s}
                  isSelected={selectedIds.includes(s.ProID)}
                  onSelect={() => onSelectMain(s.ProID)}
                />
              ))}
            </div>
          )}

          {!showFallbackList && (
            <div>
              <h4 className="text-xs font-bold text-muted-foreground mb-2">الخدمة الأساسية (اختياري)</h4>
              {mainPrimary.length > 0 && (
                <div className="space-y-2">
                  {mainPrimary.map((s) => (
                    <PrimaryCard
                      key={s.ProID}
                      service={s}
                      isSelected={selectedIds.includes(s.ProID)}
                      onSelect={() => onSelectMain(s.ProID)}
                      badge={PRIMARY_BADGES[s.ProName] ?? (flexMatch(s.ProName, ['Hair Cut', 'Haircut']) ? 'الأكثر طلبًا' : flexMatch(s.ProName, ['Haircut & Beard', 'Hair & Beard']) ? 'باكدج مميز' : undefined)}
                    />
                  ))}
                </div>
              )}

              {mainSecondary.length > 0 && (
                <div className={mainPrimary.length > 0 ? 'mt-3' : undefined}>
                  <div className="flex items-center gap-2 mb-2">
                    <div className="h-px flex-1" style={{ background: BORDER }} />
                    <span className="text-[10px] font-bold text-muted-foreground whitespace-nowrap">اختيارات أخرى</span>
                    <div className="h-px flex-1" style={{ background: BORDER }} />
                  </div>
                  <div className="space-y-2">
                    {mainSecondary.map((s) => (
                      <SecondaryCard
                        key={s.ProID}
                        service={s}
                        isSelected={selectedIds.includes(s.ProID)}
                        onSelect={() => onSelectMain(s.ProID)}
                      />
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {visibleTabs.length > 0 && (
            <div className="pt-4 border-t" style={{ borderColor: BORDER }}>
              <div className="flex items-center gap-2 mb-1">
                <div className="w-6 h-6 rounded-md flex items-center justify-center" style={{ background: GOLD_BG }}>
                  <Plus className="w-3 h-3" style={{ color: GOLD }} />
                </div>
                <h4 className="font-bold text-sm text-foreground">خدمات إضافية</h4>
              </div>
              <p className="text-[11px] text-muted-foreground mb-3 mr-8">
                يمكن الحجز بها وحدها بدون خدمة أساسية
              </p>

              <div className="flex gap-1.5 mb-3 overflow-x-auto pb-1">
                {visibleTabs.map((tab) => {
                  const isActive = effectiveTab === tab.key;
                  const TabIcon = tab.icon;
                  const count = addonGrouped[tab.key].length;
                  return (
                    <button
                      key={tab.key}
                      type="button"
                      onClick={() => setActiveAddonTab(tab.key)}
                      className="flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-bold transition-all whitespace-nowrap"
                      style={{
                        background: isActive ? GOLD : 'var(--surface-muted)',
                        color: isActive ? 'var(--primary-foreground)' : 'var(--muted-foreground)',
                      }}
                    >
                      <TabIcon className="w-3 h-3" />
                      {tab.label}
                      {!isActive && (
                        <span className="w-4 h-4 rounded-full text-[9px] leading-4 text-center inline-block bg-muted text-muted-foreground">
                          {count}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>

              <div className="space-y-2">
                {(addonGrouped[effectiveTab] ?? []).map((s) => (
                  <UpsellCard
                    key={s.ProID}
                    service={s}
                    isSelected={selectedIds.includes(s.ProID)}
                    onToggle={() => onToggleAddon(s.ProID)}
                  />
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

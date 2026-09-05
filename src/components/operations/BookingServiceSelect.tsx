'use client';

import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { Scissors, Clock, Banknote, Check, Search } from 'lucide-react';
import type { Service } from '@/lib/types';
import { searchServices } from '@/lib/serviceSearch';
import ServiceSearchInput from '@/components/pos/ServiceSearchInput';
import {
  isOpsMainService,
  resolveOpsPopularServices,
  type OpsCatalogService,
} from '@/lib/operations/opsPopularServices';

export interface BookingSelectService {
  ProID: number;
  ProName: string;
  ProNameEn?: string | null;
  SPrice: number;
  DurationMinutes: number | null;
  CatName?: string | null;
  CatID?: string | number | null;
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
const SURFACE = 'var(--surface)';

function isServiceVisible(s: BookingSelectService): boolean {
  return Boolean(s.ProName?.trim()) && (s.SPrice ?? 0) > 0;
}

function categoryKey(s: BookingSelectService): string {
  if (s.CatID != null && String(s.CatID).trim() !== '') return `id:${s.CatID}`;
  const name = (s.CatName ?? '').trim();
  return name ? `name:${name}` : 'none';
}

function categoryLabel(s: BookingSelectService): string {
  return (s.CatName ?? '').trim() || 'أخرى';
}

function DenseServiceRow({
  service,
  isSelected,
  onToggle,
  mode,
}: {
  service: BookingSelectService;
  isSelected: boolean;
  onToggle: () => void;
  mode: 'main' | 'addon';
}) {
  const duration = service.DurationMinutes ?? 30;
  return (
    <button
      type="button"
      onClick={onToggle}
      className="w-full min-h-[52px] rounded-xl border px-3 py-2.5 text-right transition-colors min-w-0"
      style={{
        borderColor: isSelected ? GOLD : BORDER,
        background: isSelected ? GOLD_BG : 'transparent',
      }}
      aria-pressed={isSelected}
    >
      <div className="flex items-center gap-3 min-w-0">
        <div
          className={`shrink-0 flex items-center justify-center border-2 ${
            mode === 'addon' ? 'w-5 h-5 rounded-md' : 'w-5 h-5 rounded-full'
          }`}
          style={{
            borderColor: isSelected ? GOLD : BORDER,
            background: isSelected ? GOLD : 'transparent',
          }}
        >
          {isSelected && <Check className="w-3 h-3" style={{ color: 'var(--primary-foreground)' }} />}
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-sm text-foreground truncate">{service.ProName}</p>
          <p className="text-[11px] text-muted-foreground mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <span className="inline-flex items-center gap-1 font-bold" style={{ color: GOLD }}>
              <Banknote className="w-3 h-3" />
              {service.SPrice} ج.م
            </span>
            <span className="inline-flex items-center gap-1">
              <Clock className="w-3 h-3" />
              {duration} د
            </span>
          </p>
        </div>
      </div>
    </button>
  );
}

function PopularCard({
  labelAr,
  service,
  isSelected,
  onSelect,
}: {
  labelAr: string;
  service: BookingSelectService;
  isSelected: boolean;
  onSelect: () => void;
}) {
  const duration = service.DurationMinutes ?? 30;
  return (
    <button
      type="button"
      onClick={onSelect}
      className="w-full min-h-[72px] rounded-xl border p-3 text-right transition-colors min-w-0"
      style={{
        borderColor: isSelected ? GOLD : GOLD_BDR,
        background: isSelected ? GOLD_BG : SURFACE,
      }}
      aria-pressed={isSelected}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-bold text-muted-foreground mb-0.5">{labelAr}</p>
          <p className="font-bold text-sm text-foreground truncate">{service.ProName}</p>
          <p className="text-[11px] mt-1 flex items-center gap-2">
            <span className="font-bold" style={{ color: GOLD }}>{service.SPrice} ج.م</span>
            <span className="text-muted-foreground">{duration} د</span>
          </p>
        </div>
        <div
          className="w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0"
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

export function BookingServiceSelect({
  services,
  selectedIds,
  onSelectMain,
  onToggleAddon,
  isLoading = false,
}: Props) {
  const [activeCategory, setActiveCategory] = useState<string>('all');
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
        tag === 'input'
        || tag === 'textarea'
        || tag === 'select'
        || target?.isContentEditable;
      if (isEditable) return;
      event.preventDefault();
      searchInputRef.current?.focus();
    };
    window.addEventListener('keydown', handleShortcut);
    return () => window.removeEventListener('keydown', handleShortcut);
  }, []);

  const visibleServices = useMemo(
    () => services.filter(isServiceVisible),
    [services],
  );

  const popular = useMemo(
    () => resolveOpsPopularServices(visibleServices as OpsCatalogService[]),
    [visibleServices],
  );

  const popularIds = useMemo(
    () => new Set(popular.map((p) => p.service.ProID)),
    [popular],
  );

  const categories = useMemo(() => {
    const map = new Map<string, { key: string; label: string; count: number }>();
    for (const s of visibleServices) {
      const key = categoryKey(s);
      const label = categoryLabel(s);
      const prev = map.get(key);
      if (prev) prev.count += 1;
      else map.set(key, { key, label, count: 1 });
    }
    return Array.from(map.values()).sort((a, b) => a.label.localeCompare(b.label, 'ar'));
  }, [visibleServices]);

  useEffect(() => {
    if (activeCategory === 'all') return;
    if (!categories.some((c) => c.key === activeCategory)) {
      setActiveCategory('all');
    }
  }, [activeCategory, categories]);

  const isSearchActive = serviceSearchQuery.trim().length > 0;

  const searchablePool = useMemo((): Service[] => {
    return visibleServices.map((s) => ({
      ProID: s.ProID,
      ProName: s.ProName,
      ProNameAr: s.ProName,
      SPrice1: s.SPrice,
      Bonus: 0,
      CatID: typeof s.CatID === 'number' ? s.CatID : null,
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

  const categoryFiltered = useMemo(() => {
    if (activeCategory === 'all') return visibleServices;
    return visibleServices.filter((s) => categoryKey(s) === activeCategory);
  }, [visibleServices, activeCategory]);

  const listServices = isSearchActive ? searchMatchedServices : categoryFiltered;

  const handleSelect = useCallback(
    (service: BookingSelectService) => {
      if (isOpsMainService(service)) onSelectMain(service.ProID);
      else onToggleAddon(service.ProID);
    },
    [onSelectMain, onToggleAddon],
  );

  if (isLoading) {
    return (
      <div className="space-y-2 py-2 min-w-0">
        {[1, 2, 3, 4].map((i) => (
          <div
            key={i}
            className="h-14 rounded-xl border animate-pulse"
            style={{ borderColor: BORDER, background: 'var(--surface-muted)' }}
          />
        ))}
      </div>
    );
  }

  if (services.length === 0 || visibleServices.length === 0) {
    return (
      <div className="py-8 text-center">
        <Scissors className="w-8 h-8 mx-auto text-muted-foreground/50 mb-2" />
        <p className="text-sm text-muted-foreground">لا توجد خدمات متاحة</p>
      </div>
    );
  }

  return (
    <div className="space-y-4 min-w-0">
      <ServiceSearchInput
        ref={searchInputRef}
        value={serviceSearchQuery}
        onChange={setServiceSearchQuery}
        onClear={clearSearch}
        resultCount={isSearchActive ? searchMatchedServices.length : undefined}
        className="w-full"
      />

      {!isSearchActive && popular.length > 0 && (
        <section className="space-y-2" aria-label="الأكثر طلبًا">
          <h4 className="text-xs font-bold text-muted-foreground">الأكثر طلبًا</h4>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 min-w-0">
            {popular.map((p) => {
              const svc = p.service as BookingSelectService;
              return (
                <PopularCard
                  key={p.key}
                  labelAr={p.labelAr}
                  service={svc}
                  isSelected={selectedIds.includes(svc.ProID)}
                  onSelect={() => handleSelect(svc)}
                />
              );
            })}
          </div>
        </section>
      )}

      {!isSearchActive && categories.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-bold text-muted-foreground">التصنيفات</p>
          <div className="flex gap-1.5 overflow-x-auto pb-1 min-w-0">
            <button
              type="button"
              onClick={() => setActiveCategory('all')}
              className="flex-shrink-0 px-3 py-1.5 rounded-lg text-[11px] font-bold whitespace-nowrap"
              style={{
                background: activeCategory === 'all' ? GOLD : 'var(--surface-muted)',
                color: activeCategory === 'all' ? 'var(--primary-foreground)' : 'var(--muted-foreground)',
              }}
            >
              الكل ({visibleServices.length})
            </button>
            {categories.map((cat) => {
              const active = activeCategory === cat.key;
              return (
                <button
                  key={cat.key}
                  type="button"
                  onClick={() => setActiveCategory(cat.key)}
                  className="flex-shrink-0 px-3 py-1.5 rounded-lg text-[11px] font-bold whitespace-nowrap"
                  style={{
                    background: active ? GOLD : 'var(--surface-muted)',
                    color: active ? 'var(--primary-foreground)' : 'var(--muted-foreground)',
                  }}
                >
                  {cat.label} ({cat.count})
                </button>
              );
            })}
          </div>
        </div>
      )}

      <section className="space-y-2" aria-label="قائمة الخدمات">
        {!isSearchActive && (
          <h4 className="text-xs font-bold text-muted-foreground">
            {activeCategory === 'all' ? 'كل الخدمات' : 'خدمات التصنيف'}
          </h4>
        )}

        {listServices.length === 0 ? (
          <div className="py-8 text-center rounded-xl border" style={{ borderColor: BORDER }}>
            <Search className="w-7 h-7 mx-auto text-muted-foreground/50 mb-2" />
            <p className="text-sm text-muted-foreground">
              {isSearchActive ? 'لا توجد خدمات مطابقة للبحث' : 'لا توجد خدمات في هذا التصنيف'}
            </p>
            {isSearchActive && (
              <button
                type="button"
                onClick={clearSearch}
                className="mt-3 text-xs font-bold underline"
                style={{ color: GOLD }}
              >
                مسح البحث
              </button>
            )}
          </div>
        ) : (
          <div className="space-y-2">
            {listServices.map((s) => {
              const isMain = isOpsMainService(s);
              // Same underlying selection whether the service also appears under Popular.
              const isSelected = selectedIds.includes(s.ProID);
              // In "all" list, still show popular services (shared selection state) — denser ops list.
              return (
                <DenseServiceRow
                  key={s.ProID}
                  service={s}
                  isSelected={isSelected}
                  mode={isMain ? 'main' : 'addon'}
                  onToggle={() => handleSelect(s)}
                />
              );
            })}
          </div>
        )}
      </section>

      {popularIds.size > 0 && !isSearchActive && activeCategory === 'all' && (
        <p className="text-[10px] text-muted-foreground">
          الخدمات الشائعة تظهر أعلاه وفي القائمة — الاختيار واحد لنفس الخدمة.
        </p>
      )}
    </div>
  );
}

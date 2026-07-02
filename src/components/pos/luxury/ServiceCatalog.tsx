'use client';

import { useState, useEffect, useMemo, useRef, useDeferredValue, useCallback } from 'react';
import { Plus, Flame, Clock, LayoutGrid } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Service, Barber, CartItem } from '@/lib/types';
import { getCategoryTheme } from '@/lib/categoryTheme';
import { searchServices, resolveVisibleServices } from '@/lib/serviceSearch';
import ServiceSearchInput from '@/components/pos/ServiceSearchInput';

interface ServiceCatalogProps {
  services: Service[];
  selectedBarber: Barber | null;
  onAddItem: (item: CartItem) => void;
}

interface CategoryTab {
  id: string;  // 'all' for all categories, otherwise CatID as string
  name: string;
  icon: React.ReactNode;
  count: number;
}


// Fallback images when ImageUrl is not set in the database
const getServiceImage = (serviceName: string, category: string): string => {
  const images: Record<string, string> = {
    'hair': '/services/haircut.jpg',
    'beard': '/services/beard.jpeg',
    'care': '/services/basic.jpeg',
    'packages': '/services/hb.jpeg',
  };

  if (serviceName.includes('قص') || serviceName.includes('شعر')) return images['hair'];
  if (serviceName.includes('ذقن') || serviceName.includes('عادي')) return images['beard'];
  if (serviceName.includes('عناية') || serviceName.includes('بشرة')) return images['care'];

  return images[category] || images['hair'];
};

// Service duration mapping
const getServiceDuration = (serviceName: string): number => {
  const durations: Record<string, number> = {
    'قص شعر فاخر': 40,
    'قص شعر عادي': 30,
    'حلاقة الذقن': 20,
    'تصفيف شعر': 25,
  };
  return durations[serviceName] || 30;
};

export default function ServiceCatalog({ services, selectedBarber, onAddItem }: ServiceCatalogProps) {
  const [activeTab, setActiveTab] = useState<string>('hot');
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

  // Auto-select first service when barber is selected (if cart is empty)
  useEffect(() => {
    if (selectedBarber && services.length > 0) {
      // Check if we should auto-select (only when no items in cart)
      // This will be handled by the parent component
    }
  }, [selectedBarber, services]);

  // Extract unique categories from services
  const categories = useMemo(() => {
    const catMap = new Map<number | null, { id: number | null; name: string; count: number }>();

    // Add 'Hot' category (most popular)
    const hotServices = services.filter(s => s.SalesCount > 0).sort((a, b) => b.SalesCount - a.SalesCount).slice(0, 10);
    catMap.set(null, { id: null, name: 'الأكثر طلباً', count: hotServices.length });

    // Add 'All' category
    catMap.set(-1, { id: -1, name: 'الكل', count: services.length });

    // Count services per category
    for (const svc of services) {
      const catId = svc.CatID ?? null;
      const catName = svc.CatName || 'أخرى';

      if (!catMap.has(catId)) {
        catMap.set(catId, { id: catId, name: catName, count: 0 });
      }
      catMap.get(catId)!.count += 1;
    }

    return Array.from(catMap.values());
  }, [services]);

  // Create tabs from categories
  const categoryTabs: CategoryTab[] = useMemo(() => {
    return categories.map(cat => {
      let id: string;
      let icon: React.ReactNode;

      if (cat.id === null) {
        id = 'hot';
        icon = <Flame className="w-4 h-4" />;
      } else if (cat.id === -1) {
        id = 'all';
        icon = <LayoutGrid className="w-4 h-4" />;
      } else {
        id = String(cat.id);
        const t = getCategoryTheme(cat.name, cat.id);
        icon = <span style={{ fontSize: '14px', lineHeight: 1 }}>{t.emoji}</span>;
      }

      return { id, name: cat.name, icon, count: cat.count };
    });
  }, [categories]);

  // Filter services by active category
  const categoryServices = useMemo(() => {
    if (activeTab === 'hot') {
      // Return top 10 most popular services
      return services
        .filter(s => s.SalesCount > 0)
        .sort((a, b) => b.SalesCount - a.SalesCount)
        .slice(0, 10);
    }
    if (activeTab === 'all') return services;
    const activeCatId = parseInt(activeTab);
    return services.filter(s => s.CatID === activeCatId);
  }, [services, activeTab]);

  const filteredServices = useMemo(() => {
    return resolveVisibleServices(services, categoryServices, deferredSearchQuery);
  }, [services, categoryServices, deferredSearchQuery]);

  const isSearchActive = serviceSearchQuery.trim().length > 0;

  // Get hot threshold (top 3 by sales from filtered services)
  const hotThreshold = useMemo(() => {
    const sorted = [...filteredServices].sort((a, b) => b.SalesCount - a.SalesCount);
    return sorted[2]?.SalesCount ?? 0;
  }, [filteredServices]);

  // Module-level counter for unique IDs
  const [itemCounter, setItemCounter] = useState(0);

  const handleAddService = (svc: Service) => {
    if (!selectedBarber) return;
    const newCounter = itemCounter + 1;
    setItemCounter(newCounter);

    const item: CartItem = {
      id: `svc-${svc.ProID}-${selectedBarber.EmpID}-${newCounter}`,
      // id: `${Date.now()}-${Math.random()}`.slice(0, 50), // fallback unique id
      ProID: svc.ProID,
      ProName: svc.ProName,
      EmpID: selectedBarber.EmpID,
      EmpName: selectedBarber.EmpName,
      SPrice: svc.SPrice1,
      Bonus: svc.Bonus ?? 0,
      Qty: 1,
      Dis: 0,
      DisVal: 0,
      SPriceAfterDis: svc.SPrice1,
    };
    onAddItem(item);
  };

  return (
    <div className="w-full">
      {/* Section Header + Search */}
      <div className="mb-4 flex flex-col gap-3">
        <h3 className="text-lg font-bold text-foreground">اختر الخدمة</h3>

        <div className="flex flex-col gap-2 min-[480px]:flex-row min-[480px]:items-start min-[480px]:justify-between min-[480px]:gap-4">
          <ServiceSearchInput
            ref={searchInputRef}
            value={serviceSearchQuery}
            onChange={setServiceSearchQuery}
            onClear={clearSearch}
            resultCount={isSearchActive ? filteredServices.length : undefined}
            className="w-full min-[480px]:w-[min(100%,480px)] min-[480px]:max-w-[480px] min-[480px]:min-w-[280px]"
          />
          <div className="flex shrink-0 items-center gap-2 self-start pt-2 min-[480px]:pt-2.5">
            <span className="text-xs text-muted-foreground">الأكثر طلباً</span>
            <Flame className="h-4 w-4 text-warning" />
          </div>
        </div>
      </div>

      {/* Category Tabs */}
      <div className="scrollbar-none md:scrollbar-luxury -mx-1 mb-4 flex items-center gap-2 overflow-x-auto px-1 pb-2">
        {categoryTabs.map((tab) => {
          const isActive = activeTab === tab.id;
          // For special tabs (hot/all) use gold, for category tabs use their theme color
          const isSpecial = tab.id === 'hot' || tab.id === 'all';
          const catId = isSpecial ? null : parseInt(tab.id);
          const theme = isSpecial ? null : getCategoryTheme(tab.name, catId);

          const activeStyle = isSpecial
            ? { backgroundColor: 'var(--primary)', color: 'var(--primary-foreground)', borderColor: 'var(--primary)', border: '1px solid' }
            : (theme ? { ...theme.badgeStyle, padding: undefined } : {});

          const inactiveStyle = {
            backgroundColor: 'var(--surface)',
            color: 'var(--muted-foreground)',
            borderColor: 'var(--border)',
            border: '1px solid',
          };

          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              style={isActive ? activeStyle : inactiveStyle}
              className="flex min-h-10 shrink-0 items-center gap-2 whitespace-nowrap rounded-xl px-4 py-2 text-sm font-medium transition-all"
            >
              {tab.icon}
              <span>{tab.name}</span>
              <span style={{
                fontSize: '11px', padding: '1px 6px', borderRadius: '9999px',
                backgroundColor: isActive ? 'color-mix(in srgb, var(--background) 20%, transparent)' : 'color-mix(in srgb, var(--foreground) 8%, transparent)',
                color: isActive ? 'inherit' : 'var(--muted-foreground)',
              }}>
                {tab.count}
              </span>
            </button>
          );
        })}
      </div>

      {/* Services Grid */}
      <div className="grid min-w-0 grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-2.5 sm:gap-3">
        {filteredServices.map((svc) => {
          const isHot = svc.SalesCount >= hotThreshold && svc.SalesCount > 0;
          const duration = getServiceDuration(svc.ProName);
          const imageUrl = svc.ImageUrl || getServiceImage(svc.ProName, svc.CatName || '');
          const isDisabled = !selectedBarber;

          return (
            <div
              key={svc.ProID}
              className={cn(
                'group relative overflow-hidden rounded-xl border border-border bg-surface transition-all duration-300',
                !isDisabled && 'hover:border-primary/50 hover:shadow-lg hover:shadow-primary/10',
                isDisabled && 'cursor-not-allowed opacity-60'
              )}
            >
              {/* Hot Badge */}
              {isHot && (
                <div className="absolute top-2 left-2 z-10">
                  <div className="flex h-7 w-7 items-center justify-center rounded-full bg-gradient-to-br from-orange-400 to-red-500 shadow-lg">
                    <Flame className="h-3.5 w-3.5 text-primary-foreground" />
                  </div>
                </div>
              )}

              {/* Service Image */}
              <div className="relative h-16 overflow-hidden sm:h-[4.5rem]">
                <img
                  src={imageUrl}
                  alt={svc.ProName}
                  className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-110"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-[var(--surface)] via-transparent to-transparent" />
              </div>

              {/* Service Info */}
              <div className="p-2.5">
                {/* Service Name */}
                <div className="mb-1.5">
                  <h4 className="line-clamp-2 text-sm font-medium leading-snug text-foreground">
                    {svc.ProNameAr || svc.ProName}
                  </h4>
                  {svc.ProNameAr && svc.ProName !== svc.ProNameAr && (
                    <p className="mt-0.5 line-clamp-1 text-[11px] text-muted-foreground max-sm:hidden">
                      {svc.ProName}
                    </p>
                  )}
                </div>

                {/* Price & Duration */}
                <div className="mb-2 flex items-center justify-between gap-1">
                  <span className="text-base font-bold text-primary">
                    {svc.SPrice1} <span className="text-xs">ج.م</span>
                  </span>
                  <div className="flex shrink-0 items-center gap-1 text-muted-foreground">
                    <Clock className="h-3 w-3" />
                    <span className="text-[11px]">{duration} د</span>
                  </div>
                </div>

                {/* Add Button */}
                <button
                  type="button"
                  onClick={() => handleAddService(svc)}
                  disabled={isDisabled}
                  className={cn(
                    'flex min-h-10 w-full items-center justify-center gap-1.5 rounded-lg py-1.5 text-xs font-medium transition-all',
                    isDisabled
                      ? 'cursor-not-allowed bg-surface-muted text-muted-foreground/50'
                      : 'border border-primary/30 bg-primary/10 text-primary hover:bg-primary hover:text-primary-foreground active:scale-95'
                  )}
                >
                  <Plus className="h-3.5 w-3.5" />
                  إضافة
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* No Services Message */}
      {filteredServices.length === 0 && (
        <div className="py-12 text-center">
          {isSearchActive ? (
            <div className="mx-auto max-w-sm space-y-4">
              <div className="space-y-2">
                <p className="text-base font-semibold text-foreground">لم نجد خدمة مطابقة</p>
                <p className="text-sm text-muted-foreground">
                  جرّب كتابة اسم أقصر أو استخدم كلمة مثل حلاقة، دقن أو بشرة.
                </p>
              </div>
              <div className="flex flex-wrap items-center justify-center gap-2">
                <button
                  type="button"
                  onClick={clearSearch}
                  className="rounded-xl border border-primary/40 bg-primary/10 px-4 py-2 text-sm font-medium text-primary transition-colors hover:bg-primary/20"
                >
                  مسح البحث
                </button>
                {activeTab !== 'all' && (
                  <button
                    type="button"
                    onClick={() => setActiveTab('all')}
                    className="rounded-xl border border-border bg-surface px-4 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-surface-muted hover:text-foreground"
                  >
                    عرض كل الخدمات
                  </button>
                )}
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">لا توجد خدمات في هذا القسم</p>
          )}
        </div>
      )}
    </div>
  );
}

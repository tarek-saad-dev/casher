'use client';

import { useState, useEffect, useMemo } from 'react';
import { Plus, Flame, Clock, LayoutGrid } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Service, Barber, CartItem } from '@/lib/types';
import { getCategoryTheme } from '@/lib/categoryTheme';

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


// Service images mapping (using Unsplash barber images)
const getServiceImage = (serviceName: string, category: string): string => {
  const images: Record<string, string> = {
    'hair': 'https://images.unsplash.com/photo-1621605815971-fbc98d665033?w=400&h=300&fit=crop',
    'beard': 'https://images.unsplash.com/photo-1622286342621-4bd9c993e2be?w=400&h=300&fit=crop',
    'care': 'https://images.unsplash.com/photo-1560066984-138dadb4c035?w=400&h=300&fit=crop',
    'packages': 'https://images.unsplash.com/photo-1599351431202-0e671c16d7a7?w=400&h=300&fit=crop',
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
  const filteredServices = useMemo(() => {
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
      {/* Section Header */}
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-bold text-[#F7F1E5]">اختر الخدمة</h3>
        <div className="flex items-center gap-2">
          <span className="text-xs text-[#A7A29A]">الأكثر طلباً</span>
          <Flame className="w-4 h-4 text-orange-400" />
        </div>
      </div>

      {/* Category Tabs */}
      <div className="flex items-center gap-2 mb-4 overflow-x-auto pb-2 scrollbar-luxury">
        {categoryTabs.map((tab) => {
          const isActive = activeTab === tab.id;
          // For special tabs (hot/all) use gold, for category tabs use their theme color
          const isSpecial = tab.id === 'hot' || tab.id === 'all';
          const catId = isSpecial ? null : parseInt(tab.id);
          const theme = isSpecial ? null : getCategoryTheme(tab.name, catId);

          const activeStyle = isSpecial
            ? { backgroundColor: '#D6A84F', color: '#0B0B0D', borderColor: '#D6A84F', border: '1px solid' }
            : (theme ? { ...theme.badgeStyle, padding: undefined } : {});

          const inactiveStyle = {
            backgroundColor: '#16161A',
            color: '#A7A29A',
            borderColor: '#2A2A30',
            border: '1px solid',
          };

          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              style={isActive ? activeStyle : inactiveStyle}
              className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all whitespace-nowrap"
            >
              {tab.icon}
              <span>{tab.name}</span>
              <span style={{
                fontSize: '11px', padding: '1px 6px', borderRadius: '9999px',
                backgroundColor: isActive ? 'rgba(0,0,0,0.2)' : 'rgba(255,255,255,0.08)',
                color: isActive ? 'inherit' : '#6B6B6B',
              }}>
                {tab.count}
              </span>
            </button>
          );
        })}
      </div>

      {/* Services Grid */}
      <div className="grid grid-cols-4 gap-4">
        {filteredServices.map((svc) => {
          const isHot = svc.SalesCount >= hotThreshold && svc.SalesCount > 0;
          const duration = getServiceDuration(svc.ProName);
          const imageUrl = getServiceImage(svc.ProName, activeTab);
          const isDisabled = !selectedBarber;

          return (
            <div
              key={svc.ProID}
              className={cn(
                'group relative bg-[#16161A] rounded-2xl overflow-hidden border border-[#2A2A30] transition-all duration-300',
                !isDisabled && 'hover:border-[#D6A84F]/50 hover:shadow-lg hover:shadow-[#D6A84F]/10',
                isDisabled && 'opacity-60 cursor-not-allowed'
              )}
            >
              {/* Hot Badge */}
              {isHot && (
                <div className="absolute top-3 left-3 z-10">
                  <div className="w-8 h-8 rounded-full bg-gradient-to-br from-orange-400 to-red-500 flex items-center justify-center shadow-lg">
                    <Flame className="w-4 h-4 text-white" />
                  </div>
                </div>
              )}

              {/* Service Image */}
              <div className="relative h-32 overflow-hidden">
                <img
                  src={imageUrl}
                  alt={svc.ProName}
                  className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-110"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-[#16161A] via-transparent to-transparent" />
              </div>

              {/* Service Info */}
              <div className="p-3">
                {/* Service Name */}
                <div className="mb-2">
                  <h4 className="text-sm font-medium text-[#F7F1E5] line-clamp-1">
                    {svc.ProNameAr || svc.ProName}
                  </h4>
                  {svc.ProNameAr && svc.ProName !== svc.ProNameAr && (
                    <p className="text-xs text-[#A7A29A] line-clamp-1 mt-1">
                      {svc.ProName}
                    </p>
                  )}
                </div>

                {/* Price & Duration */}
                <div className="flex items-center justify-between mb-3">
                  <span className="text-lg font-bold text-[#D6A84F]">
                    {svc.SPrice1} <span className="text-sm">ج.م</span>
                  </span>
                  <div className="flex items-center gap-1 text-[#6B6B6B]">
                    <Clock className="w-3 h-3" />
                    <span className="text-xs">{duration} دقيقة</span>
                  </div>
                </div>

                {/* Add Button */}
                <button
                  onClick={() => handleAddService(svc)}
                  disabled={isDisabled}
                  className={cn(
                    'w-full flex items-center justify-center gap-2 py-2 rounded-xl text-sm font-medium transition-all',
                    isDisabled
                      ? 'bg-[#2A2A30] text-[#4A4A4A] cursor-not-allowed'
                      : 'bg-[#D6A84F]/10 text-[#D6A84F] border border-[#D6A84F]/30 hover:bg-[#D6A84F] hover:text-[#0B0B0D] active:scale-95'
                  )}
                >
                  <Plus className="w-4 h-4" />
                  إضافة
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* No Services Message */}
      {filteredServices.length === 0 && (
        <div className="text-center py-12">
          <p className="text-[#6B6B6B] text-sm">لا توجد خدمات في هذا القسم</p>
        </div>
      )}
    </div>
  );
}

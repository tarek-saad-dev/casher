'use client';

import { useState, useEffect, useMemo } from 'react';
import { Plus, Flame, Clock, LayoutGrid, Sparkles, Gift, Scissors, Heart, Star } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Service, Barber, CartItem } from '@/lib/types';

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

// Icons for categories based on keywords
const getCategoryIcon = (catName: string): React.ReactNode => {
  const name = catName.toLowerCase();
  if (name.includes('قص') || name.includes('شعر') || name.includes('حلاق')) {
    return <Scissors className="w-4 h-4" />;
  }
  if (name.includes('ذقن') || name.includes('عناية')) {
    return <Sparkles className="w-4 h-4" />;
  }
  if (name.includes('باقة') || name.includes('عرض') || name.includes('package')) {
    return <Gift className="w-4 h-4" />;
  }
  if (name.includes('بشرة') || name.includes('ماسك') || name.includes('-care')) {
    return <Heart className="w-4 h-4" />;
  }
  return <Star className="w-4 h-4" />;
};

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
        // Hot services tab
        id = 'hot';
        icon = <Flame className="w-4 h-4" />;
      } else if (cat.id === -1) {
        // All services tab
        id = 'all';
        icon = <LayoutGrid className="w-4 h-4" />;
      } else {
        // Regular category tabs
        id = String(cat.id);
        icon = getCategoryIcon(cat.name);
      }
      
      return {
        id,
        name: cat.name,
        icon,
        count: cat.count,
      };
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
        {categoryTabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={cn(
              'flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all whitespace-nowrap border',
              activeTab === tab.id
                ? 'bg-[#D6A84F] text-[#0B0B0D] border-[#D6A84F]'
                : 'bg-[#16161A] text-[#A7A29A] border-[#2A2A30] hover:border-[#3A3A40] hover:text-[#F7F1E5]'
            )}
          >
            {tab.icon}
            <span>{tab.name}</span>
            <span className={cn(
              'text-xs px-1.5 py-0.5 rounded-full',
              activeTab === tab.id ? 'bg-[#0B0B0D]/20 text-[#0B0B0D]' : 'bg-[#2A2A30] text-[#6B6B6B]'
            )}>
              {tab.count}
            </span>
          </button>
        ))}
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
                <h4 className="text-sm font-medium text-[#F7F1E5] mb-2 line-clamp-1">
                  {svc.ProName}
                </h4>

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

'use client';

import { useMemo } from 'react';
import { Plus, Flame } from 'lucide-react';
import type { Service, Barber, CartItem } from '@/lib/types';

interface ServiceGridProps {
  services: Service[];
  selectedBarber: Barber | null;
  onAddItem: (item: CartItem) => void;
}

interface CategoryGroup {
  catID: number | null;
  catName: string;
  services: Service[];
}

export default function ServiceGrid({ services, selectedBarber, onAddItem }: ServiceGridProps) {
  // Group services by category (already sorted by popularity from API)
  const categories = useMemo<CategoryGroup[]>(() => {
    const map = new Map<number | null, CategoryGroup>();
    for (const svc of services) {
      const key = svc.CatID ?? null;
      if (!map.has(key)) {
        map.set(key, {
          catID: key,
          catName: svc.CatName || 'أخرى',
          services: [],
        });
      }
      map.get(key)!.services.push(svc);
    }
    return Array.from(map.values());
  }, [services]);

  // Find popularity threshold for "hot" badge (top 5 most sold)
  const hotThreshold = useMemo(() => {
    const sorted = [...services].sort((a, b) => b.SalesCount - a.SalesCount);
    return sorted[4]?.SalesCount ?? Infinity;
  }, [services]);

  function handleClick(svc: Service) {
    if (!selectedBarber) return;
    const item: CartItem = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
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
  }

  return (
    <div>
      <h3 className="text-sm font-semibold text-muted-foreground mb-2">الخدمات</h3>
      {!selectedBarber && (
        <p className="text-xs text-yellow-500 mb-2">اختر الحلاق أولاً</p>
      )}
      <div className="space-y-4">
        {categories.map((cat) => (
          <div key={cat.catID ?? 'other'}>
            <div className="flex items-center gap-2 mb-2">
              <span className="text-xs font-bold text-muted-foreground bg-muted px-2 py-0.5 rounded">
                {cat.catName}
              </span>
              <div className="flex-1 border-t border-border" />
            </div>
            <div className="grid grid-cols-3 gap-2">
              {cat.services.map((svc) => {
                const isHot = svc.SalesCount >= hotThreshold && svc.SalesCount > 0;
                return (
                  <button
                    key={svc.ProID}
                    onClick={() => handleClick(svc)}
                    disabled={!selectedBarber}
                    className={`
                      group relative flex flex-col items-start p-3 rounded-lg border border-border
                      transition-all text-right
                      ${selectedBarber
                        ? 'hover:border-primary/50 hover:bg-primary/5 cursor-pointer active:scale-[0.98]'
                        : 'opacity-40 cursor-not-allowed'
                      }
                    `}
                  >
                    <span className="text-sm font-medium leading-tight mb-1">{svc.ProName}</span>
                    <span className="text-lg font-bold text-primary">{svc.SPrice1} ج.م</span>
                    {svc.Bonus > 0 && (
                      <span className="text-[10px] text-muted-foreground">بونص: {svc.Bonus}</span>
                    )}
                    {isHot && (
                      <div className="absolute left-2 top-2 flex items-center gap-0.5">
                        <Flame className="w-3 h-3 text-orange-400" />
                      </div>
                    )}
                    <div className="absolute left-2 bottom-2 opacity-0 group-hover:opacity-100 transition-opacity">
                      <Plus className="w-4 h-4 text-primary" />
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

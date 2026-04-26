'use client';

import { Plus, Clock, Crown, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Barber, CartItem } from '@/lib/types';

interface PackagesSectionProps {
  selectedBarber: Barber | null;
  onAddItem: (item: CartItem) => void;
}

interface Package {
  id: string;
  name: string;
  price: number;
  originalPrice: number;
  duration: number;
  image: string;
  includes: string[];
  popular?: boolean;
}

const PACKAGES: Package[] = [
  {
    id: 'pkg-1',
    name: 'ماسك علاجي',
    price: 50,
    originalPrice: 80,
    duration: 20,
    image: 'https://images.unsplash.com/photo-1560066984-138dadb4c035?w=400&h=300&fit=crop',
    includes: ['تنظيف بشرة', 'ماسك طبيعي', 'ترطيب'],
  },
  {
    id: 'pkg-2',
    name: 'تنظيف بشرة كامل',
    price: 300,
    originalPrice: 450,
    duration: 60,
    image: 'https://images.unsplash.com/photo-1622286342621-4bd9c993e2be?w=400&h=300&fit=crop',
    includes: ['قص شعر', 'حلاقة ذقن', 'تنظيف بشرة', 'ماسك'],
    popular: true,
  },
  {
    id: 'pkg-3',
    name: 'تنظيف بشرة عادي',
    price: 200,
    originalPrice: 280,
    duration: 40,
    image: 'https://images.unsplash.com/photo-1599351431202-0e671c16d7a7?w=400&h=300&fit=crop',
    includes: ['قص شعر عادي', 'تنظيف بشرة'],
  },
];

export default function PackagesSection({ selectedBarber, onAddItem }: PackagesSectionProps) {
  const isDisabled = !selectedBarber;

  const handleAddPackage = (pkg: Package) => {
    if (!selectedBarber) return;

    const item: CartItem = {
      // biome-ignore lint/correctness/useHookAtTopLevel: Event handler, not render
      id: `pkg-${pkg.id}-${selectedBarber.EmpID}-${Date.now()}`.slice(0, 50),
      ProID: parseInt(pkg.id.replace('pkg-', '')),
      ProName: pkg.name,
      EmpID: selectedBarber.EmpID,
      EmpName: selectedBarber.EmpName,
      SPrice: pkg.price,
      Bonus: 0,
      Qty: 1,
      Dis: 0,
      DisVal: 0,
      SPriceAfterDis: pkg.price,
    };
    onAddItem(item);
  };

  return (
    <div className="w-full mt-6">
      {/* Section Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <h3 className="text-lg font-bold text-[#F7F1E5]">العروض والباقات</h3>
          <Crown className="w-5 h-5 text-[#D6A84F]" />
        </div>
        <button className="flex items-center gap-1 text-sm text-[#D6A84F] hover:text-[#E8C877] transition-colors">
          عرض جميع الخدمات
          <ChevronDown className="w-4 h-4" />
        </button>
      </div>

      {/* Packages Grid */}
      <div className="grid grid-cols-3 gap-4">
        {PACKAGES.map((pkg) => (
          <div
            key={pkg.id}
            className={cn(
              'group relative bg-[#16161A] rounded-2xl overflow-hidden border transition-all duration-300',
              pkg.popular
                ? 'border-[#D6A84F]/50 shadow-lg shadow-[#D6A84F]/10'
                : 'border-[#2A2A30] hover:border-[#3A3A40]',
              !isDisabled && 'hover:shadow-lg hover:shadow-black/20'
            )}
          >
            {/* Popular Badge */}
            {pkg.popular && (
              <div className="absolute top-3 left-3 z-10">
                <div className="w-8 h-8 rounded-full bg-gradient-to-br from-[#D6A84F] to-[#B8963F] flex items-center justify-center shadow-lg">
                  <Crown className="w-4 h-4 text-[#0B0B0D]" />
                </div>
              </div>
            )}

            {/* Package Image */}
            <div className="relative h-36 overflow-hidden">
              <img
                src={pkg.image}
                alt={pkg.name}
                className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-110"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-[#16161A] via-[#16161A]/50 to-transparent" />
            </div>

            {/* Package Info */}
            <div className="p-4">
              {/* Package Name */}
              <h4 className="text-base font-bold text-[#F7F1E5] mb-2">
                {pkg.name}
              </h4>

              {/* Price Section */}
              <div className="flex items-center gap-2 mb-2">
                <span className="text-xl font-bold text-[#D6A84F]">
                  {pkg.price} ج.م
                </span>
                <span className="text-sm text-[#6B6B6B] line-through">
                  {pkg.originalPrice} ج.م
                </span>
              </div>

              {/* Duration */}
              <div className="flex items-center gap-1 text-[#6B6B6B] mb-3">
                <Clock className="w-3 h-3" />
                <span className="text-xs">{pkg.duration} دقيقة</span>
              </div>

              {/* Includes */}
              <div className="flex flex-wrap gap-1 mb-3">
                {pkg.includes.slice(0, 2).map((item, idx) => (
                  <span
                    key={idx}
                    className="text-[10px] bg-[#2A2A30] text-[#A7A29A] px-2 py-1 rounded-full"
                  >
                    {item}
                  </span>
                ))}
                {pkg.includes.length > 2 && (
                  <span className="text-[10px] bg-[#2A2A30] text-[#A7A29A] px-2 py-1 rounded-full">
                    +{pkg.includes.length - 2}
                  </span>
                )}
              </div>

              {/* Add Button */}
              <button
                onClick={() => handleAddPackage(pkg)}
                disabled={isDisabled}
                className={cn(
                  'w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-medium transition-all',
                  isDisabled
                    ? 'bg-[#2A2A30] text-[#4A4A4A] cursor-not-allowed'
                    : 'bg-[#D6A84F]/10 text-[#D6A84F] border border-[#D6A84F]/30 hover:bg-[#D6A84F] hover:text-[#0B0B0D] active:scale-95'
                )}
              >
                <Plus className="w-4 h-4" />
                إضافة للفاتورة
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

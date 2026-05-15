'use client';

import { useRef } from 'react';
import { Star, Check, ChevronLeft, ChevronRight, Users } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Barber } from '@/lib/types';

interface BarberCarouselProps {
  barbers: Barber[];
  selected: Barber | null;
  onSelect: (barber: Barber) => void;
}

// Barber images mapping
const BARBER_IMAGES: Record<string, string> = {
  'بلسم': '/barber-bassem.jpg',
  'بسم': '/barber-bassem.jpg',
  'زيد': '/barber-ziad.jpg',
  'محمد': '/barber-mohamed.jpg',
  'كريم': '/barber-kareem.jpg',
  'يوسف': '/barber-yousef.jpg',
};

// Employees without photos - will show initials placeholder
const NO_PHOTO_EMPLOYEES = ['ذياد', 'ذياد المساعد', 'أحمد الصنايعي', 'أحمد المساعد', 'عمر'];

// Barber colors for borders
const BARBER_COLORS = [
  'border-amber-500/80',
  'border-purple-500/80',
  'border-emerald-500/80',
  'border-blue-500/80',
  'border-rose-500/80',
  'border-cyan-500/80',
];

// Mock ratings (in production would come from API)
const getBarberRating = (name: string): number => {
  const ratings: Record<string, number> = {
    'بلسم': 4.8,
    'بسم': 4.8,
    'زيد': 4.7,
    'محمد': 4.9,
    'كريم': 4.8,
    'يوسف': 4.6,
  };
  return ratings[name] || 4.5;
};

export default function BarberCarousel({ barbers, selected, onSelect }: BarberCarouselProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  const scroll = (direction: 'left' | 'right') => {
    if (scrollRef.current) {
      const scrollAmount = 200;
      scrollRef.current.scrollBy({
        left: direction === 'left' ? -scrollAmount : scrollAmount,
        behavior: 'smooth',
      });
    }
  };

  return (
    <div className="w-full">
      {/* Section Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Users className="w-5 h-5 text-[#D6A84F]" />
          <h3 className="text-lg font-bold text-[#F7F1E5]">اختر الحلاق</h3>
          <span className="text-xs text-[#A7A29A] bg-[#2A2A30] px-2 py-0.5 rounded-full">
            {barbers.length}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => scroll('right')}
            className="w-7 h-7 rounded-full bg-[#1E1D21] text-[#D6A84F] hover:bg-[#2A2A30] flex items-center justify-center transition-all border border-[#2A2A30]"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
          <button
            onClick={() => scroll('left')}
            className="w-7 h-7 rounded-full bg-[#1E1D21] text-[#D6A84F] hover:bg-[#2A2A30] flex items-center justify-center transition-all border border-[#2A2A30]"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Horizontal Scrollable Barbers */}
      <div
        ref={scrollRef}
        className="flex gap-3 overflow-x-auto pb-3 scrollbar-thin scrollbar-thumb-[#D6A84F] scrollbar-track-[#2A2A30] scrollbar-thumb-rounded-full scrollbar-track-rounded-full"
        style={{
          scrollbarWidth: 'thin',
          msOverflowStyle: 'auto',
        }}
        dir="rtl"
      >
        {barbers.map((barber, idx) => {
          const isSelected = selected?.EmpID === barber.EmpID;
          const colorClass = BARBER_COLORS[idx % BARBER_COLORS.length];
          const rating = getBarberRating(barber.EmpName);
          const hasNoPhoto = NO_PHOTO_EMPLOYEES.includes(barber.EmpName);
          const imageSrc = hasNoPhoto ? undefined : (BARBER_IMAGES[barber.EmpName] || '/barber-bassem.jpg');
          const initials = barber.EmpName.split(' ').map(n => n[0]).join('').slice(0, 2);

          return (
            <button
              key={barber.EmpID}
              onClick={() => onSelect(barber)}
              className={cn(
                'group relative flex flex-col items-center p-3 rounded-2xl border transition-all duration-300 min-w-[100px] shrink-0',
                isSelected
                  ? `bg-[#1E1D21] ${colorClass} border-2 shadow-lg shadow-${colorClass.split('-')[1]}-500/20`
                  : 'bg-[#16161A] border-[#2A2A30] hover:border-[#3A3A40] hover:bg-[#1E1D21]'
              )}
            >
              {/* Profile Image or Initials Placeholder */}
              <div className={cn(
                'relative w-14 h-14 rounded-full overflow-hidden mb-2 border-2 transition-all duration-300 flex items-center justify-center',
                isSelected ? colorClass : 'border-[#2A2A30] group-hover:border-[#3A3A40]',
                hasNoPhoto ? 'bg-[#2A2A30]' : ''
              )}>
                {hasNoPhoto ? (
                  <span className="text-base font-bold text-[#D6A84F]">{initials}</span>
                ) : (
                  <img
                    src={imageSrc}
                    alt={barber.EmpName}
                    className="w-full h-full object-cover"
                  />
                )}
                {/* Selected Checkmark */}
                {isSelected && (
                  <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
                    <div className="w-5 h-5 rounded-full bg-[#D6A84F] flex items-center justify-center">
                      <Check className="w-3 h-3 text-[#0B0B0D]" />
                    </div>
                  </div>
                )}
              </div>

              {/* Barber Name */}
              <span className={cn(
                'text-xs font-medium mb-1 transition-colors truncate max-w-[80px]',
                isSelected ? 'text-[#F7F1E5]' : 'text-[#A7A29A] group-hover:text-[#F7F1E5]'
              )}>
                {barber.EmpName}
              </span>

              {/* Rating */}
              <div className="flex items-center gap-1">
                <Star className="w-3 h-3 fill-[#D6A84F] text-[#D6A84F]" />
                <span className="text-[10px] text-[#D6A84F] font-medium">{rating}</span>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

'use client';

import { useState } from 'react';
import { Star, Check, ChevronLeft, ChevronRight } from 'lucide-react';
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
  const [startIndex, setStartIndex] = useState(0);
  const visibleCount = 5;

  const handlePrev = () => {
    setStartIndex(prev => Math.max(0, prev - 1));
  };

  const handleNext = () => {
    setStartIndex(prev => Math.min(barbers.length - visibleCount, prev + 1));
  };

  const canGoPrev = startIndex > 0;
  const canGoNext = startIndex < barbers.length - visibleCount;

  const visibleBarbers = barbers.slice(startIndex, startIndex + visibleCount);

  return (
    <div className="w-full">
      {/* Section Header */}
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-bold text-[#F7F1E5]">اختر الحلاق</h3>
        <div className="flex items-center gap-2">
          <button
            onClick={handlePrev}
            disabled={!canGoPrev}
            className={cn(
              'w-8 h-8 rounded-full border border-[#2A2A30] flex items-center justify-center transition-all',
              canGoPrev
                ? 'bg-[#1E1D21] text-[#D6A84F] hover:bg-[#2A2A30] cursor-pointer'
                : 'bg-[#111114] text-[#4A4A4A] cursor-not-allowed'
            )}
          >
            <ChevronRight className="w-4 h-4" />
          </button>
          <button
            onClick={handleNext}
            disabled={!canGoNext}
            className={cn(
              'w-8 h-8 rounded-full border border-[#2A2A30] flex items-center justify-center transition-all',
              canGoNext
                ? 'bg-[#1E1D21] text-[#D6A84F] hover:bg-[#2A2A30] cursor-pointer'
                : 'bg-[#111114] text-[#4A4A4A] cursor-not-allowed'
            )}
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Barbers Grid */}
      <div className="grid grid-cols-5 gap-3">
        {visibleBarbers.map((barber, idx) => {
          const isSelected = selected?.EmpID === barber.EmpID;
          const colorClass = BARBER_COLORS[(startIndex + idx) % BARBER_COLORS.length];
          const rating = getBarberRating(barber.EmpName);
          const imageSrc = BARBER_IMAGES[barber.EmpName] || '/barber-bassem.jpg';

          return (
            <button
              key={barber.EmpID}
              onClick={() => onSelect(barber)}
              className={cn(
                'group relative flex flex-col items-center p-3 rounded-2xl border transition-all duration-300',
                isSelected
                  ? `bg-[#1E1D21] ${colorClass} border-2 shadow-lg shadow-${colorClass.split('-')[1]}-500/20`
                  : 'bg-[#16161A] border-[#2A2A30] hover:border-[#3A3A40] hover:bg-[#1E1D21]'
              )}
            >
              {/* Profile Image */}
              <div className={cn(
                'relative w-16 h-16 rounded-full overflow-hidden mb-2 border-2 transition-all duration-300',
                isSelected ? colorClass : 'border-[#2A2A30] group-hover:border-[#3A3A40]'
              )}>
                <img
                  src={imageSrc}
                  alt={barber.EmpName}
                  className="w-full h-full object-cover"
                />
                {/* Selected Checkmark */}
                {isSelected && (
                  <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
                    <div className="w-6 h-6 rounded-full bg-[#D6A84F] flex items-center justify-center">
                      <Check className="w-4 h-4 text-[#0B0B0D]" />
                    </div>
                  </div>
                )}
              </div>

              {/* Barber Name */}
              <span className={cn(
                'text-sm font-medium mb-1 transition-colors',
                isSelected ? 'text-[#F7F1E5]' : 'text-[#A7A29A] group-hover:text-[#F7F1E5]'
              )}>
                {barber.EmpName}
              </span>

              {/* Rating */}
              <div className="flex items-center gap-1 mb-1">
                <Star className="w-3 h-3 fill-[#D6A84F] text-[#D6A84F]" />
                <span className="text-xs text-[#D6A84F] font-medium">{rating}</span>
              </div>

              {/* Available Status */}
              <div className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                <span className="text-[10px] text-emerald-400">متاح الآن</span>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

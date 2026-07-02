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
          <Users className="w-5 h-5 text-primary" />
          <h3 className="text-lg font-bold text-foreground">اختر الحلاق</h3>
          <span className="text-xs text-muted-foreground bg-surface-muted px-2 py-0.5 rounded-full">
            {barbers.length}
          </span>
        </div>
        <div className="hidden items-center gap-1 md:flex">
          <button
            type="button"
            onClick={() => scroll('right')}
            aria-label="تمرير لليمين"
            className="flex h-7 w-7 items-center justify-center rounded-full border border-border bg-surface-muted text-primary transition-all hover:bg-surface-muted"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={() => scroll('left')}
            aria-label="تمرير لليسار"
            className="flex h-7 w-7 items-center justify-center rounded-full border border-border bg-surface-muted text-primary transition-all hover:bg-surface-muted"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Horizontal Scrollable Barbers */}
      <div
        ref={scrollRef}
        className="scrollbar-none md:scrollbar-luxury flex gap-2 overflow-x-auto pb-2 md:gap-3 md:pb-3"
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
              type="button"
              onClick={() => onSelect(barber)}
              className={cn(
                'group relative flex min-w-[92px] shrink-0 flex-col items-center rounded-2xl border p-2.5 transition-all duration-300 md:min-w-[100px] md:p-3',
                isSelected
                  ? `bg-surface-muted ${colorClass} border-2 shadow-lg shadow-primary/10`
                  : 'bg-surface border-border hover:border-muted hover:bg-surface-muted'
              )}
            >
              {/* Profile Image or Initials Placeholder */}
              <div className={cn(
                'relative mb-2 flex h-12 w-12 items-center justify-center overflow-hidden rounded-full border-2 transition-all duration-300 md:h-14 md:w-14',
                isSelected ? colorClass : 'border-border group-hover:border-muted',
                hasNoPhoto ? 'bg-surface-muted' : ''
              )}>
                {hasNoPhoto ? (
                  <span className="text-base font-bold text-primary">{initials}</span>
                ) : (
                  <img
                    src={imageSrc}
                    alt={barber.EmpName}
                    className="w-full h-full object-cover"
                  />
                )}
                {/* Selected Checkmark */}
                {isSelected && (
                  <div className="absolute inset-0 bg-background/40 flex items-center justify-center">
                    <div className="w-5 h-5 rounded-full bg-primary flex items-center justify-center">
                      <Check className="w-3 h-3 text-primary-foreground" />
                    </div>
                  </div>
                )}
              </div>

              {/* Barber Name */}
              <span className={cn(
                'text-xs font-medium mb-1 transition-colors truncate max-w-[80px]',
                isSelected ? 'text-foreground' : 'text-muted-foreground group-hover:text-foreground'
              )}>
                {barber.EmpName}
              </span>

              {/* Rating */}
              <div className="flex items-center gap-1">
                <Star className="w-3 h-3 fill-primary text-primary" />
                <span className="text-[10px] text-primary font-medium">{rating}</span>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

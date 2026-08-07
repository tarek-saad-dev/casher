'use client';

import { useRef, useState } from 'react';
import { Star, Check, ChevronLeft, ChevronRight, Users, UserRound } from 'lucide-react';
import { cn } from '@/lib/utils';
import { deriveAttendanceDisplay, type TeamAttendanceMember } from '@/lib/teamAttendance';
import NonBarberEmployeeModal from '@/components/pos/NonBarberEmployeeModal';
import type { Barber } from '@/lib/types';
import { resolvePosBarberImageUrl } from '@/lib/barberImages';

interface BarberCarouselProps {
  barbers: Barber[];
  otherEmployees?: Barber[];
  otherEmployeesLoading?: boolean;
  selected: Barber | null;
  onSelect: (barber: Barber) => void;
  attendanceByEmpId?: Map<number, TeamAttendanceMember>;
}

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
    'زياد': 4.7,
    'محمد': 4.9,
    'كريم': 4.8,
    'يوسف': 4.6,
  };
  return ratings[name] || 4.5;
};

function isBarberInList(barbers: Barber[], empId: number | undefined): boolean {
  if (empId == null) return false;
  return barbers.some((b) => b.EmpID === empId);
}

function barberInitials(name: string): string {
  return name
    .split(' ')
    .map((n) => n[0])
    .join('')
    .slice(0, 2);
}

function BarberAvatar({
  barber,
  colorClass,
  isSelected,
}: {
  barber: Barber;
  colorClass: string;
  isSelected: boolean;
}) {
  const imageSrc = resolvePosBarberImageUrl(barber.ImageUrl, barber.EmpName);
  const [broken, setBroken] = useState(false);
  const showPhoto = Boolean(imageSrc) && !broken;
  const initials = barberInitials(barber.EmpName);

  return (
    <div
      className={cn(
        'relative mb-2 flex h-16 w-16 items-center justify-center overflow-hidden rounded-full border-2 bg-surface-muted transition-all duration-300 md:h-[4.5rem] md:w-[4.5rem]',
        isSelected ? colorClass : 'border-border group-hover:border-muted',
      )}
    >
      {showPhoto ? (
        <img
          src={imageSrc!}
          alt={barber.EmpName}
          className="h-full w-full object-cover"
          loading="lazy"
          onError={() => setBroken(true)}
        />
      ) : (
        <span className="text-base font-bold text-primary">{initials}</span>
      )}
      {isSelected && (
        <div className="absolute inset-0 flex items-center justify-center bg-background/40">
          <div className="flex h-5 w-5 items-center justify-center rounded-full bg-primary">
            <Check className="h-3 w-3 text-primary-foreground" />
          </div>
        </div>
      )}
    </div>
  );
}

export default function BarberCarousel({
  barbers,
  otherEmployees = [],
  otherEmployeesLoading = false,
  selected,
  onSelect,
  attendanceByEmpId,
}: BarberCarouselProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [otherModalOpen, setOtherModalOpen] = useState(false);

  const selectedIsOther =
    !!selected && !isBarberInList(barbers, selected.EmpID);

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
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Users className="w-5 h-5 text-primary" />
          <h3 className="text-lg font-bold text-foreground">اختر الحلاق</h3>
          <span className="text-xs text-muted-foreground bg-surface-muted px-2 py-0.5 rounded-full">
            {barbers.length}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setOtherModalOpen(true)}
            className={cn(
              'inline-flex min-h-9 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors',
              selectedIsOther
                ? 'border-primary/40 bg-primary/10 text-primary'
                : 'border-border bg-surface text-muted-foreground hover:bg-surface-muted hover:text-foreground',
            )}
          >
            <UserRound className="h-3.5 w-3.5" />
            <span>
              {selectedIsOther
                ? selected.EmpName
                : 'اختر موظف غير حلاق'}
            </span>
          </button>
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
          const attendance = attendanceByEmpId?.get(barber.EmpID);
          const attendanceDisplay = attendance ? deriveAttendanceDisplay(attendance) : null;

          return (
            <button
              key={barber.EmpID}
              type="button"
              onClick={() => onSelect(barber)}
              className={cn(
                'group relative flex min-w-[100px] shrink-0 flex-col items-center rounded-2xl border p-2.5 transition-all duration-300 md:min-w-[112px] md:p-3',
                isSelected
                  ? `bg-surface-muted ${colorClass} border-2 shadow-lg shadow-primary/10`
                  : 'bg-surface border-border hover:border-muted hover:bg-surface-muted'
              )}
            >
              <BarberAvatar
                barber={barber}
                colorClass={colorClass}
                isSelected={isSelected}
              />

              {/* Barber Name */}
              <span className={cn(
                'text-xs font-medium mb-1 transition-colors truncate max-w-[80px]',
                isSelected ? 'text-foreground' : 'text-muted-foreground group-hover:text-foreground'
              )}>
                {barber.EmpName}
              </span>

              {attendanceDisplay && (
                <span
                  className={cn(
                    'mb-1 max-w-[88px] truncate rounded-full border px-1.5 py-0.5 text-[9px] font-medium',
                    attendanceDisplay.badgeClassName,
                  )}
                >
                  {attendanceDisplay.badgeLabel}
                </span>
              )}

              {/* Rating */}
              <div className="flex items-center gap-1">
                <Star className="w-3 h-3 fill-primary text-primary" />
                <span className="text-[10px] text-primary font-medium">{rating}</span>
              </div>
            </button>
          );
        })}
      </div>

      <NonBarberEmployeeModal
        open={otherModalOpen}
        onClose={() => setOtherModalOpen(false)}
        employees={otherEmployees}
        selected={selected}
        onSelect={onSelect}
        loading={otherEmployeesLoading}
      />
    </div>
  );
}

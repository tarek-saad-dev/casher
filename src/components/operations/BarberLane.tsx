'use client';

import { useState } from 'react';
import { User, Clock, Users } from 'lucide-react';
import { HourCellCard } from './HourCellCard';
import {
  generateOperationalHours,
  groupItemsByHour,
  HOUR_CELL_HEIGHT,
  TimelineItem,
} from './schedulerUtils';

interface Barber {
  empId: number;
  empName: string;
  status: 'working' | 'off' | 'day_off' | 'unknown';
  workStart: string | null;
  workEnd: string | null;
  isOvernightShift: boolean;
  nextAvailableAt: string | null;
  waitingCount: number;
  bookingsCount: number;
  inServiceCount: number;
  timeline: TimelineItem[];
}

interface Props {
  barber: Barber;
  headerHeight?: number;
  onItemClick?: (item: TimelineItem) => void;
}

export function BarberLane({ barber, headerHeight = 80, onItemClick }: Props) {
  const hours = generateOperationalHours();
  const itemsByHour = groupItemsByHour(barber.timeline);

  const getStatusColor = () => {
    if (barber.status === 'day_off') return '#ef4444';
    if (barber.status === 'off') return '#f59e0b';
    return '#22c55e';
  };

  const getStatusLabel = () => {
    if (barber.status === 'day_off') return 'إجازة';
    if (barber.status === 'off') return 'خارج ساعات العمل';
    return 'نشط';
  };

  return (
    <div
      className="flex flex-col shrink-0"
      style={{
        minWidth: '260px',
        maxWidth: '280px',
        borderRight: '1px solid rgba(212, 175, 55, 0.1)',
      }}
    >
      {/* Header */}
      <div
        className="p-3 border-b border-[rgba(212,175,55,0.2)] bg-[#111]"
        style={{ height: headerHeight }}
      >
        <div className="flex items-center gap-2 mb-2">
          <div
            className="w-8 h-8 rounded-full flex items-center justify-center shrink-0"
            style={{ background: 'rgba(212, 175, 55, 0.15)' }}
          >
            <User className="w-4 h-4" style={{ color: '#d4af37' }} />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="font-bold text-white text-sm truncate">{barber.empName}</h3>
            <div className="flex items-center gap-1 text-xs">
              <span
                className="w-1.5 h-1.5 rounded-full shrink-0"
                style={{ background: getStatusColor() }}
              />
              <span className="truncate" style={{ color: '#a1a1aa' }}>{getStatusLabel()}</span>
            </div>
          </div>
        </div>

        {/* Compact Stats */}
        <div className="flex items-center gap-2 text-xs flex-wrap">
          {barber.waitingCount > 0 && (
            <div className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-[rgba(255,255,255,0.05)]">
              <Users className="w-3 h-3" style={{ color: '#a1a1aa' }} />
              <span style={{ color: '#a1a1aa' }}>{barber.waitingCount}</span>
            </div>
          )}
          {barber.inServiceCount > 0 && (
            <div className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-[rgba(212,175,55,0.15)]">
              <Clock className="w-3 h-3" style={{ color: '#d4af37' }} />
              <span style={{ color: '#d4af37' }}>{barber.inServiceCount} خدمة</span>
            </div>
          )}
          {barber.nextAvailableAt && barber.waitingCount === 0 && barber.inServiceCount === 0 && (
            <div className="flex items-center gap-1" style={{ color: '#22c55e' }}>
              <span>متاح</span>
            </div>
          )}
        </div>
      </div>

      {/* Hour Cells */}
      <div className="flex-1">
        {hours.map((hour) => {
          const items = itemsByHour.get(hour) || [];
          const visibleItems = items.slice(0, 2);
          const moreCount = items.length - 2;

          // Determine if this hour is within working hours
          const isWorkingHour = barber.workStart && barber.workEnd && isHourInRange(
            hour,
            barber.workStart,
            barber.workEnd,
            barber.isOvernightShift
          );

          return (
            <div
              key={hour}
              className="border-b border-[rgba(212,175,55,0.08)]"
              style={{
                height: HOUR_CELL_HEIGHT,
                background: isWorkingHour ? 'transparent' : 'rgba(0,0,0,0.3)',
              }}
            >
              {items.length === 0 ? (
                // Empty cell - minimal visual
                <div className="h-full flex items-center justify-center">
                  <span className="text-[10px]" style={{ color: 'rgba(161,161,170,0.3)' }}>
                    —
                  </span>
                </div>
              ) : (
                // Cell with items
                <div className="h-full p-1.5 flex flex-col gap-1">
                  {visibleItems.map((item, idx) => (
                    <HourCellCard key={idx} item={item} compact={items.length > 1} onClick={onItemClick} />
                  ))}

                  {moreCount > 0 && (
                    <button
                      className="text-[10px] px-2 py-0.5 rounded bg-[rgba(212,175,55,0.15)] hover:bg-[rgba(212,175,55,0.25)] transition-colors self-center"
                      style={{ color: '#d4af37' }}
                      onClick={() => alert(`الساعة ${hour}: ${items.length} عناصر`)}
                    >
                      +{moreCount} المزيد
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function isHourInRange(hour: number, workStart: string, workEnd: string, isOvernight: boolean): boolean {
  const startHour = parseInt(workStart.split(':')[0]);
  let endHour = parseInt(workEnd.split(':')[0]);

  if (isOvernight && endHour <= 4) {
    endHour += 24;
  }

  if (isOvernight) {
    return hour >= startHour || hour <= endHour;
  }

  return hour >= startHour && hour <= endHour;
}

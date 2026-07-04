'use client';

import { Loader2 } from 'lucide-react';
import type { PasteCandidateSlot } from '@/lib/bookingDragReschedule';
import { formatTimeRange } from './schedulerUtils';
import { cn } from '@/lib/utils';

interface Props {
  slots: PasteCandidateSlot[];
  moveEmpId: number;
  isCommitting?: boolean;
  hoveredKey?: string | null;
  onSelect: (slot: PasteCandidateSlot) => void;
  onHover?: (key: string | null) => void;
}

function slotKey(slot: PasteCandidateSlot): string {
  return `${slot.empId}:${slot.startIso}`;
}

export function BookingPasteTargets({
  slots,
  moveEmpId,
  isCommitting,
  hoveredKey,
  onSelect,
  onHover,
}: Props) {
  if (slots.length === 0) return null;

  return (
    <>
      {slots.map((slot) => {
        const key = slotKey(slot);
        const isHovered = hoveredKey === key;
        const isCrossBarber = slot.empId !== moveEmpId;

        return (
          <button
            key={key}
            type="button"
            disabled={isCommitting}
            className={cn(
              'absolute inset-x-1 z-[6] rounded-lg border-2 border-dashed transition-colors',
              'border-teal-500/40 bg-teal-500/10 hover:border-teal-400 hover:bg-teal-500/20',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-400',
              isHovered && 'border-teal-400 bg-teal-500/25 ring-1 ring-teal-400/50',
              isCommitting && 'pointer-events-none opacity-60',
            )}
            style={{
              top: slot.topPx,
              height: slot.heightPx,
              minHeight: 32,
            }}
            title={
              isCrossBarber
                ? `نقل إلى ${slot.empName} · ${formatTimeRange(slot.startIso, slot.endIso)}`
                : `نقل هنا · ${formatTimeRange(slot.startIso, slot.endIso)}`
            }
            aria-label={
              isCrossBarber
                ? `نقل إلى ${slot.empName} ${formatTimeRange(slot.startIso, slot.endIso)}`
                : `نقل هنا ${formatTimeRange(slot.startIso, slot.endIso)}`
            }
            onMouseEnter={() => onHover?.(key)}
            onMouseLeave={() => onHover?.(null)}
            onFocus={() => onHover?.(key)}
            onBlur={() => onHover?.(null)}
            onClick={(e) => {
              e.stopPropagation();
              onSelect(slot);
            }}
          >
            <span
              className={cn(
                'pointer-events-none absolute inset-x-0 top-1 truncate px-1 text-center text-[10px] font-medium text-teal-100/90 opacity-0 transition-opacity',
                isHovered && 'opacity-100',
              )}
            >
              {isCrossBarber ? `نقل إلى ${slot.empName}` : 'نقل هنا'}
              {' · '}
              {formatTimeRange(slot.startIso, slot.endIso)}
            </span>
            {isCommitting && isHovered && (
              <span className="absolute inset-0 flex items-center justify-center">
                <Loader2 className="size-4 animate-spin text-teal-300" />
              </span>
            )}
          </button>
        );
      })}
    </>
  );
}

'use client';

import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import type {
  AvailabilityLayerAction,
  AvailabilityLayerView,
} from '@/lib/availability/buildAvailabilityLayers';
import { AvailabilityLayerCard } from '@/components/admin/workforce/layers/AvailabilityLayerCard';
import { AvailabilityLayerConnector } from '@/components/admin/workforce/layers/AvailabilityLayerConnector';
import { AvailabilityLayersSummary } from '@/components/admin/workforce/layers/AvailabilityLayersSummary';
import { AvailabilityDayTimeline } from '@/components/admin/workforce/AvailabilityDayTimeline';
import type { TimelineWindow } from '@/components/admin/workforce/AvailabilityDayTimeline';
import { getOperationalDate } from '@/lib/businessDate';

export function AvailabilityLayersInspector({
  layers,
  businessDate,
  employeeName,
  finalStatusLabel,
  branchName,
  timelineWindows,
  blockedIntervals,
  attendanceCheckIn,
  attendanceCheckOut,
  isClosedDay,
  onAction,
  onRefresh,
  onClose,
  footerPrimary,
}: {
  layers: AvailabilityLayerView[];
  businessDate: string;
  employeeName: string;
  finalStatusLabel: string;
  branchName?: string | null;
  timelineWindows: TimelineWindow[];
  blockedIntervals: Array<{ startMs: number; endMs: number; reason?: string }>;
  attendanceCheckIn?: string | null;
  attendanceCheckOut?: string | null;
  isClosedDay: boolean;
  onAction: (action: AvailabilityLayerAction) => void;
  onRefresh: () => void;
  onClose: () => void;
  footerPrimary: AvailabilityLayerAction[];
}) {
  const initialExpanded = useMemo(() => {
    const set = new Set<string>();
    for (const l of layers) {
      if (
        l.defaultExpanded ||
        l.emphasized ||
        l.status === 'BLOCKING' ||
        l.isDecidingCause
      ) {
        set.add(l.key);
      }
    }
    return set;
  }, [layers]);

  const [expanded, setExpanded] = useState<Set<string>>(initialExpanded);

  useEffect(() => {
    setExpanded(initialExpanded);
  }, [initialExpanded]);

  const toggle = (key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const expandAll = () => {
    setExpanded(new Set(layers.map((l) => l.key)));
  };

  const finalLayer = layers.find((l) => l.key === 'FINAL_RESULT');

  return (
    <div className="flex h-full flex-col" dir="rtl">
      {/* Sticky header */}
      <header className="sticky top-0 z-10 border-b border-zinc-800 bg-zinc-950/95 px-4 py-3 backdrop-blur">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold text-white truncate">{employeeName}</h2>
            <p className="text-xs text-zinc-500">
              {finalStatusLabel}
              {branchName ? ` · ${branchName}` : ''} · {businessDate}
            </p>
          </div>
          <div className="flex shrink-0 gap-1">
            <Button type="button" size="sm" variant="ghost" onClick={onRefresh}>
              تحديث
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={onClose} aria-label="إغلاق">
              إغلاق
            </Button>
          </div>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto px-4 py-3 pb-24">
        <AvailabilityLayersSummary
          layers={layers}
          decision={
            (layers.find((l) => l.key === 'FINAL_RESULT')?.data
              ?.decision as import('@/lib/availability/buildAvailabilityDecision').AvailabilityDecisionExplain) ??
            null
          }
        />

        <details className="mb-4 rounded border border-zinc-800 p-2 text-[11px] text-zinc-400">
          <summary className="cursor-pointer text-zinc-300">
            ما الفرق بين الجدول والحضور؟
          </summary>
          <p className="mt-2 leading-relaxed">
            الجدول يحدد متى يمكن استقبال الحجوزات. الحضور يوضح ما حدث فعليًا في يوم
            العمل. وجود حضور وحده لا يفتح الحجوزات إذا لم توجد ساعات عمل.
          </p>
        </details>

        <div className="mb-3 flex items-center justify-between gap-2">
          <h3 className="text-sm font-medium text-zinc-200">طبقات توافر الموظف</h3>
          <Button type="button" size="sm" variant="ghost" className="text-[11px]" onClick={expandAll}>
            توسيع الكل
          </Button>
        </div>

        <div className="space-y-0">
          {layers.map((layer, idx) => (
            <div key={layer.key}>
              <AvailabilityLayerCard
                layer={layer}
                expanded={expanded.has(layer.key)}
                onToggle={() => toggle(layer.key)}
                onAction={onAction}
              />
              {idx < layers.length - 1 && <AvailabilityLayerConnector />}
            </div>
          ))}
        </div>

        {/* Final timeline — read-only */}
        {finalLayer && (
          <div className="mt-5">
            <AvailabilityDayTimeline
              businessDate={businessDate}
              isCurrentBusinessDate={businessDate === getOperationalDate()}
              isClosedDay={isClosedDay}
              windows={timelineWindows}
              blockedIntervals={blockedIntervals}
              attendanceCheckIn={attendanceCheckIn}
              attendanceCheckOut={attendanceCheckOut}
            />
          </div>
        )}
      </div>

      {/* Sticky footer */}
      {footerPrimary.length > 0 && (
        <footer className="sticky bottom-0 z-10 border-t border-zinc-800 bg-zinc-950/95 px-4 py-3 backdrop-blur">
          <div className="flex flex-wrap gap-1.5 justify-end">
            {footerPrimary.map((a) => (
              <Button
                key={a.key}
                type="button"
                size="sm"
                variant={a.key.includes('CLOSE') ? 'outline' : 'secondary'}
                disabled={!a.enabled}
                title={a.disabledReasonAr}
                onClick={() => onAction(a)}
              >
                {a.labelAr}
              </Button>
            ))}
          </div>
        </footer>
      )}
    </div>
  );
}

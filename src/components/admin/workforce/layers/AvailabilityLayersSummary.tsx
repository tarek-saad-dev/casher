'use client';

import type { AvailabilityLayerView } from '@/lib/availability/buildAvailabilityLayers';
import type { AvailabilityDecisionExplain } from '@/lib/availability/buildAvailabilityDecision';

export function AvailabilityLayersSummary({
  layers,
  decision,
}: {
  layers: AvailabilityLayerView[];
  decision?: AvailabilityDecisionExplain | null;
}) {
  const resolved =
    decision ??
    (layers.find((l) => l.key === 'FINAL_RESULT')?.data
      ?.decision as AvailabilityDecisionExplain | undefined) ??
    null;

  return (
    <div
      className="mb-4 rounded-lg border border-zinc-800 bg-zinc-900/50 px-3 py-2.5 text-[11px] text-zinc-400 space-y-2"
      role="status"
    >
      <div className="flex flex-wrap items-center gap-1.5 justify-center text-center">
        <span className="text-zinc-300">الجدول الأصلي</span>
        <span aria-hidden>→</span>
        <span className="text-zinc-300">التغييرات المطبقة</span>
        <span aria-hidden>→</span>
        <span className="text-emerald-200 font-medium">التوافر النهائي</span>
      </div>

      {resolved ? (
        <div className="rounded-md border border-amber-500/25 bg-amber-950/25 px-2.5 py-2 space-y-1">
          <p className="text-amber-50 font-medium text-center">{resolved.summaryAr}</p>
          {resolved.decidingLayerTitleAr && (
            <p className="text-center text-zinc-300">
              مصدر القرار: الطبقة {resolved.decidingLayerOrder} ·{' '}
              {resolved.decidingLayerTitleAr}
            </p>
          )}
          <ul className="mt-1 space-y-0.5 text-zinc-400 list-disc list-inside text-right">
            {resolved.whyAr.slice(0, 3).map((line, i) => (
              <li key={i}>{line}</li>
            ))}
          </ul>
          {resolved.howToChangeAr.length > 0 && (
            <div className="pt-1 border-t border-zinc-800/80">
              <p className="text-zinc-500 mb-0.5">كيف تغيّر القرار؟</p>
              <ul className="space-y-0.5 text-zinc-400 list-disc list-inside text-right">
                {resolved.howToChangeAr.map((line, i) => (
                  <li key={i}>{line}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      ) : (
        <p className="text-center text-zinc-500 line-clamp-2">
          {[
            layers.find((l) => l.key === 'BASE_SCHEDULE')?.summaryAr,
            layers.find((l) => l.key === 'DAILY_ADJUSTMENTS')?.summaryAr,
            layers.find((l) => l.key === 'FINAL_RESULT')?.summaryAr,
          ]
            .filter(Boolean)
            .join(' · ')}
        </p>
      )}
    </div>
  );
}

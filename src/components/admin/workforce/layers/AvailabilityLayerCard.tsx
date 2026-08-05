'use client';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  AVAILABILITY_LAYER_STATUS_AR,
  type AvailabilityLayerAction,
  type AvailabilityLayerView,
} from '@/lib/availability/buildAvailabilityLayers';
import { AvailabilityLayerEffect } from '@/components/admin/workforce/layers/AvailabilityLayerEffect';
import { cn } from '@/lib/utils';

const STATUS_CLASS: Record<string, string> = {
  APPLIED: 'border-emerald-500/40 text-emerald-200',
  NOT_APPLICABLE: 'border-zinc-600 text-zinc-400',
  NO_DATA: 'border-zinc-700 text-zinc-500',
  OVERRIDDEN: 'border-amber-500/40 text-amber-200',
  BLOCKING: 'border-rose-500/50 text-rose-200',
  INFORMATIONAL: 'border-sky-500/40 text-sky-200',
  WARNING: 'border-amber-500/50 text-amber-100',
};

export function AvailabilityLayerCard({
  layer,
  expanded,
  onToggle,
  onAction,
}: {
  layer: AvailabilityLayerView;
  expanded: boolean;
  onToggle: () => void;
  onAction: (action: AvailabilityLayerAction) => void;
}) {
  return (
    <section
      className={cn(
        'rounded-lg border px-3 py-2.5 transition-colors',
        layer.emphasized
          ? 'border-emerald-500/50 bg-emerald-950/30 shadow-[0_0_0_1px_rgba(16,185,129,0.15)]'
          : layer.isDecidingCause
            ? 'border-amber-500/40 bg-amber-950/20'
            : 'border-zinc-800 bg-zinc-900/40',
        layer.status === 'BLOCKING' && !layer.emphasized && 'border-rose-500/30',
      )}
      data-layer-key={layer.key}
      aria-labelledby={`layer-title-${layer.key}`}
    >
      <button
        type="button"
        className="flex w-full items-start gap-2 text-right"
        onClick={onToggle}
        aria-expanded={expanded}
      >
        <span
          className={cn(
            'mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold',
            layer.emphasized
              ? 'bg-emerald-600 text-white'
              : 'bg-zinc-800 text-zinc-300',
          )}
        >
          {layer.order}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <h4
              id={`layer-title-${layer.key}`}
              className={cn(
                'text-sm font-medium',
                layer.emphasized ? 'text-emerald-50' : 'text-zinc-100',
              )}
            >
              {layer.titleAr}
            </h4>
            <Badge
              variant="outline"
              className={cn('text-[10px]', STATUS_CLASS[layer.status])}
            >
              {AVAILABILITY_LAYER_STATUS_AR[layer.status]}
            </Badge>
            {layer.isDecidingCause && (
              <Badge
                variant="outline"
                className="text-[10px] border-amber-500/50 text-amber-100"
              >
                مصدر القرار
              </Badge>
            )}
            {layer.key === 'LEGACY_OVERRIDES' && (
              <Badge variant="outline" className="text-[10px] text-amber-300/90 border-amber-500/30">
                نظام قديم
              </Badge>
            )}
          </div>
          <p className="mt-0.5 text-xs text-zinc-400 line-clamp-2">{layer.summaryAr}</p>
          {layer.sourceCode && (
            <p className="mt-0.5 font-mono text-[10px] text-zinc-600">{layer.sourceCode}</p>
          )}
        </div>
        <span className="text-[10px] text-zinc-500 shrink-0 mt-1">
          {expanded ? 'إخفاء' : 'تفاصيل'}
        </span>
      </button>

      {expanded && (
        <div className="mt-3 space-y-2 border-t border-zinc-800/80 pt-2">
          <p className="text-[11px] text-zinc-500">{layer.descriptionAr}</p>
          {layer.effectAr && (
            <p className="text-xs text-zinc-300 whitespace-pre-line">{layer.effectAr}</p>
          )}
          <AvailabilityLayerEffect snapshot={layer.snapshot} effectAr={null} />

          {layer.warnings.length > 0 && (
            <ul className="space-y-0.5 text-[11px] text-amber-200/90">
              {layer.warnings.map((w, i) => (
                <li key={i}>⚠ {w}</li>
              ))}
            </ul>
          )}

          {Array.isArray(layer.data.chronologyAr) &&
            (layer.data.chronologyAr as string[]).length > 0 && (
              <ol className="space-y-0.5 text-[11px] text-zinc-400 list-decimal list-inside">
                {(layer.data.chronologyAr as string[]).map((line, i) => (
                  <li key={i}>{line}</li>
                ))}
              </ol>
            )}

          {layer.actions.length > 0 && (
            <div className="flex flex-wrap gap-1.5 pt-1">
              {layer.actions.map((action) => (
                <Button
                  key={action.key}
                  type="button"
                  size="sm"
                  variant={
                    action.actionType === 'OPEN_LAYER_CONTROL'
                      ? 'default'
                      : action.enabled
                        ? 'secondary'
                        : 'ghost'
                  }
                  disabled={!action.enabled}
                  title={action.disabledReasonAr}
                  className={
                    action.actionType === 'OPEN_LAYER_CONTROL'
                      ? 'text-[11px] h-7 bg-amber-600 hover:bg-amber-500 text-white'
                      : 'text-[11px] h-7'
                  }
                  onClick={() => onAction(action)}
                >
                  {action.labelAr}
                </Button>
              ))}
            </div>
          )}

          <details className="text-[10px] text-zinc-600">
            <summary className="cursor-pointer text-zinc-500">عرض التفاصيل التقنية</summary>
            <pre className="mt-1 max-h-40 overflow-auto rounded bg-black/40 p-2 font-mono whitespace-pre-wrap">
              {JSON.stringify(
                {
                  key: layer.key,
                  status: layer.status,
                  sourceCode: layer.sourceCode,
                  data: layer.data,
                },
                null,
                2,
              )}
            </pre>
          </details>
        </div>
      )}
    </section>
  );
}

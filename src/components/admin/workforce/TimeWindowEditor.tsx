'use client';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Plus, Trash2 } from 'lucide-react';
import type { WindowDraft } from '@/lib/availability/timeWindowEditorUtils';
import { inferEndDayOffset } from '@/lib/availability/timeWindowEditorUtils';
import { formatHhmmPreview } from '@/lib/availability/workforceUiLabels';

export function TimeWindowEditor({
  windows,
  onChange,
  disabled,
}: {
  windows: WindowDraft[];
  onChange: (next: WindowDraft[]) => void;
  disabled?: boolean;
}) {
  const update = (index: number, patch: Partial<WindowDraft>) => {
    const next = windows.map((w, i) => {
      if (i !== index) return w;
      const start = patch.start ?? w.start;
      const end = patch.end ?? w.end;
      const endDayOffset =
        patch.endDayOffset !== undefined
          ? patch.endDayOffset
          : inferEndDayOffset(start, end, w.endDayOffset);
      return { start, end, endDayOffset };
    });
    onChange(next);
  };

  return (
    <div className="space-y-3" role="group" aria-label="محرر النوافذ الزمنية">
      {windows.map((w, index) => (
        <div
          key={index}
          className="rounded-lg border border-zinc-700/70 bg-zinc-950/40 p-3 space-y-2"
        >
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label htmlFor={`win-start-${index}`}>من</Label>
              <Input
                id={`win-start-${index}`}
                type="time"
                value={w.start}
                disabled={disabled}
                onChange={(e) => update(index, { start: e.target.value })}
              />
            </div>
            <div>
              <Label htmlFor={`win-end-${index}`}>إلى</Label>
              <Input
                id={`win-end-${index}`}
                type="time"
                value={w.end}
                disabled={disabled}
                onChange={(e) => update(index, { end: e.target.value })}
              />
            </div>
          </div>
          <label className="flex items-center gap-2 text-xs text-zinc-300">
            <input
              type="checkbox"
              className="rounded border-zinc-600"
              checked={w.endDayOffset === 1}
              disabled={disabled}
              onChange={(e) =>
                update(index, { endDayOffset: e.target.checked ? 1 : 0 })
              }
            />
            ينتهي في اليوم التالي
          </label>
          <p className="text-xs text-zinc-400">
            معاينة: {formatHhmmPreview(w.start || '—', w.end || '—', w.endDayOffset)}
          </p>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={disabled || windows.length <= 1}
            onClick={() => onChange(windows.filter((_, i) => i !== index))}
            aria-label="حذف النافذة"
          >
            <Trash2 className="size-3.5" />
            حذف
          </Button>
        </div>
      ))}
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={disabled}
        onClick={() =>
          onChange([...windows, { start: '10:00', end: '18:00', endDayOffset: 0 }])
        }
      >
        <Plus className="size-3.5" />
        إضافة نافذة
      </Button>
    </div>
  );
}

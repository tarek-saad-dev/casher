'use client';

export function CardSkeleton() {
  return (
    <div className="rounded-xl border border-zinc-800/50 bg-zinc-900/50 p-6 animate-pulse">
      <div className="flex items-start justify-between">
        <div className="flex-1 space-y-3">
          <div className="h-4 w-24 bg-zinc-800 rounded" />
          <div className="h-8 w-32 bg-zinc-800 rounded" />
        </div>
        <div className="h-12 w-12 bg-zinc-800 rounded-lg" />
      </div>
    </div>
  );
}

export function TableSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-4 p-4 rounded-lg bg-zinc-900/30 animate-pulse">
          <div className="h-10 w-10 bg-zinc-800 rounded-full" />
          <div className="flex-1 space-y-2">
            <div className="h-4 w-3/4 bg-zinc-800 rounded" />
            <div className="h-3 w-1/2 bg-zinc-800 rounded" />
          </div>
          <div className="h-8 w-24 bg-zinc-800 rounded" />
        </div>
      ))}
    </div>
  );
}

const chartHeights = [60, 80, 45, 90, 70, 55, 85];

export function ChartSkeleton() {
  return (
    <div className="h-64 rounded-xl border border-zinc-800/50 bg-zinc-900/50 p-6 animate-pulse">
      <div className="h-full flex items-end justify-between gap-2">
        {chartHeights.map((height, i) => (
          <div
            key={i}
            className="flex-1 bg-zinc-800 rounded-t"
            style={{ height: `${height}%` }}
          />
        ))}
      </div>
    </div>
  );
}

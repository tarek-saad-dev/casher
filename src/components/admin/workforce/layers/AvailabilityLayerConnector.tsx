'use client';

export function AvailabilityLayerConnector() {
  return (
    <div className="flex justify-center py-0.5" aria-hidden="true">
      <div className="flex flex-col items-center text-zinc-600">
        <div className="h-2 w-px bg-zinc-700" />
        <span className="text-[10px] leading-none">↓</span>
        <div className="h-2 w-px bg-zinc-700" />
      </div>
    </div>
  );
}

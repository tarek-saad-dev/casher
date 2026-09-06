'use client';

import { AlertCircle } from 'lucide-react';

/**
 * Shared ops modal error banner — identical presentation across Booking + Queue flows.
 */
export function OpsFlowErrorBanner({ message }: { message: string }) {
  if (!message) return null;
  return (
    <div
      className="mb-4 flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2.5 text-sm text-destructive"
      role="alert"
    >
      <AlertCircle className="size-4 shrink-0 mt-0.5" aria-hidden />
      <span>{message}</span>
    </div>
  );
}

'use client';

import type { ReactNode } from 'react';
import { GOLD, GOLD_BDR } from './booking-workspace/types';

/**
 * Compact selected-context card shared by Queue confirm / plan panels
 * (same visual language as Booking Time context strip).
 */
export function OpsSelectedContextCard({
  title,
  lines,
  footer,
}: {
  title: string;
  lines: Array<string | null | undefined>;
  footer?: ReactNode;
}) {
  const visible = lines.filter((l): l is string => Boolean(l && String(l).trim()));
  return (
    <div
      className="rounded-xl border p-4 space-y-2"
      style={{ borderColor: GOLD_BDR, background: 'color-mix(in srgb, var(--primary) 6%, transparent)' }}
    >
      <p className="font-bold text-sm sm:text-base" style={{ color: GOLD }}>{title}</p>
      {visible.map((line) => (
        <p key={line} className="text-sm text-foreground">{line}</p>
      ))}
      {footer}
    </div>
  );
}

export function OpsWalkInHint({ expanded }: { expanded?: boolean }) {
  return (
    <p className="text-xs text-muted-foreground">
      {expanded
        ? 'يمكنك المتابعة كعميل مباشر أو إدخال بيانات اختيارية'
        : 'سيتم إنشاء الدور كعميل مباشر'}
    </p>
  );
}

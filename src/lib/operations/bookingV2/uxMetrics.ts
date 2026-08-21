/**
 * Ops booking UX timing marks (Phase O2).
 * Dev-only console; safe no-ops when Performance API unavailable.
 */

const PREFIX = 'ops-booking-ux';

export type OpsBookingUxMark =
  | 'add_click'
  | 'modal_visible'
  | 'services_usable'
  | 'availability_visible'
  | 'service_change_local'
  | 'date_change_local'
  | 'branch_change_local';

function canMeasure(): boolean {
  return typeof performance !== 'undefined' && typeof performance.mark === 'function';
}

export function markOpsBookingUx(mark: OpsBookingUxMark, detail?: Record<string, unknown>): void {
  if (!canMeasure()) return;
  const name = `${PREFIX}:${mark}`;
  try {
    performance.mark(name);
  } catch {
    /* ignore */
  }
  if (process.env.NODE_ENV !== 'production') {
    console.log(`[${PREFIX}]`, mark, detail ?? {});
  }
}

export function measureOpsBookingUx(
  label: string,
  startMark: OpsBookingUxMark,
  endMark: OpsBookingUxMark,
): number | null {
  if (!canMeasure() || typeof performance.measure !== 'function') return null;
  const start = `${PREFIX}:${startMark}`;
  const end = `${PREFIX}:${endMark}`;
  try {
    const name = `${PREFIX}:measure:${label}`;
    performance.measure(name, start, end);
    const entries = performance.getEntriesByName(name);
    const last = entries[entries.length - 1];
    const ms = last ? Math.round(last.duration) : null;
    if (process.env.NODE_ENV !== 'production' && ms != null) {
      console.log(`[${PREFIX}] measure`, label, `${ms}ms`);
    }
    return ms;
  } catch {
    return null;
  }
}

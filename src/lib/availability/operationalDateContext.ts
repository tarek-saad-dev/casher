/**
 * Phase 1B — Single operational business-date context for APIs / UI.
 * Cutoff owned by getOperationalDate (Cairo / branch TZ, hour < 4 → previous day).
 */

import {
  BUSINESS_DAY_CUTOFF_HOUR,
  SALON_TZ,
  getOperationalDate,
} from '@/lib/businessDate';

export type OperationalDateContext = {
  businessDate: string;
  timezone: string;
  cutoffHour: number;
};

export function getOperationalDateContext(opts?: {
  now?: Date;
  timeZone?: string;
  cutoffHour?: number;
}): OperationalDateContext {
  const timeZone = opts?.timeZone ?? SALON_TZ;
  const cutoffHour = opts?.cutoffHour ?? BUSINESS_DAY_CUTOFF_HOUR;
  return {
    businessDate: getOperationalDate({
      now: opts?.now,
      timeZone,
      cutoffHour,
    }),
    timezone: timeZone,
    cutoffHour,
  };
}

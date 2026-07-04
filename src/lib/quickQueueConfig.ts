/**
 * Central configuration for the one-click "عمل دور سريع" workflow.
 * Override via environment variables when deploying to a different catalog.
 */
export const QUICK_QUEUE_SERVICE_ID = Number(
  process.env.QUICK_QUEUE_SERVICE_ID ?? 9,
);

/** Fallback when TblPro.DurationMinutes is missing for the configured service. */
export const QUICK_QUEUE_DURATION_MINUTES = Number(
  process.env.QUICK_QUEUE_DURATION_MINUTES ?? 30,
);

/** Walk-in label reused by manual queue creation. */
export const QUICK_QUEUE_WALK_IN_NAME = 'عميل مباشر';

/**
 * Disable with QUICK_QUEUE_ENABLED=false or NEXT_PUBLIC_QUICK_QUEUE_ENABLED=false.
 */
export const QUICK_QUEUE_ENABLED = process.env.QUICK_QUEUE_ENABLED !== 'false';

export const QUICK_QUEUE_UI_ENABLED =
  process.env.NEXT_PUBLIC_QUICK_QUEUE_ENABLED !== 'false';

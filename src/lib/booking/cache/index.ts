/**
 * Booking V2 B8 — public cache surface.
 */

export {
  createHotAvailabilityCache,
  getHotAvailabilityCache,
  __resetHotAvailabilityCacheForTests,
  type HotAvailabilityCache,
  type HotAvailabilityGetResult,
  type HotAvailabilityRebuildFn,
} from '@/lib/booking/cache/HotAvailabilityCache';
export {
  BoundedLruCache,
  type BoundedLruOptions,
  type BoundedLruStats,
} from '@/lib/booking/cache/BoundedLruCache';
export { createSingleFlight } from '@/lib/booking/cache/singleFlight';
export {
  createHotCacheMetrics,
  logHotCacheMetric,
  type HotCacheMetricsSnapshot,
} from '@/lib/booking/cache/HotCacheMetrics';
export {
  createNullHotAvailabilityL2Store,
  createMemoryHotAvailabilityL2Store,
  type HotAvailabilityL2Store,
} from '@/lib/booking/cache/HotAvailabilityL2';
export {
  hotAvailabilityDayKeyString,
  encodeHotAvailabilityDay,
  decodeHotAvailabilityDay,
  type HotAvailabilityDayKey,
  type HotAvailabilityDayPayload,
  type HotAvailabilityDayRecord,
} from '@/lib/booking/cache/HotAvailabilityTypes';
export {
  invalidateOnBookingCreated,
  invalidateOnBookingCancelled,
  invalidateOnBookingRescheduled,
  invalidateOnHoldCreated,
  invalidateOnHoldReleasedOrExpired,
  invalidateOnQueueChanged,
  invalidateOnEffectiveDayChange,
  invalidateOnWeeklyBaselineChange,
  invalidateOnBranchHoursChange,
} from '@/lib/booking/cache/HotAvailabilityInvalidation';
export {
  notifyHotEffectiveDay,
  notifyHotWeeklyBaseline,
  notifyHotQueueChanged,
  notifyHotBranchHours,
  bookingHorizonDates,
} from '@/lib/booking/cache/hotCacheInvalidateBestEffort';
export {
  AvailabilityMutationNotifier,
  type AvailabilityMutationNotifierApi,
} from '@/lib/booking/AvailabilityMutationNotifier';
export {
  composeHotAvailabilityRange,
} from '@/lib/booking/cache/HotAvailabilityRange';
export {
  buildHotDayPayloadFromPreloaded,
  resolveHotCacheEnabled,
} from '@/lib/booking/cache/buildHotDayPayload';
export {
  createStaticBootstrapCache,
  getStaticBootstrapCache,
  __resetStaticBootstrapCacheForTests,
  type StaticBootstrapCache,
  type StaticBootstrapKind,
} from '@/lib/booking/cache/StaticBootstrapCache';

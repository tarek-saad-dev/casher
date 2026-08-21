/**
 * Booking V2 projection public surface (B3–B5 + B7A resolver/shadow pure exports).
 * Not wired as public cutover.
 *
 * SQL adapters / live resolvers are NOT re-exported here. Server callers import:
 *   `@/lib/booking/projection/resolveBookingAvailabilityV2Live`
 *   `@/lib/booking/projection/loadOccupancyBatch`
 *   `@/lib/booking/projection/scheduleAvailabilityShadow`
 */

export type { WeeklyBaselineStore } from '@/lib/booking/projection/WeeklyBaselineStore';
export { createWeeklyBaselineMemoryStore } from '@/lib/booking/projection/WeeklyBaselineMemoryStore';
export {
  createWeeklyBaselineRevisionBoard,
  type WeeklyBaselineInvalidationReason,
  type WeeklyBaselineInvalidationEvent,
  type WeeklyBaselineRevisionBoard,
} from '@/lib/booking/projection/WeeklyBaselineRevision';
export {
  createWeeklyBaselineProjectionService,
  WeeklyBaselineProjection,
  type WeeklyBaselineProjectionService,
} from '@/lib/booking/projection/WeeklyBaselineProjection';

export type { EffectiveDayStore } from '@/lib/booking/projection/EffectiveDayStore';
export { createEffectiveDayMemoryStore } from '@/lib/booking/projection/EffectiveDayMemoryStore';
export {
  createEffectiveDayRevisionBoard,
  type EffectiveDayInvalidationReason,
  type EffectiveDayInvalidationEvent,
  type EffectiveDayRevisionBoard,
} from '@/lib/booking/projection/EffectiveDayRevision';
export {
  createEffectiveDayProjectionService,
  EffectiveDayProjection,
  resolveEffectiveDayBitmap,
  type EffectiveDayBuildInput,
  type EffectiveDayProjectionService,
} from '@/lib/booking/projection/EffectiveDayProjection';

export {
  createBookingOccupancyProjectionService,
  BookingOccupancyProjection,
  type BookingOccupancyProjectionService,
} from '@/lib/booking/projection/BookingOccupancyProjection';
export {
  createHoldOccupancyProjectionService,
  HoldOccupancyProjection,
  filterActiveUnexpiredHolds,
  type HoldOccupancyProjectionService,
  type HoldOccupancyInterval,
} from '@/lib/booking/projection/HoldOccupancyProjection';
export {
  createQueueOccupancyProjectionService,
  QueueOccupancyProjection,
  QUEUE_IN_PUBLIC_AVAILABILITY,
  QUEUE_OCCUPANCY_DECISION,
} from '@/lib/booking/projection/QueueOccupancyProjection';
export {
  AvailabilityComposer,
  type AvailabilityComposeInput,
  type ComposedAvailability,
} from '@/lib/booking/projection/AvailabilityComposer';
export {
  deriveAvailabilityRevision,
  availabilityRevisionFingerprint,
  createAvailabilityRevisionBoard,
  type AvailabilityRevisionParts,
  type AvailabilityRevisionBoard,
} from '@/lib/booking/projection/AvailabilityRevision';
export {
  createOccupancyMemoryStore,
  rebuildOccupancyDayFromIntervals,
  occupancyApplySet,
  occupancyApplyClear,
  occupancyApplyReschedule,
  type OccupancyDayRecord,
  type OccupancySegment,
  type OccupancyOverlapWarning,
} from '@/lib/booking/projection/OccupancyDayState';
export {
  occupancyDayKeyString,
  absoluteIntervalToTimelineMinutes,
  type OccupancyDayKey,
  type AbsoluteOccupancyInterval,
} from '@/lib/booking/projection/OccupancyTimeline';
export {
  resolveBookingAvailabilityV2FromPreloaded,
  composeEmployeeDayAvailabilityV2,
  startMinToV2Slot,
  type V2EmployeeDayAvailability,
  type ResolveBookingAvailabilityV2Result,
} from '@/lib/booking/projection/resolveBookingAvailabilityV2';
export {
  compareAvailabilityShadow,
  shouldRunBookingV2Shadow,
  getShadowParityStats,
  recordShadowSample,
  evaluateReadCutoverReadiness,
  __resetShadowParityStatsForTests,
  type AvailabilityShadowMismatchReason,
  type CutoverReadiness,
} from '@/lib/booking/projection/availabilityShadowParity';

/** B8 hot cache — import from `@/lib/booking/cache` for full surface. */
export {
  createHotAvailabilityCache,
  getHotAvailabilityCache,
  composeHotAvailabilityRange,
  buildHotDayPayloadFromPreloaded,
} from '@/lib/booking/cache';
export {
  resolveBookingV2ReadMode,
  resolveBookingV2ReadDecision,
  bookingV2CanaryBucket,
  buildBookingV2CanaryKey,
  getBookingV2ReadCutoverMetrics,
  __resetBookingV2ReadCutoverMetricsForTests,
  type BookingV2ReadMode,
  type BookingV2ReadDecision,
} from '@/lib/booking/projection/bookingV2ReadCutover';

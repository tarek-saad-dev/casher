/**
 * Hawai /operations Booking V2 Phase O1 — frontend data layer.
 *
 * Single store over B9 APIs:
 *   GET  /api/public/booking/v2/bootstrap
 *   POST /api/public/booking/v2/availability
 *
 * Local starts: generateStartsFromFree (shared with server).
 * Writes remain on legacy create / hold / reschedule / cancel.
 */

export {
  BOOKING_V2_OPS_DATA_LAYER,
  MATRIX_WINDOW_DAYS,
  matrixScopeKey,
  revisionKey,
  type BookingV2StoreSnapshot,
  type GeneratedStart,
  type MatrixScope,
  type BookingV2Mode,
} from '@/lib/operations/bookingV2/types';

export {
  prefetchBookingV2Bootstrap,
  prefetchBookingV2Availability,
  openBookingV2Flow,
  setBookingV2Selection,
  refreshActiveBookingV2Matrix,
  getBookingV2StoreSnapshot,
  subscribeBookingV2Store,
  resetBookingV2StoreForTests,
  hasMatrixCoverageForDate,
  getServicesForBranch,
  buildMatrixScopeForFlow,
  getEmployeeBranchCodesFromStore,
  hasCachedBranchInActiveMatrix,
  commitBookingV2StoreUpdate,
  recomputeGeneratedStartsForSnapshot,
  resolveEmployeeBranchCodesFromSnapshot,
} from '@/lib/operations/bookingV2/store';

export {
  useBookingV2Store,
  useBookingV2Actions,
} from '@/lib/operations/bookingV2/useBookingV2Store';

export {
  generateStartsForDay,
  filterDaysForSelection,
} from '@/lib/operations/bookingV2/generateOpsStarts';

export { scopeToRequest } from '@/lib/operations/bookingV2/availabilityClient';

export {
  markOpsBookingUx,
  measureOpsBookingUx,
} from '@/lib/operations/bookingV2/uxMetrics';

export {
  notifyBookingV2CreateSuccess,
  notifyBookingV2SlotConflict,
  notifyBookingV2CancelSuccess,
  notifyBookingV2CancelFromTimeline,
  notifyBookingV2RescheduleSuccess,
  notifyBookingV2HoldCreated,
  notifyBookingV2HoldReleased,
  notifyBookingV2WorkforceChange,
  notifyBookingV2QueueCreated,
  BOOKING_V2_SLOT_STALE_NOTICE_AR,
} from '@/lib/operations/bookingV2/mutationSync';

export {
  applyBookingCreated,
  applyBookingCancelled,
  applyBookingRescheduled,
  invalidateEmployeeDay,
  revalidateAffectedAvailability,
  clearTargetedRevalidationInflight,
} from '@/lib/operations/bookingV2/AvailabilityStoreMutations';

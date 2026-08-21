/**
 * Booking V2 B6 / B6.5 — Transactional Slot Claim Engine (public surface).
 */

export * from '@/lib/booking/claims/BookingSlotClaimFlags';
export * from '@/lib/booking/claims/BookingSlotClaimTypes';
export * from '@/lib/booking/claims/slotClaimMath';
export * from '@/lib/booking/claims/BookingSlotClaimStore';
export {
  createBookingSlotClaimMemoryStore,
} from '@/lib/booking/claims/BookingSlotClaimMemoryStore';
export {
  createBookingSlotClaimSqlStore,
  bindBookingSlotClaimTx,
} from '@/lib/booking/claims/BookingSlotClaimSqlStore';
export {
  createBookingSlotClaimService,
  BookingSlotClaimService,
} from '@/lib/booking/claims/BookingSlotClaimService';
export {
  backfillBookingSlotClaims,
  scanLegacyBookingOverlaps,
  verifyBookingClaimsAgainstSoT,
  verifyActiveFutureClaimsParity,
  type SlotClaimBackfillReport,
  type LegacyOverlapConflict,
  type LegacyBookingInterval,
  type SlotClaimParityReport,
} from '@/lib/booking/claims/slotClaimBackfill';
export {
  verifySlotClaimMigrationReadiness,
  type SlotClaimMigrationReadiness,
} from '@/lib/booking/claims/slotClaimMigrationReady';
export {
  validateHoldAgainstBookingPolicy,
  resolveHoldPolicyMode,
  HoldPolicyDeniedError,
} from '@/lib/booking/claims/holdPolicyValidation';
export {
  logSlotClaimShadowEvent,
  getSlotClaimShadowStats,
  resetSlotClaimShadowStatsForTests,
} from '@/lib/booking/claims/slotClaimShadowTelemetry';
export { evaluateEnforceReadiness } from '@/lib/booking/claims/slotClaimEnforceGate';

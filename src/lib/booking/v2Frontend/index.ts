/**
 * Booking V2 B9 — frontend read helpers (public exports that are pure).
 */
export {
  generateStartsFromFree,
  SLOT_GENERATION_CONTRACT,
  type GenerateStartsFromFreeInput,
  type GenerateStartsFromFreeResult,
} from '@/lib/booking/v2Frontend/generateStartsFromFreeRanges';
export {
  filterStartMinsByMinNotice,
  firstEligibleSlotOnGrid,
} from '@/lib/booking/v2Frontend/minNoticeSlotGrid';
export {
  BOOKING_V2_FRONTEND_CONTRACT,
  type V2PublicBootstrapResponse,
  type V2PublicAvailabilityMatrixResponse,
  type V2PublicAvailabilityMatrixRequest,
  type V2PublicAvailabilityDayDto,
} from '@/lib/booking/v2Frontend/publicSafeDtos';

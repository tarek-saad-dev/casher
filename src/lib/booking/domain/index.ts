/**
 * Booking V2 domain public surface.
 * Domain must stay free of Next.js route imports.
 */

export * from '@/lib/booking/domain/BusinessDate';
export * from '@/lib/booking/domain/BookingInterval';
export * from '@/lib/booking/domain/BookingError';
export * from '@/lib/booking/domain/EmployeeIdentity';
export * from '@/lib/booking/domain/AvailabilityBitmap';
export * from '@/lib/booking/domain/WeeklyBaseline';
export * from '@/lib/booking/domain/EffectiveDay';
export {
  BookingPolicy,
  BOOKING_POLICY_RULE_CATALOG,
  type BookingPolicyRuleId,
  type BookingPolicySettings,
  type PolicyEvaluationResult,
  type ServiceDurationPolicyInput,
} from '@/lib/booking/domain/BookingPolicy';

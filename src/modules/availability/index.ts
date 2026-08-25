/**
 * Availability module public API (Phase A facade).
 * Invalidation entry point only — does not change slot math or cache policy.
 */
import 'server-only';

export {
  AvailabilityMutationNotifier,
  type AvailabilityMutationNotifierApi,
  type AvailabilityMutationReason,
  type BookingOccupancyRescheduledArgs,
  type BranchExceptionalHoursChangedArgs,
  type BranchHoursChangedArgs,
  type EmployeeBranchAssignmentChangedArgs,
  type EmployeeDayChangedArgs,
  type EmployeeWeeklyScheduleChangedArgs,
  type OccupancyChangedArgs,
} from './infra/mutationNotifier';

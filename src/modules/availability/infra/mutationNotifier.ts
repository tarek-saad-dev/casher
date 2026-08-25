/**
 * Phase A — thin adapter. No cache/calculation changes.
 * Implementation: src/lib/booking/AvailabilityMutationNotifier.ts
 */
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
} from '@/lib/booking/AvailabilityMutationNotifier';

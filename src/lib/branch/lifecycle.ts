/**
 * Phase 1M — branch lifecycle contract (server-side).
 * IsActive remains the production ops/nightly gate; LifecycleStatus is authoritative for stage.
 */
import 'server-only';

export const BRANCH_LIFECYCLE_STATUSES = [
  'SETUP',
  'SMOKE_TEST',
  'INTERNAL_LIVE',
  'PUBLIC_LIVE',
  'SUSPENDED',
] as const;

export type BranchLifecycleStatus = (typeof BRANCH_LIFECYCLE_STATUSES)[number];

export type LifecycleCapabilities = {
  internalAccess: 'admin_only' | 'smoke_allowlist' | 'authorized_staff' | 'admin_readonly';
  normalOperations: boolean;
  publicBooking: boolean;
  nightlyProductionJobs: boolean;
  externalNotifications: boolean;
  /** IsActive bit synced on transition for backward-compatible listActiveBranches. */
  isActive: boolean;
};

export const LIFECYCLE_CAPABILITIES: Record<BranchLifecycleStatus, LifecycleCapabilities> = {
  SETUP: {
    internalAccess: 'admin_only',
    normalOperations: false,
    publicBooking: false,
    nightlyProductionJobs: false,
    externalNotifications: false,
    isActive: false,
  },
  SMOKE_TEST: {
    internalAccess: 'smoke_allowlist',
    normalOperations: false, // controlled smoke runner only
    publicBooking: false,
    nightlyProductionJobs: false, // explicit smoke runner only
    externalNotifications: false,
    isActive: false,
  },
  INTERNAL_LIVE: {
    internalAccess: 'authorized_staff',
    normalOperations: true,
    publicBooking: false,
    nightlyProductionJobs: true,
    externalNotifications: true, // still requires explicit approval policy
    isActive: true,
  },
  PUBLIC_LIVE: {
    internalAccess: 'authorized_staff',
    normalOperations: true,
    publicBooking: true,
    nightlyProductionJobs: true,
    externalNotifications: true,
    isActive: true,
  },
  SUSPENDED: {
    internalAccess: 'admin_readonly',
    normalOperations: false,
    publicBooking: false,
    nightlyProductionJobs: false,
    externalNotifications: false,
    isActive: false,
  },
};

/** Allowed direct transitions (READY is calculated, not persisted). */
export const ALLOWED_LIFECYCLE_TRANSITIONS: Record<
  BranchLifecycleStatus,
  BranchLifecycleStatus[]
> = {
  SETUP: ['SMOKE_TEST', 'SUSPENDED'],
  SMOKE_TEST: ['SETUP', 'INTERNAL_LIVE', 'SUSPENDED'],
  INTERNAL_LIVE: ['PUBLIC_LIVE', 'SUSPENDED', 'SMOKE_TEST'],
  PUBLIC_LIVE: ['SUSPENDED', 'INTERNAL_LIVE'],
  SUSPENDED: ['SETUP', 'INTERNAL_LIVE'],
};

export function isBranchLifecycleStatus(value: unknown): value is BranchLifecycleStatus {
  return (
    typeof value === 'string' &&
    (BRANCH_LIFECYCLE_STATUSES as readonly string[]).includes(value)
  );
}

export function isTransitionAllowed(
  from: BranchLifecycleStatus,
  to: BranchLifecycleStatus,
): boolean {
  if (from === to) return false;
  return ALLOWED_LIFECYCLE_TRANSITIONS[from].includes(to);
}

/** Forbidden escalations called out by Phase 1M. */
export function isForbiddenLifecycleJump(
  from: BranchLifecycleStatus,
  to: BranchLifecycleStatus,
): boolean {
  if (from === 'SETUP' && to === 'PUBLIC_LIVE') return true;
  if (from === 'SMOKE_TEST' && to === 'PUBLIC_LIVE') return true;
  if (from === 'SUSPENDED' && to === 'PUBLIC_LIVE') return true;
  return !isTransitionAllowed(from, to);
}

export function capabilitiesFor(status: BranchLifecycleStatus): LifecycleCapabilities {
  return LIFECYCLE_CAPABILITIES[status];
}

export function isPubliclyDiscoverable(args: {
  lifecycleStatus: BranchLifecycleStatus;
  publicBookingEnabled: boolean;
  isActive: boolean;
}): boolean {
  return (
    args.lifecycleStatus === 'PUBLIC_LIVE' &&
    args.publicBookingEnabled === true &&
    args.isActive === true
  );
}

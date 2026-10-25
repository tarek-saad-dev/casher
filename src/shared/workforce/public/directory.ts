import type { ActorContext } from '@/platform/public';

/**
 * Employee identity is shared; booking eligibility, availability, payroll and clinical
 * practitioner credentials belong to their own domains and are NOT implied here.
 */
export interface WorkforceEmployeeSnapshot {
  employeeId: number;
  displayName: string;
  job: string | null;
  isActive: boolean;
}

/**
 * Canonical LocationId comes from an authenticated tenant context, NOT a raw BranchID.
 * The date is explicit so callers cannot accidentally use UTC "today" for branch
 * assignments. This checks active assignment only; temporary transfers and schedule
 * overrides are deliberately outside this directory contract.
 */
export interface WorkforceLocationScope {
  locationId: string;
  onDate: string; // ISO YYYY-MM-DD
}

export interface WorkforceDirectoryFilter {
  location?: WorkforceLocationScope;
  includeInactive?: boolean;
}

export interface WorkforceDirectoryPort {
  getEmployee(
    actor: ActorContext,
    employeeId: number,
    filter?: WorkforceDirectoryFilter,
  ): Promise<WorkforceEmployeeSnapshot | null>;
  listEmployees(
    actor: ActorContext,
    filter?: WorkforceDirectoryFilter,
  ): Promise<WorkforceEmployeeSnapshot[]>;
}

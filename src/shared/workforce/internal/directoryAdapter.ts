import 'server-only';
import { getPool, sql } from '@/lib/db';
import { requireMasterDataTenantId } from '@/platform/masterData/tenantScope';
import { TenantContextError } from '@/platform/tenant/tenantContext';
import type { ActorContext } from '@/platform/public';
import type {
  WorkforceDirectoryFilter,
  WorkforceDirectoryPort,
  WorkforceEmployeeSnapshot,
} from '../public/directory';

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

function bindScope(
  actor: ActorContext,
  filter: WorkforceDirectoryFilter,
  request: { input: (name: string, type: unknown, value: unknown) => unknown },
): { locationPredicate: string; activePredicate: string } {
  const tenantId = requireMasterDataTenantId(actor.tenantId, 'workforce.directory');
  request.input('tenantId', sql.UniqueIdentifier, tenantId);

  const location = filter.location;
  let locationPredicate = '';
  if (location) {
    if (!GUID.test(String(location.locationId ?? ''))) {
      throw new TenantContextError('LOCATION_NOT_IN_TENANT', 'Invalid LocationId in Workforce directory');
    }
    const date = String(location.onDate ?? '');
    // Require an actual calendar date, not just a syntactically valid number.
    if (!DAY.test(date) || Number.isNaN(Date.parse(date + 'T00:00:00Z')) ||
      new Date(date + 'T00:00:00Z').toISOString().slice(0, 10) !== date) {
      throw new TenantContextError('TENANT_CONTEXT_UNRESOLVED', 'Workforce directory requires a valid assignment date');
    }
    request.input('locationId', sql.UniqueIdentifier, location.locationId);
    request.input('assignmentDate', sql.Date, date);
    locationPredicate = `
      AND EXISTS (
        SELECT 1
        FROM dbo.Location l
        INNER JOIN dbo.TblBranch b ON b.BranchID = l.LegacyBranchId AND b.IsActive = 1
        INNER JOIN dbo.TblEmpBranchAssignment a
          ON a.BranchID = l.LegacyBranchId AND a.EmpID = e.EmpID
        WHERE l.TenantId = @tenantId
          AND l.LocationId = @locationId
          AND l.Status = N'active'
          AND a.IsActive = 1
          AND a.EffectiveFrom <= @assignmentDate
          AND (a.EffectiveTo IS NULL OR a.EffectiveTo >= @assignmentDate)
      )`;
  }

  return {
    locationPredicate,
    activePredicate: filter.includeInactive ? '' : 'AND ISNULL(e.isActive, 1) = 1',
  };
}

function mapEmployee(row: Record<string, unknown>): WorkforceEmployeeSnapshot {
  return {
    employeeId: Number(row.EmpID),
    displayName: String(row.EmpName ?? ''),
    job: row.Job == null ? null : String(row.Job),
    isActive: row.isActive == null || Boolean(row.isActive),
  };
}

/**
 * Read-only adapter for tenant-scoped workforce identity and branch membership.
 * No CUT fallback, automatic date or branch inference, bookability claim, SQL
 * mutation, or cross-module joins to payroll/booking tables.
 */
export function createLegacyWorkforceDirectoryAdapter(): WorkforceDirectoryPort {
  return {
    async getEmployee(actor, employeeId, filter = {}) {
      const db = await getPool();
      const req = db.request();
      const scope = bindScope(actor, filter, req);
      if (!Number.isSafeInteger(employeeId) || employeeId <= 0) return null;
      const result = await req
        .input('employeeId', sql.Int, employeeId)
        .query(`
          SELECT TOP 1 e.EmpID, e.EmpName, e.Job, e.isActive
          FROM dbo.TblEmp e
          WHERE e.TenantId = @tenantId
            AND e.EmpID = @employeeId
            ${scope.activePredicate}
            ${scope.locationPredicate};
        `);
      return result.recordset[0] ? mapEmployee(result.recordset[0] as Record<string, unknown>) : null;
    },

    async listEmployees(actor, filter = {}) {
      const db = await getPool();
      const req = db.request();
      const scope = bindScope(actor, filter, req);
      const result = await req.query(`
        SELECT e.EmpID, e.EmpName, e.Job, e.isActive
        FROM dbo.TblEmp e
        WHERE e.TenantId = @tenantId
          ${scope.activePredicate}
          ${scope.locationPredicate}
        ORDER BY e.EmpName, e.EmpID;
      `);
      return (result.recordset as Array<Record<string, unknown>>).map(mapEmployee);
    },
  };
}

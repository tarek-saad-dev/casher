import 'server-only';
import { getPool, sql } from '@/lib/db';
import type { ClinicalActor } from '../application/clinicalSafety';
import { isAuthenticatedClinicalReader, isClinicUuid } from '../application/encounterAuditPolicy';

/**
 * Restricted operational audit view: no clinical notes, patient profile, diagnosis,
 * prescription detail or opaque MetadataJson is ever returned.
 */
export type EncounterAuditEntry = {
  auditId: number;
  action: string;
  actorUserId: number | null;
  createdAt: Date;
};

type AuditRequest = {
  tenantId: string;
  encounterId: string;
  actor: ClinicalActor;
};

/**
 * Return null for nonexistent, cross-tenant, unlinked and unassigned encounters alike.
 * Audit the *read* in the same transaction; failed audit writes fail the entire read.
 * Tenant, linked login and assignment are checked again inside SQL, not only in the route.
 */
export async function listEncounterAuditForClinician(
  input: AuditRequest,
): Promise<EncounterAuditEntry[] | null> {
  if (
    !isClinicUuid(input.tenantId)
    || !isClinicUuid(input.encounterId)
    || !isAuthenticatedClinicalReader(input.actor, input.actor.kind === 'human' ? input.actor.userId : 0)
  ) return null;

  const actor = input.actor;
  if (actor.kind !== 'human') return null;

  const pool = await getPool();
  const tx = new sql.Transaction(pool);
  await tx.begin();
  try {
    const granted = await new sql.Request(tx)
      .input('tenantId', sql.UniqueIdentifier, input.tenantId)
      .input('encounterId', sql.UniqueIdentifier, input.encounterId)
      .input('userId', sql.Int, actor.userId)
      .input('empId', sql.Int, actor.empId)
      .query(`
        SELECT TOP (1) e.EncounterId
        FROM dbo.ClinicEncounter AS e WITH (HOLDLOCK)
        INNER JOIN dbo.ClinicPractitioner AS doctor WITH (HOLDLOCK)
          ON doctor.TenantId=e.TenantId
          AND doctor.EmpID=e.PractitionerEmpID
          AND doctor.UserID=@userId
          AND doctor.IsActive=1
        INNER JOIN dbo.TblEmp AS staff
          ON staff.TenantId=e.TenantId
          AND staff.EmpID=e.PractitionerEmpID
          AND ISNULL(staff.isActive, 1)=1
          AND staff.Job IN (N'طبيب', N'Doctor', N'doctor')
        WHERE e.TenantId=@tenantId
          AND e.EncounterId=@encounterId
          AND e.PractitionerEmpID=@empId;
      `);

    if (!granted.recordset.length) {
      await tx.rollback();
      return null;
    }

    const history = await new sql.Request(tx)
      .input('tenantId', sql.UniqueIdentifier, input.tenantId)
      .input('entityId', sql.NVarChar(128), input.encounterId)
      .query(`
        SELECT TOP (50) AuditId, Action, ActorUserID, CreatedAt
        FROM dbo.ClinicClinicalAudit
        WHERE TenantId=@tenantId
          AND EntityType=N'encounter'
          AND EntityId=@entityId
        ORDER BY AuditId DESC;
      `);

    await new sql.Request(tx)
      .input('tenantId', sql.UniqueIdentifier, input.tenantId)
      .input('entityId', sql.NVarChar(128), input.encounterId)
      .input('userId', sql.Int, actor.userId)
      .query(`
        INSERT INTO dbo.ClinicClinicalAudit
          (TenantId, EntityType, EntityId, Action, ActorUserID, MetadataJson)
        VALUES
          (@tenantId, N'encounter', @entityId, N'audit-read', @userId, N'{}');
      `);

    await tx.commit();
    return history.recordset.map((row: Record<string, unknown>) => ({
      auditId: Number(row.AuditId),
      action: String(row.Action),
      actorUserId: row.ActorUserID == null ? null : Number(row.ActorUserID),
      createdAt: row.CreatedAt as Date,
    }));
  } catch (error) {
    await tx.rollback().catch(() => undefined);
    throw error;
  }
}

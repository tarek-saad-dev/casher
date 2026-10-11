import 'server-only';
import { getPool, sql } from '@/lib/db';
import {
  assertHumanClinicalActor,
  assertPrescriptionSignable,
  type ClinicalActor,
} from '../application/clinicalSafety';
import type { ClinicPatientProfile, ClinicPrescriptionItem, ClinicVisitType } from '../public/types';

type UpsertPatientProfileInput = Omit<
  ClinicPatientProfile,
  'tenantId' | 'clientId' | 'updatedAt'
>;

export async function upsertPatientProfile(
  tenantId: string,
  clientId: number,
  input: UpsertPatientProfileInput,
  actorUserId: number,
): Promise<void> {
  const pool = await getPool();
  await pool.request()
    .input('tenantId', sql.UniqueIdentifier, tenantId)
    .input('clientId', sql.Int, clientId)
    .input('bloodType', sql.NVarChar(8), input.bloodType)
    .input('allergies', sql.NVarChar(sql.MAX), input.allergies)
    .input('chronic', sql.NVarChar(sql.MAX), input.chronicConditions)
    .input('medications', sql.NVarChar(sql.MAX), input.currentMedications)
    .input('emergencyName', sql.NVarChar(100), input.emergencyContactName)
    .input('emergencyPhone', sql.NVarChar(32), input.emergencyContactPhone)
    .input('notes', sql.NVarChar(sql.MAX), input.notes)
    .input('actorUserId', sql.Int, actorUserId)
    .query(`
      MERGE dbo.ClinicPatientProfile AS target
      USING (SELECT @tenantId AS TenantId, @clientId AS ClientID) AS source
      ON target.TenantId = source.TenantId AND target.ClientID = source.ClientID
      WHEN MATCHED THEN UPDATE SET
        BloodType=@bloodType,
        Allergies=@allergies,
        ChronicConditions=@chronic,
        CurrentMedications=@medications,
        EmergencyContactName=@emergencyName,
        EmergencyContactPhone=@emergencyPhone,
        Notes=@notes,
        UpdatedAt=SYSUTCDATETIME()
      WHEN NOT MATCHED THEN
        INSERT (
          TenantId, ClientID, BloodType, Allergies, ChronicConditions,
          CurrentMedications, EmergencyContactName, EmergencyContactPhone, Notes
        )
        VALUES (
          @tenantId, @clientId, @bloodType, @allergies, @chronic,
          @medications, @emergencyName, @emergencyPhone, @notes
        );

      INSERT INTO dbo.ClinicClinicalAudit
        (TenantId, EntityType, EntityId, Action, ActorUserID, MetadataJson)
      VALUES
        (@tenantId, N'patient-profile', CONVERT(NVARCHAR(128), @clientId),
         N'upsert', @actorUserId, N'{}');
    `);
}

export async function openEncounter(input: {
  tenantId: string;
  clientId: number;
  practitionerEmpId: number;
  locationId: string;
  bookingRef?: string | null;
  visitType: ClinicVisitType;
  chiefComplaint?: string | null;
  actorUserId: number;
}): Promise<string> {
  const pool = await getPool();
  const result = await pool.request()
    .input('tenantId', sql.UniqueIdentifier, input.tenantId)
    .input('clientId', sql.Int, input.clientId)
    .input('practitionerEmpId', sql.Int, input.practitionerEmpId)
    .input('locationId', sql.UniqueIdentifier, input.locationId)
    .input('bookingRef', sql.NVarChar(128), input.bookingRef ?? null)
    .input('visitType', sql.NVarChar(20), input.visitType)
    .input('chiefComplaint', sql.NVarChar(1000), input.chiefComplaint ?? null)
    .input('actorUserId', sql.Int, input.actorUserId)
    .query(`
      INSERT INTO dbo.ClinicEncounter (
        TenantId, ClientID, PractitionerEmpID, LocationId, BookingRef,
        VisitType, Status, ChiefComplaint, StartedAt, CreatedByUserID
      )
      OUTPUT INSERTED.EncounterId
      VALUES (
        @tenantId, @clientId, @practitionerEmpId, @locationId, @bookingRef,
        @visitType, N'in_progress', @chiefComplaint, SYSUTCDATETIME(), @actorUserId
      );
    `);
  const encounterId = String(result.recordset[0].EncounterId);

  await pool.request()
    .input('tenantId', sql.UniqueIdentifier, input.tenantId)
    .input('entityId', sql.NVarChar(128), encounterId)
    .input('actorUserId', sql.Int, input.actorUserId)
    .query(`
      INSERT INTO dbo.ClinicClinicalAudit
        (TenantId, EntityType, EntityId, Action, ActorUserID, MetadataJson)
      VALUES (@tenantId, N'encounter', @entityId, N'opened', @actorUserId, N'{}');
    `);

  return encounterId;
}

export async function completeEncounter(input: {
  tenantId: string;
  encounterId: string;
  actor: ClinicalActor;
  clinicalNotes?: string | null;
  diagnosisSummary?: string | null;
  vitals?: Record<string, unknown> | null;
  followUpAt?: Date | null;
}): Promise<void> {
  assertHumanClinicalActor(input.actor, 'complete-encounter');
  const pool = await getPool();
  await pool.request()
    .input('tenantId', sql.UniqueIdentifier, input.tenantId)
    .input('encounterId', sql.UniqueIdentifier, input.encounterId)
    .input('empId', sql.Int, input.actor.empId)
    .input('userId', sql.Int, input.actor.userId)
    .input('clinicalNotes', sql.NVarChar(sql.MAX), input.clinicalNotes ?? null)
    .input('diagnosis', sql.NVarChar(sql.MAX), input.diagnosisSummary ?? null)
    .input('vitals', sql.NVarChar(sql.MAX), input.vitals ? JSON.stringify(input.vitals) : null)
    .input('followUpAt', sql.DateTime2, input.followUpAt ?? null)
    .query(`
      UPDATE dbo.ClinicEncounter
      SET ClinicalNotes=@clinicalNotes,
          DiagnosisSummary=@diagnosis,
          VitalsJson=@vitals,
          FollowUpAt=@followUpAt,
          Status=N'completed',
          CompletedAt=SYSUTCDATETIME(),
          UpdatedAt=SYSUTCDATETIME()
      WHERE TenantId=@tenantId
        AND EncounterId=@encounterId
        AND PractitionerEmpID=@empId
        AND Status=N'in_progress';

      IF @@ROWCOUNT <> 1
        THROW 51201, N'Clinic encounter was not found, is not in progress, or belongs to another practitioner.', 1;

      INSERT INTO dbo.ClinicClinicalAudit
        (TenantId, EntityType, EntityId, Action, ActorUserID, MetadataJson)
      VALUES
        (@tenantId, N'encounter', CONVERT(NVARCHAR(128), @encounterId),
         N'completed', @userId, N'{}');
    `);
}

export async function createPrescriptionDraft(input: {
  tenantId: string;
  encounterId: string;
  actor: ClinicalActor;
  notes?: string | null;
  items: ClinicPrescriptionItem[];
}): Promise<string> {
  assertHumanClinicalActor(input.actor, 'sign-prescription');
  if (!Array.isArray(input.items) || input.items.length < 1) {
    throw new Error('Prescription requires at least one medication.');
  }

  const pool = await getPool();
  const tx = new sql.Transaction(pool);
  await tx.begin();
  try {
    const created = await new sql.Request(tx)
      .input('tenantId', sql.UniqueIdentifier, input.tenantId)
      .input('encounterId', sql.UniqueIdentifier, input.encounterId)
      .input('empId', sql.Int, input.actor.empId)
      .input('userId', sql.Int, input.actor.userId)
      .input('notes', sql.NVarChar(sql.MAX), input.notes ?? null)
      .query(`
        INSERT INTO dbo.ClinicPrescription
          (TenantId, EncounterId, PractitionerEmpID, Status, Notes, CreatedByUserID)
        OUTPUT INSERTED.PrescriptionId
        VALUES
          (@tenantId, @encounterId, @empId, N'draft', @notes, @userId);
      `);

    const prescriptionId = String(created.recordset[0].PrescriptionId);
    let sortOrder = 0;
    for (const item of input.items) {
      const medicationName = String(item.medicationName ?? '').trim();
      if (!medicationName) throw new Error('Medication name is required.');
      sortOrder += 1;
      await new sql.Request(tx)
        .input('tenantId', sql.UniqueIdentifier, input.tenantId)
        .input('prescriptionId', sql.UniqueIdentifier, prescriptionId)
        .input('sortOrder', sql.Int, sortOrder)
        .input('name', sql.NVarChar(200), medicationName)
        .input('strength', sql.NVarChar(100), item.strength ?? null)
        .input('dosage', sql.NVarChar(100), item.dosage ?? null)
        .input('route', sql.NVarChar(100), item.route ?? null)
        .input('frequency', sql.NVarChar(100), item.frequency ?? null)
        .input('duration', sql.NVarChar(100), item.duration ?? null)
        .input('instructions', sql.NVarChar(1000), item.instructions ?? null)
        .query(`
          INSERT INTO dbo.ClinicPrescriptionItem (
            TenantId, PrescriptionId, SortOrder, MedicationName, Strength,
            Dosage, Route, Frequency, Duration, Instructions
          )
          VALUES (
            @tenantId, @prescriptionId, @sortOrder, @name, @strength,
            @dosage, @route, @frequency, @duration, @instructions
          );
        `);
    }

    await tx.commit();
    return prescriptionId;
  } catch (err) {
    await tx.rollback().catch(() => undefined);
    throw err;
  }
}

export async function signPrescription(input: {
  tenantId: string;
  prescriptionId: string;
  actor: ClinicalActor;
}): Promise<void> {
  assertHumanClinicalActor(input.actor, 'sign-prescription');
  const pool = await getPool();
  const current = await pool.request()
    .input('tenantId', sql.UniqueIdentifier, input.tenantId)
    .input('prescriptionId', sql.UniqueIdentifier, input.prescriptionId)
    .query(`
      SELECT p.Status, COUNT(i.PrescriptionItemId) AS ItemCount
      FROM dbo.ClinicPrescription p
      LEFT JOIN dbo.ClinicPrescriptionItem i
        ON i.TenantId=p.TenantId AND i.PrescriptionId=p.PrescriptionId
      WHERE p.TenantId=@tenantId AND p.PrescriptionId=@prescriptionId
      GROUP BY p.Status;
    `);

  const row = current.recordset[0] as { Status: string; ItemCount: number } | undefined;
  if (!row) throw new Error('Prescription not found.');
  assertPrescriptionSignable({
    actor: input.actor,
    status: row.Status,
    itemCount: Number(row.ItemCount),
  });

  await pool.request()
    .input('tenantId', sql.UniqueIdentifier, input.tenantId)
    .input('prescriptionId', sql.UniqueIdentifier, input.prescriptionId)
    .input('empId', sql.Int, input.actor.empId)
    .input('userId', sql.Int, input.actor.userId)
    .query(`
      UPDATE dbo.ClinicPrescription
      SET Status=N'signed', SignedAt=SYSUTCDATETIME(), UpdatedAt=SYSUTCDATETIME()
      WHERE TenantId=@tenantId
        AND PrescriptionId=@prescriptionId
        AND PractitionerEmpID=@empId
        AND Status=N'draft';

      IF @@ROWCOUNT <> 1
        THROW 51202, N'Prescription could not be signed by this practitioner.', 1;

      INSERT INTO dbo.ClinicClinicalAudit
        (TenantId, EntityType, EntityId, Action, ActorUserID, MetadataJson)
      VALUES
        (@tenantId, N'prescription', CONVERT(NVARCHAR(128), @prescriptionId),
         N'signed', @userId, N'{}');
    `);
}

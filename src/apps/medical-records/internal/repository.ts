import 'server-only';
import { getPool, sql } from '@/lib/db';
import {
  assertHumanClinicalActor,
  assertPrescriptionSignable,
  ClinicalSafetyError,
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

export async function registerClinicPractitioner(input: {
  tenantId: string;
  empId: number;
  userId?: number | null;
  actorUserId: number;
  specialty?: string | null;
  licenseNumber?: string | null;
}): Promise<void> {
  const pool = await getPool();
  const tx = new sql.Transaction(pool);
  await tx.begin();
  try {
    const emp = await new sql.Request(tx)
      .input('tenantId', sql.UniqueIdentifier, input.tenantId)
      .input('empId', sql.Int, input.empId)
      .query(`
        SELECT EmpID, Job
        FROM dbo.TblEmp
        WHERE TenantId=@tenantId AND EmpID=@empId AND ISNULL(isActive,1)=1;
      `);
    const row = emp.recordset[0] as { EmpID: number; Job: string | null } | undefined;
    if (!row || !['طبيب', 'Doctor', 'doctor'].includes(String(row.Job ?? ''))) {
      throw new Error('Practitioner must be an active doctor in this tenant.');
    }

    if (input.userId != null) {
      const membership = await new sql.Request(tx)
        .input('tenantId', sql.UniqueIdentifier, input.tenantId)
        .input('userId', sql.Int, input.userId)
        .query(`
          SELECT TOP 1 m.MembershipId
          FROM dbo.TenantMembership m
          INNER JOIN dbo.TblUser u
            ON u.UserID=m.LegacyUserId AND ISNULL(u.isDeleted,0)=0
          WHERE m.TenantId=@tenantId AND m.LegacyUserId=@userId;
        `);
      if (!membership.recordset.length) {
        throw new Error('Clinical user must belong to this tenant.');
      }

      const other = await new sql.Request(tx)
        .input('tenantId', sql.UniqueIdentifier, input.tenantId)
        .input('userId', sql.Int, input.userId)
        .input('empId', sql.Int, input.empId)
        .query(`
          SELECT EmpID
          FROM dbo.ClinicPractitioner
          WHERE TenantId=@tenantId
            AND UserID=@userId
            AND EmpID<>@empId
            AND IsActive=1;
        `);
      if (other.recordset.length) {
        throw new Error('This login is already linked to another practitioner.');
      }
    }

    await new sql.Request(tx)
      .input('tenantId', sql.UniqueIdentifier, input.tenantId)
      .input('empId', sql.Int, input.empId)
      .input('userId', sql.Int, input.userId ?? null)
      .input('specialty', sql.NVarChar(120), input.specialty?.trim() || null)
      .input('licenseNumber', sql.NVarChar(120), input.licenseNumber?.trim() || null)
      .input('actorUserId', sql.Int, input.actorUserId)
      .query(`
        MERGE dbo.ClinicPractitioner AS target
        USING (SELECT @tenantId AS TenantId, @empId AS EmpID) AS source
          ON target.TenantId=source.TenantId AND target.EmpID=source.EmpID
        WHEN MATCHED THEN UPDATE SET
          UserID=COALESCE(@userId, target.UserID),
          Specialty=COALESCE(@specialty, target.Specialty),
          LicenseNumber=COALESCE(@licenseNumber, target.LicenseNumber),
          IsActive=1,
          UpdatedAt=SYSUTCDATETIME()
        WHEN NOT MATCHED THEN
          INSERT (TenantId, EmpID, UserID, Specialty, LicenseNumber, IsActive, CreatedByUserID)
          VALUES (@tenantId, @empId, @userId, @specialty, @licenseNumber, 1, @actorUserId);

        INSERT INTO dbo.ClinicClinicalAudit
          (TenantId, EntityType, EntityId, Action, ActorUserID, MetadataJson)
        VALUES
          (@tenantId, N'practitioner', CONVERT(NVARCHAR(128), @empId),
           CASE WHEN @userId IS NULL THEN N'registered' ELSE N'login-linked' END,
           @actorUserId, N'{}');
      `);

    await tx.commit();
  } catch (err) {
    await tx.rollback().catch(() => undefined);
    throw err;
  }
}

export async function resolveClinicalActorForUser(
  tenantId: string,
  userId: number,
): Promise<ClinicalActor | null> {
  const pool = await getPool();
  const result = await pool.request()
    .input('tenantId', sql.UniqueIdentifier, tenantId)
    .input('userId', sql.Int, userId)
    .query(`
      SELECT TOP 1 p.EmpID
      FROM dbo.ClinicPractitioner p
      INNER JOIN dbo.TblEmp e
        ON e.TenantId=p.TenantId AND e.EmpID=p.EmpID AND ISNULL(e.isActive,1)=1
      WHERE p.TenantId=@tenantId
        AND p.UserID=@userId
        AND p.IsActive=1;
    `);
  const row = result.recordset[0] as { EmpID: number } | undefined;
  return row ? { kind: 'human', userId, empId: Number(row.EmpID) } : null;
}

export async function getEncounterWorkspace(
  tenantId: string,
  encounterId: string,
): Promise<Record<string, unknown> | null> {
  const pool = await getPool();
  const encounter = await pool.request()
    .input('tenantId', sql.UniqueIdentifier, tenantId)
    .input('encounterId', sql.UniqueIdentifier, encounterId)
    .query(`
      SELECT
        e.EncounterId,
        e.ClientID,
        c.Name AS PatientName,
        c.Mobile AS PatientMobile,
        c.BirthDate,
        e.PractitionerEmpID,
        p.EmpName AS PractitionerName,
        e.VisitType,
        e.Status,
        e.ChiefComplaint,
        e.ClinicalNotes,
        e.DiagnosisSummary,
        e.VitalsJson,
        e.FollowUpAt,
        e.StartedAt,
        e.CompletedAt,
        e.CreatedAt,
        e.UpdatedAt
      FROM dbo.ClinicEncounter e
      INNER JOIN dbo.TblClient c
        ON c.TenantId=e.TenantId AND c.ClientID=e.ClientID
      INNER JOIN dbo.TblEmp p
        ON p.TenantId=e.TenantId AND p.EmpID=e.PractitionerEmpID
      WHERE e.TenantId=@tenantId AND e.EncounterId=@encounterId;
    `);
  const row = encounter.recordset[0] as Record<string, unknown> | undefined;
  if (!row) return null;

  const profile = await pool.request()
    .input('tenantId', sql.UniqueIdentifier, tenantId)
    .input('clientId', sql.Int, Number(row.ClientID))
    .query(`
      SELECT
        BloodType,
        Allergies,
        ChronicConditions,
        CurrentMedications,
        EmergencyContactName,
        EmergencyContactPhone,
        Notes,
        UpdatedAt
      FROM dbo.ClinicPatientProfile
      WHERE TenantId=@tenantId AND ClientID=@clientId;
    `);

  const prescriptions = await pool.request()
    .input('tenantId', sql.UniqueIdentifier, tenantId)
    .input('encounterId', sql.UniqueIdentifier, encounterId)
    .query(`
      SELECT PrescriptionId, PractitionerEmpID, Status, Notes, SignedAt, CreatedAt, UpdatedAt
      FROM dbo.ClinicPrescription
      WHERE TenantId=@tenantId AND EncounterId=@encounterId
      ORDER BY CreatedAt DESC;
    `);

  const ids = (prescriptions.recordset as Array<{ PrescriptionId: string }>)
    .map((x) => String(x.PrescriptionId));
  let itemRows: Array<Record<string, unknown>> = [];
  if (ids.length) {
    const items = await pool.request()
      .input('tenantId', sql.UniqueIdentifier, tenantId)
      .input('encounterId', sql.UniqueIdentifier, encounterId)
      .query(`
        SELECT
          i.PrescriptionItemId,
          i.PrescriptionId,
          i.SortOrder,
          i.MedicationName,
          i.Strength,
          i.Dosage,
          i.Route,
          i.Frequency,
          i.Duration,
          i.Instructions
        FROM dbo.ClinicPrescriptionItem i
        INNER JOIN dbo.ClinicPrescription p
          ON p.TenantId=i.TenantId AND p.PrescriptionId=i.PrescriptionId
        WHERE i.TenantId=@tenantId AND p.EncounterId=@encounterId
        ORDER BY i.PrescriptionId, i.SortOrder;
      `);
    itemRows = items.recordset as Array<Record<string, unknown>>;
  }

  const itemsByPrescription = new Map<string, Array<Record<string, unknown>>>();
  for (const item of itemRows) {
    const id = String(item.PrescriptionId);
    const list = itemsByPrescription.get(id) ?? [];
    list.push(item);
    itemsByPrescription.set(id, list);
  }

  return {
    encounter: row,
    patientProfile: (profile.recordset[0] as Record<string, unknown> | undefined) ?? null,
    prescriptions: (prescriptions.recordset as Array<Record<string, unknown>>).map((prescription) => ({
      ...prescription,
      items: itemsByPrescription.get(String(prescription.PrescriptionId)) ?? [],
    })),
  };
}

export async function saveEncounterDraft(input: {
  tenantId: string;
  encounterId: string;
  actor: ClinicalActor;
  clinicalNotes?: string | null;
  diagnosisSummary?: string | null;
  vitals?: Record<string, unknown> | null;
  followUpAt?: Date | null;
}): Promise<void> {
  assertHumanClinicalActor(input.actor, 'complete-encounter');
  if (!String(input.diagnosisSummary ?? '').trim()) {
    throw new ClinicalSafetyError(
      'DIAGNOSIS_REQUIRED',
      'Diagnosis summary is required before completing an encounter.',
    );
  }
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
          UpdatedAt=SYSUTCDATETIME()
      WHERE TenantId=@tenantId
        AND EncounterId=@encounterId
        AND PractitionerEmpID=@empId
        AND Status=N'in_progress';

      IF @@ROWCOUNT <> 1
        THROW 51203, N'Only the assigned practitioner can edit an in-progress encounter.', 1;

      INSERT INTO dbo.ClinicClinicalAudit
        (TenantId, EntityType, EntityId, Action, ActorUserID, MetadataJson)
      VALUES
        (@tenantId, N'encounter', CONVERT(NVARCHAR(128), @encounterId),
         N'draft-saved', @userId, N'{}');
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
        SELECT
          @tenantId, e.EncounterId, @empId, N'draft', @notes, @userId
        FROM dbo.ClinicEncounter e
        WHERE e.TenantId=@tenantId
          AND e.EncounterId=@encounterId
          AND e.PractitionerEmpID=@empId
          AND e.Status=N'in_progress';
      `);

    if (!created.recordset[0]) {
      throw new Error('Only the assigned practitioner can prescribe during an in-progress encounter.');
    }
    const prescriptionId = String(created.recordset[0].PrescriptionId);

    await new sql.Request(tx)
      .input('tenantId', sql.UniqueIdentifier, input.tenantId)
      .input('prescriptionId', sql.UniqueIdentifier, prescriptionId)
      .input('userId', sql.Int, input.actor.userId)
      .query(`
        INSERT INTO dbo.ClinicClinicalAudit
          (TenantId, EntityType, EntityId, Action, ActorUserID, MetadataJson)
        VALUES
          (@tenantId, N'prescription', CONVERT(NVARCHAR(128), @prescriptionId),
           N'draft-created', @userId, N'{}');
      `);
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

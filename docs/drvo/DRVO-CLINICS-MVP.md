# DRVO Clinics MVP

DRVO Clinics is an industry pack on the existing multi-tenant DRVO platform, not a fork.

## Source of truth

- Patient identity: `TblClient`
- Practitioner identity: `TblEmp`
- Appointment scheduling: Booking
- Billing and payments: POS / Treasury
- Clinical data: Medical Records

## MVP flow

`Patient → Appointment → Encounter → Prescription → Payment → Follow-up`

The first vertical slice adds the clinical middle of the flow without duplicating booking or billing.

## Clinical safety boundary

The AI receptionist is administrative-only. It may schedule, reschedule and send administrative reminders. It cannot complete encounters, make diagnoses as a clinical authority, or sign prescriptions. Clinical completion/sign-off requires a human practitioner.

## New medical tables

- `ClinicPatientProfile`
- `ClinicEncounter`
- `ClinicPrescription`
- `ClinicPrescriptionItem`
- `ClinicClinicalAudit`

All clinical rows are tenant-scoped and patient/practitioner foreign keys are tenant-consistent.

## Next slices

1. Clinic workspace UI: today's appointments, patient search, encounter workspace.
2. Prescription editor and printable prescription with practitioner sign-off.
3. Booking → encounter handoff and encounter → POS billing link.
4. Follow-up queue and WhatsApp administrative reminders.
5. Medical RBAC and audit viewer.

# DRVO Clinics — Booking → Encounter (Agent 3)

## Product intent
Show canonical Booking appointments within `/clinic`. Reception records patient arrival, and the doctor can start an encounter from that same appointment. No separate appointment storage, new booking writer, or POS duplication.

## Flow
1. `GET /api/clinic/appointments?date=YYYY-MM-DD` returns branch/day doctor bookings, joined through the authenticated tenant's `TblClient`, `TblEmp`, and active `ClinicPractitioner`.
2. `POST /api/clinic/appointments/:bookingId` with `{"action":"arrive"}` moves a pending/confirmed Booking to the shared `arrived` state.
3. Same endpoint with `{"action":"start","visitType":"new"}` starts an in-progress encounter only for an arrived/queued booking. The patient and doctor come **from the locked Booking row**. `BookingRef=booking:<BookingID>` links the records; canonical Booking moves to `in_service`.
4. Repeated start of the same booking returns the original `EncounterId`, not a second visit. Cancelled/no-show/rescheduled bookings cannot create a new visit.
5. `/clinic` has a lightweight day/date appointment list, check-in CTA, start CTA, and link to the existing clinical workspace.

## Implementation boundaries
- Tenant, active branch and location are always obtained from `requireTenantApp('medical-records')`; client body cannot impersonate them or the practitioner.
- The canonical Booking row is locked `UPDLOCK, HOLDLOCK` inside the transaction, before checking `ClinicEncounter.BookingRef`. Encounter insert, the existing `ClinicClinicalAudit` append and Booking status update commit or rollback **together**.
- Doctor's active assignment is checked against **the Booking date**, not the current salon business-date cutoff; clinic's day picker uses Cairo calendar dates.
- Read-only Booking query and scoped Booking status updates are clinic integration adapters; **no changes to shared Booking APIs or salon behavior**.
- No migrations or deployment. Migration 014 and PR #90 remain prerequisites.
- Scope deliberately defers fine-grained cross-product permission matrices, exhaustive security review, advanced physician dashboards, Billing/POS handoff, follow-up automation. Existing entitlement, tenant scoping and clinical ownership checks are non-negotiable baseline protections.

## Test plan
- Added `appointmentHandoffPolicy.test.ts`, `appointmentHandoffRepository.test.ts`, `appointmentHandoffRoutes.test.ts` for validation, tenant/branch scoping, attendance, cancellation, doctor assignment, idempotent retries, and transaction rollback.
- QA must execute:
  `npx vitest run src/apps/medical-records/__tests__/appointmentHandoffPolicy.test.ts src/apps/medical-records/__tests__/appointmentHandoffRepository.test.ts src/apps/medical-records/__tests__/appointmentHandoffRoutes.test.ts`
  then `npm run build`.
- Staging smoke with migration 014: 2 simultaneous start requests yield **one** encounter; verify Booking `arrived → in_service`, existing visit link, cancellation rejection, branch/tenant separation, and case of absent doctor branch assignment.
- Do not merge or deploy without green checks. Stacked PR base: `feature/drvo-clinics-mvp`, and parent PR #90 must merge or have base retargeted under QA supervision.

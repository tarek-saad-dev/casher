# DRVO Clinics — Doctor's Daily Worklist (Agent 3)

## What this slice delivers

- New doctor-facing `/clinic/doctor`, linked from clinic reception `/clinic`.
- Date-aware list of appointments assigned to the **logged-in clinician in the active branch**; practitioner identity is resolved via the existing `ClinicPractitioner.UserID` lookup.
- Direct list states: waiting/arrived, not arrived, in consultation, completed, cancelled/missed. Dashboard counts, status and patient/booking search, refresh and mobile-friendly list.
- Doctor can **start** a checked-in consultation, or open an existing clinical encounter. Reception remains owner of patient check-in.
- Unlinked staff accounts get a clear `403 CLINIC_DOCTOR_NOT_LINKED` guidance state; no patient list is returned.
- Reuses canonical `Bookings`, `ClinicEncounter`, and existing handoff engine. No duplicate appointments, credentials, schedules or migrations.

## Module contracts

- Application logic: existing pure `receptionBoard` projection.
- Server read adapter: `src/apps/medical-records/internal/doctorWorklistRepository.ts`.
- Doctor only API: `GET /api/clinic/my-day?date=YYYY-MM-DD` and `POST /api/clinic/my-day/:bookingId` (`action: start`).
- Both APIs require the installed `medical-records` app and resolve doctor identity exclusively from the authenticated session; no doctor/tenant/branch query parameter controls access.
- SQL reads require tenant + active branch + linked `ClinicPractitioner.UserID` + doctor employee ID + booking date. Doctor-side start supplies `expectedPractitionerEmpId` into the **locked canonical booking row's** transaction. The same employee ID is checked before creating an encounter, and an existing encounter belonging to another doctor is rejected rather than exposed/reused.
- Existing reception API remains unchanged; doctor worklist never changes Booking's `arrived` state and cannot check in an unarrived patient.
- Existing clinical workspace and Rx APIs keep their existing human-clinician checks.

## Current scope / next iterations

- Doctor list currently includes **booked appointments only**. Walk-in encounters already supported by `/clinic/setup` but are not yet projected in the doctor worklist; adding walk-in encounters is a follow-up task.
- Doctor access is authenticated clinician identity + existing active branch, **not** a new permission matrix. Detailed platform-wide security phase remains later, but baseline patient/tenant/doctor isolation is enforced now.
- Real-time push and auto-refresh are deferred; manual refresh is available.
- Follow-up: clinical encounter + prescription UX from approved wireframe, then the shared POS handoff.

## QA and sign-off

```bash
npx vitest run src/apps/medical-records/__tests__/doctorWorklistRepository.test.ts src/apps/medical-records/__tests__/doctorWorklistRoutes.test.ts src/apps/medical-records/__tests__/clinicDoctorWorklist.test.tsx src/apps/medical-records/__tests__/appointmentHandoffRepository.test.ts src/apps/medical-records/__tests__/clinicPack.test.ts
npm run build
```

Staging/browser smoke (migration 014 prerequisite):
1. Link doctor A user, book patients for doctors A and B in same active branch. Doctor A sees **only A**.
2. Reception checks in A's patient; A starts encounter and navigates directly to chart.
3. Doctor B cannot start A's booking using a forged POST; unlinked account gets 403.
4. Retry concurrent start: exactly one encounter. Cancel/no-show and unarrived bookings cannot start.
5. Reassign a booking after an encounter: do not expose or reuse another doctor's clinical record.
6. Confirm active branch isolation, Cairo calendar date, empty/error states, desktop and mobile.

**No full Vitest/build/staging execution in this environment yet.** Base is open Clinics PR #90. Leave draft until CI/review and staging tests green; only human may merge, main merge triggers production deploy.

## Changed source paths
- `src/app/clinic/doctor/page.tsx`
- `src/app/clinic/ClinicDoctorWorklist.tsx`
- `src/app/clinic/ClinicReceptionPage.tsx`
- `src/app/api/clinic/my-day/route.ts`
- `src/app/api/clinic/my-day/[bookingId]/route.ts`
- `src/apps/medical-records/internal/doctorWorklistRepository.ts`
- `src/apps/medical-records/internal/appointmentHandoffRepository.ts`
- Targeted tests for GET, POST, SQL guard, retries and UX.

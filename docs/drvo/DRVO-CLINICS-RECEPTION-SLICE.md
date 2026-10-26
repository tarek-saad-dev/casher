# DRVO Clinics — Reception-first module slice

## Scope
Product priority is usable clinic operations and clear navigation, not the advanced security phase. This PR is a UI and read-model slice over shared domains; no new schema, POS writer, Booking engine or credentials.

### Page and ownership map
- `/clinic` is now the **reception landing**. It renders `ClinicReceptionPage` and `ClinicAppointmentsPanel`.
- `/clinic/setup` holds the already-implemented patient search/create, doctor setup/login linking and walk-in encounter start (`ClinicWorkspace`), no copy of business logic.
- `/bookings` remains the canonical create/reschedule/cancel Booking UI; `/income/pos` remains the shared financial UI.
- `/clinic/encounters/[encounterId]` remains the clinician-owned workspace.

### Independent module boundaries
- `src/apps/medical-records/application/receptionBoard.ts` contains *pure view projection*: patient queue categories, counters and client-side filtering.
- `src/app/clinic/ClinicAppointmentsPanel.tsx` is **presentation only**; it gets appointments from the existing `GET /api/clinic/appointments` adapter and uses existing `POST /api/clinic/appointments/:bookingId` for arrive/start.
- Auth, tenant and branch validation stays server-side in those pre-existing API routes.
- No direct reading or writing other modules' tables from UI, no parallel database or appointment state.

### UX behavior
- Today/date selector, manual refresh, search by patient/doctor/booking ID, doctor selector, status chips.
- Counters: all booked, waiting, in consultation, encounter completed.
- Clinical visit completion takes precedence over a lagging Booking `in_service` status for presentation.
- Pending/confirmed: `تسجيل حضور`; arrived/queued: `بدء الكشف`; linked: `عرض الكشف`; terminal statuses: no unsafe CTA.
- Clear loading, empty date, empty filters, and error states; narrow viewport stacks cards.

### Scope caveats and next slices
- Current `/clinic/setup` is **not yet full setup** (specialty, per-doctor availability and service price editing still use or await the shared config interfaces). This PR intentionally moves the pre-existing patient/doctor tools without inventing duplicate scheduling or pricing stores.
- Dedicated doctor worklist, actual quick-booking within reception, follow-up automation, printable Rx, POS prefill and detailed platform security remain follow-up slices.
- Parent PR #90 (`feature/drvo-clinics-mvp`) is unmerged. This PR must be stacked against it until the parent is approved.
- Do not merge to main or deploy without targeted Vitest, build, migration-014 staging readiness and browser walkthrough by independent reviewer.

### Tests
```bash
npx vitest run src/apps/medical-records/__tests__/receptionBoard.test.ts src/apps/medical-records/__tests__/clinicReception.test.tsx src/apps/medical-records/__tests__/clinicWorkspace.test.tsx src/apps/medical-records/__tests__/appointmentHandoffRoutes.test.ts
npm run build
```
Manually: clinic -> book -> check-in -> start -> encounter; setup -> patient/doctor; desktop and mobile; filters by doctor; broken API; tenant branch switch.

### Physician specialization: first real clinic setup field
- Existing `ClinicPractitioner.Specialty` is used; there is **no new table or migration**.
- `GET /api/clinic/practitioners` returns the specialty for each clinic doctor.
- Administrator can add/update an optional specialty using the existing `POST /api/clinic/practitioners` path. Input is a max 120-character string, optional, and the repository's existing tenant/doctor checks are unchanged.
- `/clinic/setup` shows a specialty text input and doctor selection displays the persisted specialty.
- Editing doctor schedules and consultation pricing via Shared Booking/Catalog remains the next configuration slice.
- QA also run `src/apps/medical-records/__tests__/practitionerRoutes.test.ts`.

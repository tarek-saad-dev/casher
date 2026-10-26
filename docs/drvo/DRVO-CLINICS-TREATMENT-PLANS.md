# DRVO Clinics — Treatment Plans / Follow-up Sessions

## Scope and ownership
A clinician can create a **numbered treatment plan** from a completed encounter and track how many sessions have actually been performed. This is a medical-records orchestration module, not a duplicate scheduler or POS product.

- **Booking** remains authoritative for patient, doctor, branch, calendar, rescheduling and cancellation.
- **Medical Records** remains authoritative for the clinical encounter and its completed status.
- **Treatment Plan** owns the goal/title, planned session count and one optional **BookingID link per numbered session**.
- **Shared POS / Treasury** are unchanged; the plan does not charge money, issue invoices or promise that a session is prepaid.
- No automatically generated calendar slots, inventory writes, fake session completion, new payment states or WhatsApp messaging.

## UX
Within the existing encounter's **03 — المتابعة** tab, assigned clinician sees plans for this patient/doctor in the current location.
- After completing an encounter, create a title and number of sessions (1–50).
- Each plan displays completed, booked, remaining and attention-needed totals with a progress bar.
- To schedule a session, open **/bookings** (Shared Booking), make the appointment using its existing controls, then link its booking ID to a numbered session.
- A linked session is **completed only when the real ClinicEncounter linked to its BookingRef is status=completed**; Booking status alone does not count as treatment performed.
- Cancelled/no-show/rescheduled booking statuses are shown as needing review.
- The existing encounter link opens the clinical visit; prior patient's plan shows in other encounter visits with the same assigned doctor/branch.

## Database / migration
**Migration 016** `db/drvo-migrations/016-clinic-treatment-plans/schema.sql`. Requires the full Clinic core schema **014**; the POS billing migration **015** is independent of this feature but should be kept in normal numbered rollout order.

- `ClinicTreatmentPlan`: tenant/client/doctor/location/source encounter, title, total, created actor. FK to existing tenant-scoped clients, employees, locations and clinical encounters.
- `ClinicTreatmentSession`: tenant/plan/session ordinal, nullable BookingID and link metadata. **Does not copy appointment dates or create Booking rows.**
- Index `UX_ClinicTreatmentSession_Tenant_Booking` prevents a booking linking into two sessions across plans in the same tenant, even under simultaneous requests.
- Unique (tenant, source encounter, title) prevents accidental double-post of the same plan, while allowing separate differently titled plans from the same encounter.
- Plan creation inserts its 1..N numbered session rows inside one SQL transaction.

## Server/API
- `GET /api/clinic/treatment-plans?encounterId=<uuid>` returns doctor-owned plans for the patient in the current branch and computes progress from Booking + Encounter joins.
- `POST /api/clinic/treatment-plans` with `{ encounterId,title,totalSessions }` creates a plan only when source encounter is completed.
- `POST /api/clinic/treatment-plans/:planId/sessions/:sessionNumber/booking` with `{ bookingId }` links a previously created Shared Booking.
- All routes require the installed `medical-records` app and logged-in active human clinician (`ClinicPractitioner.UserID`). **Tenant, branch and practitioner are resolved from authenticated context, not input.**
- SQL locking around plan/session and Booking prevents racing links and rejects wrong patient, doctor, branch, invalid terminal booking.
- No DB write can mark a treatment as completed; projection uses `ClinicEncounter.Status='completed'`.

## First-slice limits
- Reassigning a session's BookingID after cancellation/no-show is deliberately blocked for now; the UI flags **needs_rebooking** but does not silently repoint a historical appointment. Next slice can introduce explicit rebooking with audit of old/new booking IDs.
- A created treatment plan cannot yet be amended (title/count), archived or charged as a prepaid package. Those require intentional workflows (not ad hoc SQL changes).
- Session appointments must be created through Shared Booking first, followed by linking booking ID; a future integration can hand back an opaque Booking ID automatically from the Booking app.
- No reminder sending is implemented. FollowUpAt on the original encounter is unaffected.
- The UI surfaces existing plans only to the responsible clinician; reception can still schedule on /bookings but cannot attach clinical plans in this slice.

## QA gate — before any merge or production migration
```bash
npx vitest run \
  src/apps/medical-records/__tests__/treatmentPlanPolicy.test.ts \
  src/apps/medical-records/__tests__/treatmentPlanRepository.test.ts \
  src/apps/medical-records/__tests__/treatmentPlanRoutes.test.ts \
  src/apps/medical-records/__tests__/treatmentPlanPanel.test.tsx \
  src/apps/medical-records/__tests__/encounterWorkspace.test.tsx
npm run build
```

Staging (after migration 016): completed encounter → create 6-session plan → 6 pending session rows; link a Booking for same patient/doctor/branch → appointment counts booked; check-in, begin and complete linked clinical visit → automatically becomes 1/6 completed. Verify wrong tenant, branch, patient, doctor, invalid/cancelled booking, duplicate booking in another session, duplicate plan creation, concurrent linking, mobile; other tenants and Salon unchanged. Test Booking reschedule changes time without changing session link; canceled Booking displays attention.

**Release gate:** PR remains Draft stacked on unmerged parent PR #90. Tests/build/staging not run in the connector environment. No DB migration or production deploy has been performed.

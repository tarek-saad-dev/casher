# Agent 3 — Clinics audit-history slice

## Base / integration
- Branch: `agent/clinics`.
- Stacked on the unmerged Clinics MVP branch `feature/drvo-clinics-mvp` (PR #90). Review this PR against that branch to avoid replaying Clinics MVP and competing migration 014.
- Do not merge/deploy without resolving the parent PR. Retarget after the parent is reviewed and merged.
- No Salon code changes, production operations, new migrations or changes to shared Customer/Booking/POS schemas.

## Ownership and reuse
- Shared Customer `TblClient` remains patient identity; no diagnosis or medical history enters generic CRM.
- Shared Workforce `TblEmp` remains staff identity, but a doctor must additionally have an active `ClinicPractitioner` login link; Salon employees gain no implicit clinical permissions.
- Shared Booking owns scheduling and POS/Treasury own invoices and payments. This slice does not duplicate or change those systems.
- `requireTenantApp('medical-records')` verifies authoritative staff tenant membership, active location, subscription and app installation. `resolveClinicalActorForUser` resolves the clinic-specific human identity.
- The repository repeats the tenant, linked clinician and assignment checks against the database before reading audit history.

## Implemented capability
- `GET /api/clinic/encounters/:encounterId/audit` provides at most 50 latest administrative audit events to the assigned practitioner.
- Response columns: audit id, action, actor user id, timestamp. No clinical content, profile, patient identifiers, medical free text or `MetadataJson`.
- Unknown visit, wrong tenant, unlinked user, non-doctor, inactive doctor, AI actor or unassigned doctor all return a non-disclosing 404.
- Successful read inserts a `ClinicClinicalAudit` `audit-read` event within the same SQL transaction. Audit insert failure rolls back and returns 500; no unlogged success.
- `Cache-Control: private, no-store`. No generic CRM or analytics exposure.

## Agent 1 coordination contract
Confirm the following with the Core owner before merge:
1. `requireTenantApp` continues deriving tenant and membership from the server session, not query/body params, and fails closed for suspended tenants/app entitlements.
2. Practitioner mapping `(TenantId, UserID) -> EmpID` and active assignment stay clinic-owned. Do not infer medical permission from general staff/superadmin roles.
3. A future centralized `medical-records.audit.read` permission may additionally gate this endpoint; never replace the assigned-doctor check with a generic role.
4. Migration 014 belongs to parent PR #90. This branch uses existing tables and claims no migration number.
5. Medical audit rows must be excluded from shared analytics exports and staff-wide CRM reads.

## Verification
- `node --experimental-strip-types` isolated policy assertions: 11 passed locally.
- Added Vitest route and repository coverage for tenant and practitioner scoping, fail-closed errors, atomic audit logging, privacy and entitlement gating.
- Full repo/Next build requires GitHub CI (local full git checkout and dependencies are not available in this execution environment).

## Future Clinics Pack slices
- Practitioner specialization catalog and audited access delegation governed by Agent 1 permissions.
- Booking-to-encounter handoff and no-double-billing POS integration.
- Treatment sessions, follow-up workflow, reminders and prescription printing.
- Concurrency/race tests on a dedicated staging database after schema migration review.

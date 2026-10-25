# DRVO ERP — five-agent QA integration matrix

Owner: Agent 5 (QA & Integration). Base: `main`. Validation: isolated fixtures first, `last132_agent` staging second. **Never run mutation smokes against production `last132`.** Agents do not merge.

## Risk-based matrix

| ID | Priority | Area / owner | Scenario and expected invariant | Gate | Evidence / coverage |
| --- | --- | --- | --- | --- | --- |
| CORE-01 | P0 | Core + QA | A staff user with tenant A membership cannot list, read, create, update or delete tenant B rows, including using known object IDs or B's branch ID; deny with non-disclosing 403/404 | PR unit + staging A/B fixtures | Existing `drvo013TenantIsolation`; add endpoint CRUD integration cases for each shared resource |
| CORE-02 | P0 | Core + QA | All staff mutations enforce permissions on the server; direct API calls, forbidden role, missing tenant claim and branch-switching attempts fail | PR route guard + staging role matrix | `drvo013RouteAuthGuards`; RBAC endpoint execution pending |
| CORE-03 | P0 | Core + SaaS + QA | Disabled/missing app cannot be used via primary or alias routes; direct app gate rejects; entitlements do not cross tenant cache boundaries | PR unit | `qaCrossTenantEntitlement` and `drvo013TenantJobsAndGates` |
| CORE-04 | P0 | Core + QA | A public booking/customer identifier resolves to exactly one authoritative tenant; arbitrary supplied tenantId never grants access | PR unit + staging | Existing `drvo013TenantIsolation`; public endpoint E2E pending |
| SALON-01 | P0 | Salon + QA | CUT booking: availability, hold, create, cancellation, reschedule, branch transfer; same staff/slot cannot double-book | PR unit + staging Cut Salon regression | Existing booking-path/hold tests in CI; runtime staging smoke pending |
| SALON-02 | P0 | Salon + QA | CUT POS invoice add/edit/refund, split payment, daily close and partner/treasury totals; an aborted SQL transaction leaves no invoice, payment, cash move or partial ledger | PR unit + staging rollback fault injection | Existing POS Treasury tests; complete fault-injection smoke pending |
| SALON-03 | P1 | Salon + QA | CUT two branches: queue ticket, staff roster, payroll, daily report and last closed day preserve legacy behavior, never cross-post between branches | PR unit + staging fixture | HR/payroll branch and shift-close staging verification pending |
| CLINIC-01 | P0 | Clinics + QA | Tenant A patient chart, encounters, prescription and medical audit are invisible to tenant B, including via direct IDs | Clinic PR unit + staging A/B fixtures | Clinic PR #90 draft; integration execution pending |
| CLINIC-02 | P0 | Clinics + Core + QA | Non-doctor/non-assigned staff cannot sign, diagnose, complete encounters; redacted payload contains no medical record fields | Clinic PR unit + staging role matrix | Clinic PR #90 draft; negative-role integration pending |
| CLINIC-03 | P0 | Clinics + QA | Shared customers/search/exports and generic APIs must not serialize medical history, diagnosis, allergies, meds, notes or prescriptions | Contract test + staging response snapshots | No end-to-end proof yet; release blocker |
| CLINIC-04 | P1 | Clinics + Salon + QA | Appointment -> encounter -> billing handoff maintains tenant/branch/doctor/patient binding and avoids duplicate payment | Staging transactional integration | Automated handoff not in #90's stated scope; keep excluded until implemented |
| SAAS-01 | P0 | SaaS + Core + QA | Signup provisions precisely one tenant, admin membership, branch, subscription, pack and entitlements; retry is idempotent and failures roll back | PR unit + staging A/B provisioning | Existing DRVO-011/012 smoke scripts; staging execution pending |
| SAAS-02 | P0 | SaaS + QA | Disabled/expired subscriptions block server access. Plan change, app disable/re-enable and invalidation are tenant-scoped, consistent across requests | PR unit + staging | Existing `drvo012Services` and access tests; full E2E pending |
| DB-01 | P0 | Core + Clinics + SaaS + QA | Migration manifest has unique immutable IDs/checksums, depends on prior migrations, applies to clean staging and safely reruns; no data loss or orphan ledger | PR unit + staging migration runner | Existing `migrationManifest` and `migrationRunner`; staging replay pending |
| API-01 | P0 | All agents + QA | Every endpoint declares method, auth, tenant, app, role, schemas, error contract; no unguarded alternate paths | PR route inventory + contract integration | `drvo013RouteAuthGuards` now required in CI; per-vertical contract snapshots pending |
| CI-01 | P0 | QA | Every PR runs deterministic tenant isolation, API-family entitlement, master data and outbox rollback tests before merge | GitHub pull_request CI | This branch extends `.github/workflows/ci.yml`; workflow evidence required |

## Shared fixtures and execution rules

Use **two synthetic tenants** A and B, each with distinct users, role grants, branches, customers, employees, resources, app entitlements and subscriptions. Create a third tenant with a disabled app/expired subscription. Never use a real patient, CUT customer or production financial record. For staging, all mutations must use `last132_agent`, staging-only credentials and idempotent namespaced fixtures; verify cleanup of test-owned rows.

For each mutating API, first establish an authorized successful operation within A. Replay it as unauthorized B user, A user referencing B resource ID, read-only A user and disabled-app A user. Validate HTTP response **and** unchanged database state. Include GET/list/export and background jobs, not only POST.

For every DB migration: review forward SQL and metadata/checksum, run against throwaway database, rerun without duplicates, verify persisted historical data and execute a documented rollback/restore procedure where applicable. A successful dry-run is not proof of real transaction rollback.

## Gate ownership and release policy

- **Core:** typed shared context, authorization, isolation, transaction and migration contracts.
- **Salon:** preserve CUT booking/queue/POS/treasury/payroll behavior under feature rollout.
- **Clinics:** strictly separate medical records from shared customers; practitioner-only clinical mutations.
- **SaaS Platform:** provision tenants safely, enforce subscriptions and per-tenant enabled apps.
- **QA:** maintain PR CI, cross-agent contract tests, staging smoke evidence and independent reviews.

A release is **BLOCKED** for missing P0 proof, failed or absent CI, unsafe/unreviewed migrations, unexplained financial deltas, exposed medical information, or missing staging cleanup. `main` merges deploy to production; only a human may merge, and the QA branch never deploys.

## Initial repository baseline (2026-10-25)

- CI currently selects DRVO migration, rollout, booking, queue, treasury, POS and selected messaging suites. This QA PR adds an explicit tenant/security CI step and one new entitlement regression suite.
- Staging gate `.github/workflows/drvo-staging-gate.yml` is branch-restricted to `drvo-012-commercial-plans-tenant-apps`; it is **not** a general check for new agents. Staging migration checks for new agent branches require a separate, approved safe workflow.
- PR #90 (Clinics MVP) is a draft with migration 014 and unverified clinical integration; PR #89 (clinic pack) also proposes migration 14. Reconcile sequencing and SQL immutability before either is merged.
- PR #93 explicitly states public Loyalty customer identity is not yet authenticated/tenant scoped; keep blocked.
- Existing static route guard scans the route tree; static reachability is necessary but not equivalent to runtime RBAC and API contract proof.

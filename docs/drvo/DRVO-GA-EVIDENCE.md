# DRVO GA evidence ledger

This is the single place where the final GA gate (DRVO-020 phase 2) records proof. Each row needs an artifact before GA: a command output, CI run URL, screenshot, or SQL result saved under `docs/drvo/evidence/<date>/`. Unit-test coverage is listed so reviewers can see what is already proven in code and what still needs staging proof.

Stack under test (bottom to top):

| PR | Ticket | Notes |
|---|---|---|
| #63 | DRVO-012 | migration 9 |
| #66 | DRVO-013 | |
| #68 | DRVO-015 | migration 10 |
| #65 | DRVO-017 | migration 11 |
| #67 | DRVO-018 | migration 12 |
| | DRVO-016 | |
| | DRVO-019 | |
| #72 | DRVO-020 phase 1 | |

Status values: `PENDING_CREDENTIALS` (blocked on staging DB/VPS access), `PENDING`, `PASS`, `FAIL`.
Environment: staging DB `last132_agent` only. Production (`last132`) is touched only by the migration **PLAN** in row 20.

| # | Gate | How it is proven on staging | Code-level coverage (already green) | Status | Evidence |
|---|---|---|---|---|---|
| 1 | Fresh tenant provisioning | `npm run drvo-011:smoke`, `npx tsx scripts/drvo/drvo-017-onboarding-smoke.ts` (operator creates a non-salon tenant with brand, first branch, owner) | `tenantOnboarding.test.ts`, `drvo017*.test.ts` | PENDING_CREDENTIALS | |
| 2 | Owner login | the DRVO-017 onboarding smoke owner login path; manual login on staging UI | `phase1bLoginBranch.test.ts`, `drvo020GaHardening.test.ts` | PENDING_CREDENTIALS | |
| 3 | Password stored hashed | After rows 1–2: `SELECT LEFT(Password,3) FROM TblUser WHERE loginName=@owner` = `s1$`. Log in as a legacy plaintext CUT test user, confirm the row becomes `s1$…`, then log in again | `drvo020GaHardening.test.ts` (hash format ≤ 50 chars, upgrade, no password in logs, write paths hash) | PENDING_CREDENTIALS | |
| 4 | Tenant branding | the DRVO-017 onboarding smoke brand assertions; screenshot of tenant shell + `/book/[branchCode]` header | `drvo017*.test.ts`, `drvo019*.test.ts` | PENDING_CREDENTIALS | |
| 5 | App install / uninstall | `drvo-012:smoke` app install/uninstall; booking uninstalled → `/book/[code]` and `/api/public/booking/*` return 404 | `drvo012*.test.ts`, `drvo013TenantJobsAndGates.test.ts`, `drvo019*.test.ts` | PENDING_CREDENTIALS | |
| 6 | Subscription suspend / reactivate | `drvo-012:smoke` + the DRVO-017 onboarding smoke (suspend blocks staff routes, reactivate restores) | `drvo012Services.test.ts`, `drvo013*` gate tests | PENDING_CREDENTIALS | |
| 7 | Branch / user limits | `drvo-012:smoke`, the DRVO-017 onboarding smoke (user limit enforced) | `drvo012Services.test.ts` | PENDING_CREDENTIALS | |
| 8 | Two-tenant isolation (staff routes) | `npm run drvo-013:smoke` | `drvo013TenantIsolation.test.ts`, `drvo013CrossTenantRoutes.test.ts`, `drvo013RouteAuthGuards.test.ts` | PENDING_CREDENTIALS | |
| 9 | Customers / catalog isolation | `npm run drvo-015:smoke`, `npm run drvo-015:verify` | `drvo015*.test.ts` | PENDING_CREDENTIALS | |
| 10 | HR / attendance / payroll isolation | `npm run drvo-016:smoke` (synthetic tenant: employee → attendance → daily payroll → ledger payout; cannot see CUT employees) | `drvo016*.test.ts` | PENDING_CREDENTIALS | |
| 11 | Messaging / WhatsApp / AI isolation | Bind a channel per tenant with `npm run drvo-018:bind-channel`. Send a webhook to each tenant's endpoint with the other tenant's token → 401. Check outbox/inbox/AI turn rows carry the right `TenantId`, and the AI config/knowledge of tenant B is never used for tenant A | `drvo018TwoTenantIsolation.test.ts`, `drvo018StaticGuards.test.ts` | PENDING_CREDENTIALS | |
| 12 | Public booking isolation | `npm run drvo-019:smoke` (tenant B cannot see A's services/staff/availability/upcoming-by-phone, and cannot book into A's branch) | `drvo019*.test.ts` | PENDING_CREDENTIALS | |
| 13 | Salon tenant full flow | Manual script on staging, with screenshots for each step: provision salon tenant → branch → services → employee → attendance → POS sale → booking via `/book/[code]` → daily payroll → closing | covered piecewise by rows 1–12 | PENDING_CREDENTIALS | |
| 14 | Non-salon tenant flow | Manual: provision non-salon tenant (no booking app) → POS sale with own catalog → HR/payroll → messaging. `/book/[code]` returns 404 | `drvo017*`, `drvo019*` (booking optional) | PENDING_CREDENTIALS | |
| 15 | No CUT fallback in generic paths | Static guards (CASHER_BOOT reachable only through named seams); on staging, a generic-tenant request without `branchCode` to public booking returns 400/404, never CUT data | `drvo013StaticGuards.test.ts` (pinned seam callers), `drvo018StaticGuards.test.ts`, `drvo016StaticGuards.test.ts`, `drvo019StaticGuards.test.ts` | PENDING_CREDENTIALS | |
| 16 | Health ready / live | `curl -fsS https://<staging>/api/health/live`; `/api/health/ready` returns 200, and 503 with SQL stopped | `drvo020GaHardening.test.ts` | PENDING_CREDENTIALS | |
| 17 | Backup + restore drill | `npm run drvo:backup -- --backup-dir=… --execute` on `last132_agent`, then restore drill into `last132_agent_restore_check` + `drvo:verify` (runbook: `DRVO-020-BACKUP-RESTORE-RUNBOOK.md`) | `drvo020GaHardening.test.ts` (planner guards) | PENDING_CREDENTIALS | |
| 18 | CUT regression | On a staging copy of CUT data: login, POS sale, booking on cutsaloon flow, nightly close, HR WhatsApp report (CASHER_BOOT-only seam), messaging send through the CUT channel. Totals must match pre-migration snapshot | existing booking/POS/HR suites; pre-existing failures tracked separately | PENDING_CREDENTIALS | |
| 19 | Migration 9–12 staging proof | `drvo-staging-gate.yml` / `npm run drvo:migrate -- --expected-database=last132_agent` then `npm run drvo:verify`. Recorded checksums must match the table below | `migrationManifest.test.ts`, `checksumPortability.test.ts` | PENDING_CREDENTIALS | |
| 20 | Production migration PLAN only | DRVO Production Migration Control with action `PLAN` (never `APPLY` in this gate). Attach the PLAN output and manifest digest | `production-migration-control` tests | PENDING (operator) | |

## Migration manifest (must not change)

| id | key | checksum (sha256, LF-canonical) |
|---|---|---|
| 9 | commercial-subscription-tenant-apps | `a711f08b6e4ff2954611145120ed6d26634e55d0c67a9ecbc35bc3b792f96427` |
| 10 | master-data-tenancy | `228bfbad49e6101fc3ea04998751d784921ad0d32c5242b9754d3fc059adb428` |
| 11 | tenant-brand-profile | `0ee043c4260234d091457160dfc50953ee88f5da9eee4967162d4e25192210f1` |
| 12 | messaging-tenancy | `bd2f33c78aeca03fa96a391c26ab14ed8e376da07ef0378012f69a404958c98e` |

DRVO-013, DRVO-016, DRVO-019 and DRVO-020 phase 1 add no migrations.

## Sign-off

GA requires every row to be `PASS` with an artifact, except row 20, which only needs a PLAN. Then two approvals are recorded here: engineering and the operator (tarek-saad-dev).

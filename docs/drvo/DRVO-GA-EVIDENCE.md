# DRVO GA evidence ledger

This is the single place where the final GA gate (DRVO-020 phase 2) records proof. Each staging or production row needs an artifact before GA: a command output, CI run URL, screenshot, or SQL result saved under `docs/drvo/evidence/<date>/`.

Status values (only these):

| Status | Meaning |
|---|---|
| `CODE_PROVEN` | Proven by code and tests at the top of the stack; no environment needed. |
| `STAGING_PENDING` | Needs a run on staging (`last132_agent`); blocked until staging credentials exist. |
| `PRODUCTION_PENDING` | Needs an operator action against production after GA approval. |
| `DEFERRED_V1` | Known gap, accepted for GA and scheduled after v1. |

## Stack under test (bottom to top)

| PR | Ticket | Branch | Base | Migration |
|---|---|---|---|---|
| #63 | DRVO-012 | `drvo-012-commercial-plans-tenant-apps` | `main` | 9 |
| #66 | DRVO-013 | `drvo-013-authoritative-tenant-context` | DRVO-012 | |
| #68 | DRVO-015 | `drvo-015-master-data-tenancy` | DRVO-013 | 10 |
| #65 | DRVO-017 | `drvo-017-onboarding-console-tenant-shell` | DRVO-015 | 11 |
| #67 | DRVO-018 | `drvo-018-messaging-tenancy` | DRVO-017 | 12 |
| #74 | DRVO-016 | `drvo-016-hr-payroll-tenancy` | DRVO-018 | |
| #73 | DRVO-019 | `drvo-019-public-booking-tenancy` | DRVO-016 | |
| #72 | DRVO-020 | `drvo-020-ga-hardening` | DRVO-019 | |

#64 (DRVO-014) is docs-only and stays outside the stack. Every runtime PR stays draft until the GA decision.

Environment: staging DB `last132_agent` only. Production (`last132`) is touched only by the PLAN in row 20 and by the operator cutover in the runbook.

## Code proof at the top of the stack

Targeted run on `drvo-020-ga-hardening`: 320 test files covering tenancy, onboarding, login, subscription and apps, master data, HR and payroll, messaging, booking, health and backup. 2702 tests pass and 74 fail. All 74 failures fail identically on `drvo-019-public-booking-tenancy` (`6d77a37`), so DRVO-020 introduces none. They are older booking-live, HR panel, target and ledger dual-write tests, tracked separately. `npm run build` passes.

| Area | Proving tests | Status |
|---|---|---|
| Tenant context, route guards, subscription and app gates (DRVO-013) | `drvo013*.test.ts` (85 pass) | CODE_PROVEN |
| Master-data isolation and provisioning seed (DRVO-015) | `drvo015*.test.ts` (50 pass) | CODE_PROVEN |
| Onboarding, owner role, branding, subscription UX (DRVO-017) | `drvo017*.test.ts` (38 pass) | CODE_PROVEN |
| Messaging, AI, channel and worker tenancy (DRVO-018) | `drvo018*.test.ts` (38 pass) | CODE_PROVEN |
| Employees, attendance, payroll, ledger tenancy (DRVO-016) | `drvo016*.test.ts` (25 pass) | CODE_PROVEN |
| Public tenant resolution and hosted booking (DRVO-019) | `drvo019*.test.ts` (27 pass) | CODE_PROVEN |
| Password hashing, legacy upgrade, logs, error hook, health, backup planner, deploy guard (DRVO-020) | `drvo020GaHardening.test.ts` (26 pass), `phase1bLoginBranch.test.ts` (6 pass) | CODE_PROVEN |
| Migration manifest 1–12, no duplicate ids, checksums below | `migrationManifest.test.ts`, `checksumPortability.test.ts` | CODE_PROVEN |

## GA gates

| # | Gate | How it is proven | Code-level coverage | Status | Evidence |
|---|---|---|---|---|---|
| 1 | Fresh tenant provisioning | `npm run drvo-011:smoke`, `npx tsx scripts/drvo/drvo-017-onboarding-smoke.ts` (operator creates a non-salon tenant with brand, first branch, owner) | `tenantOnboarding.test.ts`, `drvo017*.test.ts` | STAGING_PENDING | |
| 2 | Owner login | DRVO-017 onboarding smoke owner login; manual login on staging UI | `phase1bLoginBranch.test.ts`, `drvo020GaHardening.test.ts` | STAGING_PENDING | |
| 3 | Password stored hashed | After rows 1–2: `SELECT LEFT(Password,3) FROM TblUser WHERE loginName=@owner` = `s1$`. Log in as a legacy plaintext test user, confirm the row becomes `s1$…`, log in again | `drvo020GaHardening.test.ts` | STAGING_PENDING | |
| 4 | Tenant branding | DRVO-017 onboarding smoke brand assertions; screenshot of tenant shell and `/book/[branchCode]` header | `drvo017*.test.ts`, `drvo019*.test.ts` | STAGING_PENDING | |
| 5 | Apps install / uninstall | `drvo-012:smoke`; booking uninstalled → `/book/[code]` and `/api/public/booking/*` return 404 | `drvo012*.test.ts`, `drvo013TenantJobsAndGates.test.ts`, `drvo019*.test.ts` | STAGING_PENDING | |
| 6 | Subscription state (suspend / reactivate) | `drvo-012:smoke` and the DRVO-017 onboarding smoke | `drvo012Services.test.ts`, `drvo013*` gate tests | STAGING_PENDING | |
| 7 | Branch / user limits | `drvo-012:smoke`, DRVO-017 onboarding smoke | `drvo012Services.test.ts` | STAGING_PENDING | |
| 8 | Two-tenant isolation (staff routes) | `npm run drvo-013:smoke` | `drvo013TenantIsolation.test.ts`, `drvo013CrossTenantRoutes.test.ts`, `drvo013RouteAuthGuards.test.ts` | STAGING_PENDING | |
| 9 | Master data isolation | `npm run drvo-015:smoke`, `npm run drvo-015:verify` | `drvo015*.test.ts` | STAGING_PENDING | |
| 10 | HR / payroll isolation | `npm run drvo-016:smoke` (synthetic tenant: employee → attendance → daily payroll → ledger payout; cannot see CUT employees) | `drvo016*.test.ts` | STAGING_PENDING | |
| 11 | Messaging / WhatsApp / AI isolation | Bind a channel per tenant with `npm run drvo-018:bind-channel`; cross-tenant webhook token → 401; outbox, inbox and AI turn rows carry the right `TenantId`; tenant B's AI config is never used for tenant A | `drvo018TwoTenantIsolation.test.ts`, `drvo018StaticGuards.test.ts` | STAGING_PENDING | |
| 12 | Public booking isolation | `npm run drvo-019:smoke` (tenant B cannot see or book into A) | `drvo019*.test.ts` | STAGING_PENDING | |
| 13 | Salon tenant flow | Manual with screenshots: provision salon tenant → branch → services → employee → attendance → POS sale → `/book/[code]` booking → daily payroll → closing | rows 1–12 piecewise | STAGING_PENDING | |
| 14 | Non-salon tenant flow | Manual: provision non-salon tenant (no booking app) → POS sale with own catalog → HR/payroll → messaging; `/book/[code]` returns 404 | `drvo017*`, `drvo019*` | STAGING_PENDING | |
| 15 | No generic CUT fallback | Generic public booking without `branchCode` → 400/404; tenant B session against CUT ids → 4xx | `drvo013StaticGuards.test.ts` (pinned seams), `drvo016/018/019StaticGuards.test.ts` | STAGING_PENDING | |
| 16 | Health live / ready | `curl -fsS https://<staging>/api/health/live`; `/api/health/ready` returns 200, and 503 with SQL stopped | `drvo020GaHardening.test.ts` | STAGING_PENDING | |
| 17 | Backup + restore drill | `npm run drvo:backup -- --backup-dir=… --execute` on `last132_agent`, restore into `last132_agent_restore_check`, `drvo:verify` (see `DRVO-020-BACKUP-RESTORE-RUNBOOK.md`) | `drvo020GaHardening.test.ts` (planner guards) | STAGING_PENDING | |
| 18 | CUT regression | Staging copy of CUT data: login (legacy password upgrades), POS sale, cutsaloon booking, nightly close, HR WhatsApp report (CASHER_BOOT-only seam), send through the CUT channel; totals match the pre-migration snapshot | existing booking/POS/HR suites | STAGING_PENDING | |
| 19 | Migrations 9–12 on staging | `drvo-staging-gate.yml` or `npm run drvo:migrate -- --expected-database=last132_agent`, then `npm run drvo:verify`; checksums match the table below | `migrationManifest.test.ts`, `checksumPortability.test.ts` | STAGING_PENDING | |
| 20 | Production migration PLAN | DRVO Production Migration Control, action `PLAN` only; attach the PLAN output and manifest digest | `production-migration-control` tests | PRODUCTION_PENDING | |
| 21 | Zero synthetic residue | After all smokes: no `Tenant` rows with smoke codes, no synthetic users, branches, employees, channels or bookings left on `last132_agent` | each smoke's cleanup step | STAGING_PENDING | |

The `drvo-staging-gate` check currently fails on every PR with exit code 11 ("required staging secret missing"). It turns green only once `DRVO_STAGING_SSH_HOST`, `DRVO_STAGING_SSH_KEY` and `DRVO_STAGING_DB_PASSWORD` are configured. Production credentials must never be used to satisfy it.

## Accepted gaps (v1)

| Gap | Status |
|---|---|
| Daily HR WhatsApp reports run only for CASHER_BOOT (named seam `legacy-global-data`); other tenants close payroll without them | DEFERRED_V1 |
| Quick-queue service id comes from config (CASHER_BOOT default), not per tenant | DEFERRED_V1 |
| `cashMoveClassificationAudit` loads employee aliases across tenants (accounting is out of scope) | DEFERRED_V1 |
| `captureException` has a pluggable reporter but no external vendor wired | DEFERRED_V1 |

## Migration manifest (must not change)

| id | key | checksum (sha256, LF-canonical) |
|---|---|---|
| 9 | commercial-subscription-tenant-apps | `a711f08b6e4ff2954611145120ed6d26634e55d0c67a9ecbc35bc3b792f96427` |
| 10 | master-data-tenancy | `228bfbad49e6101fc3ea04998751d784921ad0d32c5242b9754d3fc059adb428` |
| 11 | tenant-brand-profile | `0ee043c4260234d091457160dfc50953ee88f5da9eee4967162d4e25192210f1` |
| 12 | messaging-tenancy | `bd2f33c78aeca03fa96a391c26ab14ed8e376da07ef0378012f69a404958c98e` |

The manifest holds ids 1–12 with no duplicates. DRVO-013, DRVO-016, DRVO-019 and DRVO-020 add no migrations.

## Sign-off

GA requires every `STAGING_PENDING` row to have an attached artifact showing it passed, and row 20 to have a PLAN. Then two approvals are recorded here: engineering and the operator (tarek-saad-dev).

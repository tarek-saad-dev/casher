# DRVO GA evidence ledger

This is the single place where the final GA gate (DRVO-020 phase 2) records proof. Each staging or production row needs an artifact before GA: a command output, CI run URL, screenshot, or SQL result saved under `docs/drvo/evidence/<date>/`.

Status values (only these):

| Status | Meaning |
|---|---|
| `CODE_PROVEN` | Proven by code and tests at the top of the stack; no environment needed. |
| `STAGING_PENDING` | Needs a run on staging (`last132_agent`); blocked until staging credentials exist. |
| `STAGING_PROVEN` | Passed on staging; artifact under `docs/drvo/evidence/`. |
| `STAGING_PARTIAL` | Passed on staging except the named step, which is blocked outside DRVO code. |
| `OPERATOR_PENDING` | Needs an operator with rights the DRVO staging login does not have. |
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

## Staging run 2026-10-09

Run manually through the dedicated `drvo-tunnel` (127.0.0.1:14330 → staging SQL), not through CI. Artifacts: `docs/drvo/evidence/2026-10-09/`.

- **Code under test:** `drvo-020-ga-hardening` @ `22b49c2` (the `next start` build is from `3159cf3`, which has an identical `src/` tree). Smoke scripts were patched in the commit that adds this section.
- **Identity, checked before every mutating step:** `DB_NAME()` = `last132_agent`, `SUSER_SNAME()` = `drvo_agent`, `HAS_DBACCESS('last132')` = 0, server `srv1921542`. Production `last132` was never connected to.
- **Backup:** `last132_agent_20261009T005918Z.bak`, 148,331,520 bytes, `COPY_ONLY, CHECKSUM`, finished 03:59:19 (msdb history). `RESTORE VERIFYONLY` and the restore drill need `CREATE DATABASE`, which `drvo_agent` correctly lacks. They are row 17's operator step.
- **Migrations:** `drvo:migrate --expected-database=last132_agent` applied 9–12 (1–8 already present). `DrvoSchemaMigration` has 12 rows, 12 distinct; rows 9–12 carry exactly the checksums below, with `AppCommitSha` = `22b49c2`.
- **Smokes, in dependency order:** all eight passed.

  | Smoke | Result |
  |---|---|
  | 011 | PASS |
  | 012 | PASS |
  | 013 | PASS |
  | 015 | PASS |
  | 015 verify | PASS |
  | 017 | PASS |
  | 016 | PASS |
  | 019 | PASS |

- **End-to-end proof:** `tmp/drvoga-proof.ts`, not committed; its log is `ga-proof.log`. It ran against `next start` on the staging DB, using a fresh salon tenant `DRVOGA_A_SALON` and a fresh supermarket tenant `DRVOGA_B_MARKET`. Result: 60 checks, 59 pass. The single failure is the purchase posting on the non-salon tenant; see finding F1.
- **Cleanup:** every smoke purges its own tenants, and the proof purges `DRVO%`. The final residue is 0 tenants, 0 `drvo%` users and 0 `DRVO%` branches or locations. CASHER_BOOT counts were the same before and after: clients 3113, pros 73, emps 177, members 11, locations 3.
- **Final `drvo:verify`:** PASS (`platform.core.structure`, `platform.bootstrap`, `platform.master-data`), `failures: []`.
- **Rerun after the F1 legacy migration on staging:**
  - GA proof: 60 checks, 59 pass. The purchase now fails on F6 instead of F1.
  - Cleanup: 0 `DRVO%` tenants, users or branches; 0 purchase heads; 1 tenant (CASHER_BOOT); CASHER_BOOT counts unchanged.
  - `drvo:verify`: PASS, `failures: []`.

## GA gates

| # | Gate | How it is proven | Code-level coverage | Status | Evidence |
|---|---|---|---|---|---|
| 1 | Fresh tenant provisioning | `npm run drvo-011:smoke`, `npx tsx scripts/drvo/drvo-017-onboarding-smoke.ts` (operator creates a non-salon tenant with brand, first branch, owner) | `tenantOnboarding.test.ts`, `drvo017*.test.ts` | STAGING_PROVEN | smoke-011, smoke-017; ga-proof: pack required, readiness PASS, owner admin, pack apps, subscription, brand, master-data seed, first branch `INTERNAL_LIVE` with owner default access |
| 2 | Owner login | DRVO-017 onboarding smoke owner login; manual login on staging UI | `phase1bLoginBranch.test.ts`, `drvo020GaHardening.test.ts` | STAGING_PROVEN | ga-proof: both owners log in over HTTP into their own branch; wrong password → 401 |
| 3 | Password stored hashed | After rows 1–2: `SELECT LEFT(Password,3) FROM TblUser WHERE loginName=@owner` = `s1$`. Log in as a legacy plaintext test user, confirm the row becomes `s1$…`, log in again | `drvo020GaHardening.test.ts` | STAGING_PROVEN | ga-proof: owners stored `s1$` (len 47); legacy plaintext → login 200 → row `s1$` → login 200; smoke-017 verifies the hash |
| 4 | Tenant branding | DRVO-017 onboarding smoke brand assertions; screenshot of tenant shell and `/book/[branchCode]` header | `drvo017*.test.ts`, `drvo019*.test.ts` | STAGING_PROVEN | ga-proof: `TenantBrandProfile` row per tenant; `/book/DRVOGA_A_BR` HTML carries tenant A's display name (asserted on the HTML; no screenshot taken) |
| 5 | Apps install / uninstall | `drvo-012:smoke`; booking uninstalled → `/book/[code]` and `/api/public/booking/*` return 404 | `drvo012*.test.ts`, `drvo013TenantJobsAndGates.test.ts`, `drvo019*.test.ts` | STAGING_PROVEN | smoke-012; ga-proof: salon pack refuses to uninstall required `booking`; supermarket installs `booking` → `/book` works → uninstall → blocked (see F3) |
| 6 | Subscription state (suspend / reactivate) | `drvo-012:smoke` and the DRVO-017 onboarding smoke | `drvo012Services.test.ts`, `drvo013*` gate tests | STAGING_PROVEN | ga-proof: suspend → staff route 403 and `/book` blocked; reactivate → both restored; past_due keeps staff access (grace) |
| 7 | Branch / user limits | `drvo-012:smoke`, DRVO-017 onboarding smoke | `drvo012Services.test.ts` | STAGING_PROVEN | smoke-012 |
| 8 | Two-tenant isolation (staff routes) | `npm run drvo-013:smoke` | `drvo013TenantIsolation.test.ts`, `drvo013CrossTenantRoutes.test.ts`, `drvo013RouteAuthGuards.test.ts` | STAGING_PROVEN | smoke-013; ga-proof over HTTP: B cannot list or edit A's customer (404, row unchanged), service (404) or employee; A cannot sell B's service (404); no CUT employee in B's list |
| 9 | Master data isolation | `npm run drvo-015:smoke`, `npm run drvo-015:verify` | `drvo015*.test.ts` | STAGING_PROVEN | smoke-015, smoke-015v |
| 10 | HR / payroll isolation | `npm run drvo-016:smoke` (synthetic tenant: employee → attendance → daily payroll → ledger payout; cannot see CUT employees) | `drvo016*.test.ts` | STAGING_PROVEN | smoke-016 |
| 11 | Messaging / WhatsApp / AI isolation | Bind a channel per tenant with `npm run drvo-018:bind-channel`; cross-tenant webhook token → 401; outbox, inbox and AI turn rows carry the right `TenantId`; tenant B's AI config is never used for tenant A | `drvo018TwoTenantIsolation.test.ts`, `drvo018StaticGuards.test.ts` | STAGING_PROVEN | ga-proof using the fake transport only (no real WhatsApp):<br>• token → own tenant; unknown token → null<br>• outbound goes to each tenant's own endpoint<br>• a send without tenant scope throws<br>• usage metered A=1, B=1<br>• no CUT persona on the new tenants; CUT keeps the salon concierge<br>• the inbound webhook lands in the token owner's inbox; an unknown or missing token → 401 |
| 12 | Public booking isolation | `npm run drvo-019:smoke` (tenant B cannot see or book into A) | `drvo019*.test.ts` | STAGING_PROVEN | smoke-019; ga-proof: `/api/public/booking/services` for B → 404 `BRANCH_NOT_FOUND`; A resolves to its own tenant (409 `SERVICES_NOT_CONFIGURED`, no CUT services) |
| 13 | Salon tenant flow | Manual with screenshots: provision salon tenant → branch → services → employee → attendance → POS sale → `/book/[code]` booking → daily payroll → closing | rows 1–12 piecewise | STAGING_PROVEN | ga-proof over HTTP: category, service, customer and employee created; branch assignment; day and shift open; walk-in queue ticket A1; POS cash sale; treasury; `/book` branded. Payroll is covered by smoke-016. Not run: a public booking created by a customer, and screenshots |
| 14 | Non-salon tenant flow | Manual: provision non-salon tenant (no booking app) → POS sale with own catalog → HR/payroll → messaging; `/book/[code]` returns 404 | `drvo017*`, `drvo019*` | STAGING_PARTIAL | ga-proof: own catalog, day and shift, POS cash sale, treasury, messaging, no booking. Purchase post still fails after the F1 migration, now with `Cannot insert the value NULL into column 'ClientID'`; see F6 |
| 15 | No generic CUT fallback | Generic public booking without `branchCode` → 400/404; tenant B session against CUT ids → 4xx | `drvo013StaticGuards.test.ts` (pinned seams), `drvo016/018/019StaticGuards.test.ts` | STAGING_PROVEN | smoke-019, scenarios 2–3 (cut-compat is bound to the origin; the salon origin without `branchCode` is refused; a salon branch under the CUT tenant gives `BRANCH_NOT_FOUND`) |
| 16 | Health live / ready | `curl -fsS https://<staging>/api/health/live`; `/api/health/ready` returns 200, and 503 with SQL stopped | `drvo020GaHardening.test.ts` | STAGING_PROVEN | live 200; ready 200 (database, sessionSecret). Ready returned 503 while the DB tunnel was down; SQL Server itself was not stopped |
| 17 | Backup + restore drill | `npm run drvo:backup -- --backup-dir=… --execute` on `last132_agent`, restore into `last132_agent_restore_check`, `drvo:verify` (see `DRVO-020-BACKUP-RESTORE-RUNBOOK.md`) | `drvo020GaHardening.test.ts` (planner guards) | OPERATOR_PENDING | Backup written with checksums (see run summary). An operator with `dbcreator` must run `RESTORE VERIFYONLY`, restore into `last132_agent_restore_check`, run `drvo:verify` on it, then drop it |
| 18 | CUT regression | Staging copy of CUT data: login (legacy password upgrades), POS sale, cutsaloon booking, nightly close, HR WhatsApp report (CASHER_BOOT-only seam), send through the CUT channel; totals match the pre-migration snapshot | existing booking/POS/HR suites | STAGING_PARTIAL | `drvo:verify` bootstrap clean; CASHER_BOOT counts unchanged across all runs; CUT catalogue (38 services) and barbers (6) still resolve (smoke-019); CUT keeps the salon AI pack. The manual CUT walk-through (login, sale, booking, nightly close, HR report) is still owed by the operator |
| 19 | Migrations 9–12 on staging | `drvo-staging-gate.yml` or `npm run drvo:migrate -- --expected-database=last132_agent`, then `npm run drvo:verify`; checksums match the table below | `migrationManifest.test.ts`, `checksumPortability.test.ts` | STAGING_PROVEN | `DrvoSchemaMigration` rows 9–12 = manifest checksums, `AppCommitSha` `22b49c2`; final-drvo-verify |
| 20 | Production migration PLAN | DRVO Production Migration Control, action `PLAN` only; attach the PLAN output and manifest digest | `production-migration-control` tests | PRODUCTION_PENDING | |
| 21 | Zero synthetic residue | After all smokes: no `Tenant` rows with smoke codes, no synthetic users, branches, employees, channels or bookings left on `last132_agent` | each smoke's cleanup step | STAGING_PROVEN | ga-proof cleanup and the final query: 0 `DRVO%` tenants, users, branches and locations; 1 tenant left (CASHER_BOOT) |

The `drvo-staging-gate` check currently fails on every PR with exit code 11 ("required staging secret missing"). It turns green only once `DRVO_STAGING_SSH_HOST`, `DRVO_STAGING_SSH_KEY` and `DRVO_STAGING_DB_PASSWORD` are configured. Production credentials must never be used to satisfy it. The 2026-10-09 run above was manual and does not change that check.

## Findings from the staging run

| # | Finding | Impact | Action |
|---|---|---|---|
| F1 | `TblinvPurchaseHead.BusinessDayID` was missing on staging and is also missing on production (operator check: `COL_LENGTH` = NULL). It comes from the pre-DRVO legacy migration `db/migrations/add-purchase-business-day-id.sql`; `POST /api/purchases` has required it since `f8fbf8e` on `main`. | Purchases fail in both environments. DRVO did not cause it. **Production DRVO APPLY is on hold.** | Staging, 2026-10-09: applied only that file to `last132_agent` (identity guard: `last132_agent` / `drvo_agent` / `HAS_DBACCESS('last132')` = 0). The column (nullable INT), `FK_TblinvPurchaseHead_BusinessDayID` (→ `TblNewDay`) and `IX_TblinvPurchaseHead_Branch_BusinessDay` now exist; the table had 0 rows, so nothing was backfilled. Production is not migrated. |
| F6 | After F1, `POST /api/purchases` fails on `INSERT ... ClientID = NULL`: the route always inserts NULL for `ClientID` (since `061782c`, 2026-07-24, on `main`), but `TblinvPurchaseHead.ClientID` is `NOT NULL` with `FK_TblinvPurchaseHead_TblClient`. No migration in the repo relaxes it. `TblinvPurchaseHead` has 0 rows on staging. | Purchase posting cannot succeed on this schema. Pre-DRVO defect. GA proof is 59/60 (`ga-proof-after-legacy-migration.log`). | Decision needed: either a schema migration (make `ClientID` nullable) or a route fix (send a supplier). Production DRVO APPLY stays on hold until it is fixed and proven on staging. |
| F2 | `/book/[branchCode]` renders the not-found UI with HTTP 200, because the root `src/app/loading.tsx` streams before `notFound()`. | No data exposed; the public APIs return 404. Only the status code (and SEO) is affected. | Not a GA blocker. |
| F3 | Installing `booking` after onboarding does not create the branch's `QueueBookingSettings` row (onboarding does). | Booking stays off on that branch until an operator configures booking settings. | Not a GA blocker; operator step when enabling booking later. |
| F4 | The smoke and verify scripts print PASS or FAIL but keep the process alive (open DB handles). | Tooling only. | The runner stops them after the verdict. |
| F5 | Older smoke cleanups missed tables added by later DRVO branches, which caused FK errors. `drvo-012` compared the unknown pack against `undefined` (`findIndustryPack` returns `null`). `drvo-017` compared a plaintext password. `drvo-019` expected an empty roster where the code correctly refuses with `SERVICES_NOT_CONFIGURED`. | Smoke scripts only. | Fixed: shared `scripts/drvo/smokeTenantPurge.ts` (FK-aware, refuses CASHER_BOOT) plus the per-smoke fixes. |

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

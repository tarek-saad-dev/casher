# Phase 1I — Settings, Background Jobs, and Automation

**Date:** 2026-07-24  
**Database:** cloud / `last132`

---

## 1. Settings classification

Application settings use six app-level classes (Phase 1I brief). Mapping to live objects:

| Class | Live objects / keys | Examples | Branch-safe? |
|---|---|---|---|
| **GLOBAL_SETTING** | `TblSettings` (2 rows), most `TblSettingValues` (4 rows) | Split clearing method IDs (`SplitClearingMethodID`), payment config | Yes — intentional singleton |
| **BRANCH_SETTING** | `QueueBookingSettings` (2 rows: GLEEM + PH1GTEST inactive seed) | Queue prefix, booking grace, slot interval | Yes post-1F/1I — **no TOP 1 fallback** |
| **USER_SETTING** | Session preferences, login default via `TblUserBranchAccess.IsDefault` | Default branch at login | Yes |
| **DEVICE_SETTING** | `TblPrinter`, `TblPrintSetting`, local print agent host | Machine-bound printer selection | Deployment-local |
| **SECRET** | `TblSettingPasswords`, `CRON_SECRET`, WhatsApp tokens, `ADMIN_SECRET_KEY` | Nightly job auth | Must not leak per branch |
| **LEGACY_UNUSED** | Calendar-related settings if any | Inactive sync | Keep disabled |

### Unsafe patterns found and Phase 1I status

| Pattern | Location | Status |
|---|---|---|
| `SELECT TOP 1` on `QueueBookingSettings` without BranchID | `queue/settings` (removed) | **Fixed in 1I** |
| GLEEM operational fallback for missing branch settings | Public booking helpers | **Rejected by contract** — require `branchCode` |
| `WHATSAPP_DEFAULT_BRANCH_NAME` when BranchID known | Sales route | **Fixed** — uses `gated.branch.branchName` |
| Same default for employee daily WA | `employee-daily-whatsapp-report.service.ts` | **Open** — still `getConfig().defaultBranchName` |
| Global `TblSettingValues` read | `clearingMethod.ts`, payment routes | **SAFE_GLOBAL_QUERY** |

Live counts: `TblSettings` 2; `TblSettingValues` 4; `QueueBookingSettings` 2.

---

## 2. Environment and feature flags

| Variable / flag | Class | Notes |
|---|---|---|
| `WHATSAPP_*` | SECRET + GLOBAL | Integration credentials |
| `CRON_SECRET` | SECRET | Nightly close auth |
| Bootstrap `GLEEM` template copy | SAFE_BOOTSTRAP_CONSTANT | Phase 1G only — not runtime fallback |

**Rule:** GLEEM may appear in migration seeds and bootstrap copy sources; it must not appear as operational "first active branch" fallback in request handlers.

---

## 3. Background jobs audit

| Job / runner | Trigger | Branch behavior | Risk | Phase 1I |
|---|---|---|---|---|
| `scripts/run-nightly-close.ts` | Cairo 02:00 watcher / manual | Calls global nightly close once | **High** when multi-branch | Documented; not rewritten |
| `POST /api/admin/hr/nightly-close` | Cron / admin | Attendance + payroll + targets global | **High** | Documented |
| `POST /api/payroll/daily/auto-generate` | Cron | Emp-global generation | **High** | Deferred |
| Target recalc worker / process API | Sales side-effects | Emp+date queue | Med | Deferred |
| Queue due announcements | `/api/operations/queue/due-announcements` | Uses `requireActiveBranchContext` | Low | OK |
| Owner daily WhatsApp | Inside nightly close | **Iterates active branches** (1I) | Low | **Fixed** |
| Employee daily WhatsApp | Inside nightly close | Single `defaultBranchName` | Med | Open |
| Booking cleanup / lifecycle | Queue lifecycle engine | Branch via ticket parent | Low | OK |
| Phase 1G/1H verifiers | Manual CI | Read-only branch counts | Low | OK |
| Sync service | External | **Stopped** | Low if stopped | No restart |

### Nightly close detail

Steps in `runNightlyClose` (single `workDate`):

1. `finalizeIncompleteAttendanceWithDefaults` — all emps, no branch filter  
2. `runDailyPayrollGenerateWithOptionalLedger` — global eligible set  
3. `generateEmployeeDailyTargets` — global  
4. `sendEmployeeDailyWhatsAppReports` — global emp list  
5. `sendOwnerDailyWhatsApp` — **per active branch** full-day report (Phase 1I)

**Required future behavior (not implemented):**

* Per-branch iteration for attendance finalize and payroll when branches operate independent calendars  
* Or explicit "central HR hub" mode documented and enforced (only GLEEM runs HR jobs)

---

## 4. Per-branch vs global job contract

| Job type | Required behavior |
|---|---|
| **Per-branch** | Day open/close, shift force-close, queue sequences, treasury recon, branch-scoped reports, owner WA sections | Must iterate `listActiveBranches()` |
| **Global** | Client master dedup, sync (if ever restarted), global catalog admin | Document why |
| **Employee-global** | Booking overlap, schedule locks | Must dedupe when emp in multiple branches |

One branch failure must not silently skip others (target state — not fully implemented for nightly close).

---

## 5. Caches (server-side)

| Cache | Key scope | Class |
|---|---|---|
| `__pos_public_settings_cache_by_branch_v1` | BranchID | BRANCH_KEYED |
| Flow board refresh | Includes branchId | BRANCH_KEYED |
| Queue ticket sequences | BranchID + date (DB) | BRANCH_KEYED |
| Split clearing config read | Global name key | GLOBAL_SAFE |
| Recent invoices (if any module cache) | Must include branch | MUST_CLEAR_ON_SWITCH |

Hard reload on branch switch (Phase 1H) clears client state; server caches must still be branch-keyed for concurrent requests.

---

## 6. `.bat` / script runners

| Script | Purpose | Branch note |
|---|---|---|
| `run-nightly-close.ts` | HTTP POST to nightly close | Global workDate — see above |
| `bootstrap-branch.ts` | Create inactive branch | Does not activate |
| `14-phase1i-live-inventory.cjs` | Read-only audit | Confirms GLEEM-only active |
| `verify-branch-switcher.ts` | Phase 1H verifier | Confirms PH1GTEST inactive |

---

## 7. Phase 1I conclusions

| Area | Verdict |
|---|---|
| Queue booking settings | **Hardened** — branch required |
| Global app settings | **Acceptable** as GLOBAL_SETTING |
| Nightly close / HR automation | **Risk documented** — employee-global, not go-live safe for independent branch B HR |
| Sync | **Remain stopped** |
| Employee daily WhatsApp branch name | **Follow-up** — still config default |

Settings/jobs alone do not block GLEEM-only production. They **do** block unattended multi-branch HR automation until per-branch iteration or centralized HR policy is chosen.

# Phase 1M-A — Current Provisioning Audit

**Date:** 2026-07-25  
**Database (authoritative):** cloud / `last132`  
**Source of truth:** runtime source + schema migrations (not docs alone)

---

## Existing lifecycle

| Concept | Reality |
|---|---|
| `TblBranch.IsActive` | Sole pre-1M lifecycle bit |
| `BranchStatus` / `LifecycleStatus` | **Absent before 1M** |
| `PublicBookingEnabled` on branch | **Absent before 1M** — public toggle was `QueueBookingSettings.BookingEnabled` |
| Create path | CLI `bootstrapBranch` / `createBranchRecord` (previously defaulted **active**) |
| Activation | Manual `IsActive` flip |
| Admin UI create | **None** |
| `requireBranchAdminAccess` | **Absent before 1M** |

Live: GLEEM active; PH1GTEST BranchID=2 inactive; sync stopped.

---

## Domain matrix

| Domain | Current ownership | Required config | Default/fallback | Operate if missing? | Activation blocker? | Provisioning action | Readiness check |
|---|---|---|---|---|---|---|---|
| Branch identity | `TblBranch` GLOBAL_MASTER | code, name, tz, cutoff | GLEEM seed | No | Yes | create SETUP row | identity.* |
| Public booking flag | `QueueBookingSettings.BookingEnabled` (+ 1M branch `PublicBookingEnabled`) | off until PUBLIC_LIVE | previously often ON on copy | Ops yes / public no | Public live | seed settings BookingEnabled=0 | booking.public_flag |
| Queue settings | Branch-owned settings row | intervals, notice, horizon | copy from GLEEM optional | Ops degraded | Smoke+ | `ensureQueueBookingSettingsForBranch` | legacy.QUEUE_SETTINGS |
| Session / switcher | `TblUserBranchAccess` + IsActive branch | CanOperate | inactive branches hidden | No | Internal live | optional grant actor | legacy.OPERATOR_ACCESS |
| Employees | Assignment HYBRID | ≥1 test emp for smoke | none auto-copied | No | Smoke+ | draft only — manual assign | legacy.ELIGIBLE_BARBER |
| Payroll plans | Branch-owned `TblEmpBranchPayrollPlan` | effective plan per assignee | no GLEEM fallback (1L) | Check-in blocked policy | Smoke+ hard | never silent copy | payroll.plan_coverage |
| Targets | Branch-owned plans | per policy | no GLEEM fallback | Partial | Internal/public | never silent copy | legacy / policy |
| Services/prices | Catalog + eligibility | ≥1 enabled | not auto-copied | No | Smoke+ | draft | legacy checks |
| Treasury / payments | Branch cash | methods + opening workflow | no balance copy | No | Internal | container only | warnings/blockers |
| Inventory | Branch-owned | location + zero qty | no qty copy | No | Internal | container only | warnings |
| Nightly jobs | `listActiveBranches` | IsActive=1 only | SETUP/SMOKE IsActive=0 | N/A | N/A | keep inactive | lifecycle.is_active |
| WhatsApp | Feature flags + branch name | disabled in SETUP/SMOKE | master env gate | — | Public/internal | ExternalNotificationsEnabled=0 | external |
| Printing | Local agent | optional | no disable env | Ops optional | Warning | placeholder | printing |
| Reports | Branch scope | scoped APIs | fail closed wrong id | — | Internal | n/a | reports |
| Public list API | `listPublicActiveBranches` | PUBLIC_LIVE + PublicBookingEnabled | single-branch fallback if exactly one public | — | Public | filter lifecycle | public.frontend_multi_branch |
| Partner shares | Branch periods | optional template copy | from GLEEM % only | Warning | Warning | selective copy | partner |

---

## Gaps closed by 1M (design)

1. LifecycleStatus + PublicBookingEnabled + ExternalNotificationsEnabled  
2. `provisionBranch` always SETUP  
3. Server transition + readiness re-check  
4. Smoke artifact registry  
5. Public discovery fails closed for non-PUBLIC_LIVE  

---

## Residual risks

- Migration must run before deploying repository SELECT that references new columns.  
- cutsaloon.com multi-branch UI still required before PUBLIC_LIVE for a second branch.  
- Full PH1GTEST operational smoke not executed in this change set (see smoke-results).  

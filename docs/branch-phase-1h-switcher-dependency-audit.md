# Phase 1H — Switcher Dependency Audit

**Status:** Complete  
**Date:** 2026-07-24  
**Scope:** Everything that reads or writes the session's `ActiveBranchID` / `ActiveBranchCode`, and everything the in-session branch switcher must not disturb.

## 1. What "switching branch" actually changes

The signed session cookie's `ActiveBranchID` / `ActiveBranchCode` claims (`src/lib/session.ts`, `SessionPayload`). Nothing else is written:

* `TblUserBranchAccess.IsDefault` — **never** touched by the switch flow. `IsDefault` still only controls the *login-time* default branch (`resolveLoginDefaultBranch` in `src/lib/branch/access.ts`), which is unrelated to which branch is active mid-session.
* `TblUserBranchAccess.CanSwitch` — audited in Phase 1B, still unused for authorization. See §3.
* No row in any business table is created, updated, or deleted by a branch switch.

## 2. Access-control dependency

`switchActiveBranch` (`src/lib/branch/switchBranch.ts`) reuses the exact same access primitives Phase 1B–1G already rely on:

| Dependency | Used for |
|---|---|
| `getUserActiveStatus` (`repository.ts`) | Reject soft-deleted users before and after switching |
| `getBranchById` (`repository.ts`) | Resolve + validate the target branch is active |
| `validateUserBranchAccess` (`access.ts`) | Resolve the user's `TblUserBranchAccess` row for the target branch (active, in date range, branch active) |
| `access.canOperate` | **The** switch permission (see §3) |

No new SQL, no new table, no new repository function was added for switching — the read-path is 100% the pre-existing Phase 1B/1G access layer.

## 3. Audit decision: no new `CanSwitch` gating

`TblUserBranchAccess.CanSwitch` was added to the schema in Phase 1B and is still selected by `listUserBranchAccessRows` (`repository.ts`) and surfaced on `UserBranchAccessRecord.canSwitch` / `ActiveBranchContext.canSwitch`, but **no code path enforces it** — not before Phase 1H, and not after.

**Decision:** `CanOperate` is the switch permission. A user may switch their active session into any branch where they have an active, in-range `TblUserBranchAccess` row with `CanOperate = 1` and the branch itself is active. `CanSwitch` remains an unused column (schema-present, not read for authorization) — exactly as it was in Phase 1B–1G. This avoids introducing a second, undocumented permission axis for a feature (`CanOperate`) that already means "may operate this branch's day-to-day POS operations," which is precisely what switching into it grants.

No admin bypass: `UserLevel = 'admin'` does **not** skip the `CanOperate` check. Source contract test + verifier both assert this (no `UserLevel === 'admin' ... canOperate` bypass pattern in `switchBranch.ts`).

## 4. Downstream readers of `ActiveBranchID` (unaffected by switching, by design)

Every branch-scoped read/write in the app resolves the active branch from the **session cookie** at request time (`getActiveBranchContext()` → `getSession()`), never from a client-supplied value. Because switching reissues that same cookie shape (`BranchSessionVersion = 1`, same claim names), none of the following needed to change for Phase 1H:

* `requireActiveBranchContext` / `requireBranchOperationAccess` / `requireBranchReportAccess` (`branch/context.ts`)
* Business-day / shift resolution (`branch/businessDay.ts`, `branch/shiftSession.ts`)
* Financial ownership checks (`branch/financialOwnership.ts`)
* Booking/queue ownership (`branch/bookingQueueOwnership.ts`)
* Report scope resolution (`branch/reportScope.ts`)

These modules all "just work" the instant the cookie's `ActiveBranchID` changes — no per-module Phase 1H change was required or made.

## 5. Client-side state that becomes stale on switch

Audited every client-side cache/ref that is keyed by (or implicitly assumes) the active branch:

| State | Location | Handling |
|---|---|---|
| `recentInvoicesCache` | `src/lib/recentInvoicesCache.ts` | Explicitly cleared by `clearClientBranchOwnedState()` before navigation |
| `__pos_public_settings_cache_by_branch_v1` | booking settings cache (Phase 1F) | Keyed by `BranchID` already — self-isolating, no clear needed |
| `activeBranchIdRef` (operations flow-board) | `src/app/operations/page.tsx` | Derived from `user?.ActiveBranchID` on every render — refreshed for free by the post-switch full reload |
| `SessionContext` (`user`, `day`, `shift`, `activeBranch`) | `SessionProvider.tsx` | Replaced wholesale by the full document reload (`window.location.assign`), which remounts `SessionProvider` and re-fetches `/api/auth/session` from scratch |
| Any open shift / open day state held only in component state | Various pages | Same as above — hard reload guarantees no residual branch-A state renders under branch-B |

See `docs/branch-phase-1h-cache-and-state-isolation.md` for the full mechanism and why a soft `router.refresh()` was rejected.

## 6. Files touched vs. files audited-and-left-alone

**Touched for Phase 1H (already implemented, listed for completeness):**
`switchBranch.ts`, `postSwitchNavigation.ts`, `postSwitchClient.ts`, `api/auth/branches/route.ts`, `api/auth/switch-branch/route.ts`, `BranchSwitcher.tsx`, `ActiveSessionBar.tsx`, `MobilePosHeader.tsx`, `SessionProvider.tsx`, `sensitiveActionRegistry.ts`, `sensitiveActionAudit.ts` (`writeSensitiveAuditEvent`).

**Audited, confirmed branch-cookie-driven, left unchanged:** `branch/context.ts`, `branch/businessDay.ts`, `branch/shiftSession.ts`, `branch/financialOwnership.ts`, `branch/bookingQueueOwnership.ts`, `branch/reportScope.ts`, `api/auth/session/route.ts`, `api/auth/login/route.ts`.

## 7. Fixed while auditing

`SessionProvider.tsx`'s `activeBranch` state was populated straight from `/api/auth/session`'s `activeBranch` payload, which returns **PascalCase** keys (`BranchID`, `BranchCode`, `BranchName`, `ShortName`) while the `SessionActiveBranch` type (and every other branch-safe DTO in the app) uses **camelCase** (`branchId`, `branchCode`, ...). No current consumer read `useSession().activeBranch` yet, so this was latent, but it would have silently produced an all-`undefined` object for the first future consumer. Fixed by normalizing the mapping in `SessionProvider.refresh()`. `BranchSwitcher.tsx` was never affected — it fetches its own, correctly camelCase, payload from `/api/auth/branches`.

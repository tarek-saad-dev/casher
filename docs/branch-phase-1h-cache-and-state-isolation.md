# Phase 1H — Cache and Client-State Isolation on Branch Switch

**Status:** Complete  
**Date:** 2026-07-24  
**Modules:** `src/lib/branch/postSwitchClient.ts`, `src/lib/branch/postSwitchNavigation.ts`, `src/components/session/BranchSwitcher.tsx`

## 1. Why a soft refresh is not acceptable

Next.js's client-side `router.refresh()` re-runs Server Component data fetching for the current route, but it does **not**:

* Reset in-memory React state that lives above the refreshed segment (e.g. `SessionProvider`'s `user`/`day`/`shift`/`activeBranch` state, which is a Client Component context provider mounted once at the root).
* Clear module-level JS caches (`recentInvoicesCache`, any `Map`/`WeakMap` singleton).
* Guarantee in-flight requests started under the old branch are discarded before new ones start.

Because branch-scoped financial and operational data (open day, open shift, recent invoices, flow-board state) is held in exactly these places, a soft refresh risks rendering branch-A data with a branch-B session, or vice versa, for a frame or more. Phase 1H's contract is therefore: **a successful switch always performs a full document navigation.**

`postSwitchClient.ts` and `BranchSwitcher.tsx` do not import `useRouter` from `next/navigation` at all — this is enforced by both the unit test suite (`phase1hBranchSwitcher.test.ts`) and `scripts/verify-branch-switcher.ts`, so a future edit cannot silently reintroduce a soft-refresh-only path.

## 2. The mechanism

`performBranchSwitch()` (`postSwitchClient.ts`):

1. `confirmDiscardUnsavedWorkIfNeeded()` — if the page has marked unsaved form state (`window.__posUnsavedForms`), the user is asked to confirm before anything else happens. Returns early with `{ ok: false, error: 'CANCELLED' }` if declined — **no** server call is made, so an unsaved-work cancellation is entirely free of side effects.
2. `POST /api/auth/switch-branch` — the only network call. If it fails, the function returns the server's error/message; **no client state is touched and no navigation happens.**
3. `clearClientBranchOwnedState()` — clears `recentInvoicesCache` (currently the only known cross-page, branch-scoped, module-level cache; wrapped in `try/catch` so a clear failure never blocks navigation).
4. `resolvePostSwitchNavigationPath(currentPathname)` — computes a safe landing path (§3).
5. `window.location.assign(target)` — a full document navigation. This unmounts and remounts the entire React tree, including `SessionProvider`, which re-fetches `/api/auth/session` from scratch under the new cookie. Every module-level singleton is destroyed and recreated by the browser's page reload; there is no code path where stale branch-A JS state can survive into the branch-B render.

## 3. Landing-path safety (`resolvePostSwitchNavigationPath`)

A pure function (`postSwitchNavigation.ts`, no `'use client'`, no `server-only` — safe to unit test directly and to share between client and any future server usage):

* Strips query strings; `null`/`undefined`/empty input defaults to `/`.
* Redirects known **entity-detail** URL shapes to `/`, because a record ID from the previous branch (a booking, a queue ticket, a sale, a queue entry, an income/expense row) will not resolve — or worse, could resolve to a *different* record — once ownership is checked against the new active branch:
  * `/operations/bookings/:id`, `/bookings/:id`, `/sales/:id`, `/queue/:id`, `/income/:id`, `/expenses/:id`, `/incomes/:id`
* Leaves list/dashboard-style paths untouched (`/income/pos`, `/operations`, `/queue`, etc.) — these re-render safely against the new branch because they don't reference a specific prior-branch record ID.

This list matches the actual branch-scoped detail routes audited in Phase 1D–1G (financial ownership, booking/queue ownership) — it is not a generic guess.

## 4. What is intentionally *not* isolated client-side

Nothing needs to be, given the hard-reload contract: every piece of branch-scoped server data is re-derived from the reissued cookie on the very next request after `window.location.assign`. The only client-side work that exists (`clearClientBranchOwnedState`) is a **defensive belt-and-braces** clear for the one cache that lives long enough in memory to matter between the fetch success and the reload firing — it is not load-bearing for correctness, the hard reload is.

## 5. Unsaved-work confirmation

`confirmDiscardUnsavedWorkIfNeeded()` is a lightweight, dependency-free guard (`window.__posUnsavedForms` counter + `window.confirm`). It does not attempt to integrate with every form's dirty-state individually — pages that want branch-switch protection increment the counter while a form is dirty. No pages currently do so; this is a hook for future forms, not a regression, since Phase 1H did not previously exist and there is no prior behavior to preserve.

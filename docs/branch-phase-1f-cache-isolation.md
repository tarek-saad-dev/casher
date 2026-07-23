# Phase 1F — Cache Isolation

## Public settings

| Item | Value |
|---|---|
| Global key | `__pos_public_settings_cache_by_branch_v1` |
| Structure | `Map<BranchID, { value, expiresAt, inflight }>` |
| TTL | 45_000 ms |
| Load SQL | `QueueBookingSettings WHERE BranchID = @branchId` |
| Invalidate | `invalidatePublicSettingsCache(branchId?)` — omit clears all |

Must not cache occupancy / dynamic availability in this store.

## Ticket sequences

Not a process cache — DB-scoped `MAX(TicketNumber)` per `(BranchID, QueueDate)`.

## Ops / React Query

Operations page already keys some client caches with active branch id (`getBranchId: () => activeBranchIdRef…`). Flow-board payload is branch-filtered server-side.

## Explicit

No react-query public settings cache shared across branches. No silent reuse of pre-1F single-row settings assumptions once a second branch exists (still only GLEEM live).

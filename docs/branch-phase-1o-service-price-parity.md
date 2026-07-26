# Phase 1O — Service / Price Parity

**Policy:** Services are **global** (`TblPro`). No branch-owned price table. Selective template does **not** clone catalog rows.

## Live apply snapshot (`last132` · CC BranchID=3)

| Check | Result |
|---|---|
| Active priced services | **1** |
| Parity mismatches | **0** |
| Deleted / inactive services reactivated | **No** |
| Branch price rows created | **0** |

### Catalog sample at apply

| ServiceID | Name | GLEEM price | CC price | Duration | Ownership |
|---|---|---|---|---|---|
| 23 | Dry-Hair | 100 | 100 | 10 | GLOBAL_TBLPRO_SHARED — no branch-owned clone |

## Template domains

`service_availability` / `service_prices` / `service_durations`: skipped copy (before=1, after=1, created=0, updated=0). Notes: parity = shared catalog snapshot; future price changes require explicit sync.

## Decision status

Service/price **policy** RESOLVED (shared global catalog). Future divergence must be an explicit business change — not silent per-branch invent.

# Phase 1E — Legacy Report SQL

| Object | Status | Action |
|---|---|---|
| App report services (TS) | Active | Branch-filtered in 1E |
| `sp_GetMonthlyPayroll` | Active API, no BranchID | Deferred; do not call from branch financial consolidation |
| Report views | None critical found | — |
| Hardcoded PARTNERS | Deprecated | SQL `TblBranchPartnerShare` is source of truth |

Do not use optional `@BranchID = NULL` meaning “all branches” for ordinary users.

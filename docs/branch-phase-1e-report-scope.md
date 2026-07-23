# Phase 1E — Report Scope Rules

**Module:** `src/lib/branch/reportScope.ts`

## Scope types

```ts
mode: 'single' | 'all'
```

## Permission rule (final)

1. Page ACL (`requirePageAccess`) must allow the report route.
2. Single branch: `TblUserBranchAccess.CanViewReports = true` for that branch (validated; browser `branchId` never trusted alone).
3. `ALL_BRANCHES` (`scope=all`): additionally requires `CanViewReports` on **every** active branch. Incomplete access → 403 `ALL_BRANCHES_INCOMPLETE_ACCESS`.
4. **`UserLevel = admin` alone does not grant ALL_BRANCHES.**

## Defaults

* Operational and most report callers default to **active session branch**.
* Cashiers without `CanViewReports` cannot open report scopes.
* Write APIs still reject ALL_BRANCHES (unchanged from prior phases).

## Cache key

`reportScopeToCacheKey(scope)` → `single:{id}` or `all:{sortedIds}`.

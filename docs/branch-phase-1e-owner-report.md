# Phase 1E — Owner / Monthly Reports

Owner operating totals use branch-scoped full-day and monthly treasury/sales services.

## Single branch

All calculations filtered by that branch’s `BranchID`.

## All branches

1. Load authorized active branches  
2. Calculate each independently  
3. Consolidate only afterward  

Invariant: consolidated total = sum of branch totals (trivial today with one branch).

Partner % is not mixed into owner operating-profit unless the specific report UI already applied partner distribution separately (monthly PDF uses SQL shares for display only).

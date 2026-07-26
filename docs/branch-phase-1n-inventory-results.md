# Phase 1N — Inventory Results

SmokeRunID **11** (Camp Caesar BranchID=3)

| Step | Result |
|---|---|
| Location/container | `TblBranchInventory` ensure for ProID smoke product |
| +5 adjustment | PASS |
| -1 adjustment | PASS |
| SALE consumption -1 | PASS |
| Final qty path | after=+4 then cons=3 |
| GLEEM qty same ProID | unchanged |
| Wrong-branch | not mutated |

Root cause of prior fail: non-tracked / detail `ProType` truncation (`nvarchar(2)`); fixed with NULL ProType + tracked `pro` product + same `sql` pool transaction.

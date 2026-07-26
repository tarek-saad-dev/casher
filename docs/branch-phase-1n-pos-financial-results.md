# Phase 1N — POS / Financial Results

| Item | Evidence (run 11 / last successful ops) |
|---|---|
| Cash invoice | TblinvServHead + Detail + InsCashMoveSales CashMove BranchID=3 |
| Card invoice | PaymentMethodID=2 · CashMove BranchID=3 |
| Not CashMove-only | Head+Detail required |
| Client | walk-in ClientID=1 |
| GLEEM invoices | unchanged (isolation fingerprints) |

See `_phase1n-cc-after-ops.json` / cleanup fingerprint for IDs.

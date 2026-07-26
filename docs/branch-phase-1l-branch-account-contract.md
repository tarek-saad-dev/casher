# Phase 1L — Branch Account Contract

**Date:** 2026-07-25

```text
One global employee identity
+
one writable employee financial account per branch
+
one read-only global total
```

Source of truth: `EmpID + BranchID`.

Global = `SUM` of authorized branch balances (`vw_EmpLedgerGlobalBalance`).

Never:

* Pay from another branch’s balance  
* Use global as payout limit  
* Combine multi-branch attendance into one payroll row  
* Combine multi-branch sales into one target row  
* Fall back to GLEEM plans  
* Mutate BranchID after financial row creation  
* Create a writable global ledger account  

See also: ledger, payroll plan, hourly, monthly, target, nightly, reconciliation docs.

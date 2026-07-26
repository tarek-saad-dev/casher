# Phase 1R — Security

- Schedule save: `requireAdmin`.
- Transfer: `requirePageAccess('/operations')` + source/destination branch access flags.
- Browser cannot authoritatively set `FromBranchID`.
- SETUP destinations excluded from normal transfer destination lists.
- Historical attendance/payroll BranchID never rewritten by transfer.
- Cancel soft-deactivates (`IsActive=0`) — no hard delete.

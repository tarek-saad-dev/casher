# Phase 1O — Payment Methods & Treasury

## Payment methods (RESOLVED)

| Fact | Value |
|---|---|
| Catalog | Global `TblPaymentMethods` — **9** methods |
| Branch-owned method rows | None |
| Balances copied | **No** |
| Template domain | `payment_method_enablement` — skipped create/update (9 skipped) |

CC uses the same method catalog as GLEEM. SETUP still blocks normal ops.

## Opening cash (OPEN)

| Decision | Status |
|---|---|
| Opening cash balance | **OPEN** — `biz.opening_cash` |
| Invented balance | Forbidden |

No treasury balances were copied from GLEEM during Phase 1O apply.

## Isolation

Transactional CashMove / invoice balances remain branch-owned. Config apply must not seed opening cash.

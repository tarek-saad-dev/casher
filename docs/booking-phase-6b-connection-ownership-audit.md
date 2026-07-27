# Booking Phase 6B — Connection ownership audit

**Date:** 2026-07-27

## Root cause of concurrent smoke failure

`getEmployeeBusyIntervals` (and `loadBookingOverridesForDate`) ran `Promise.all` of two `db.request()` calls while `db` was the **open Transaction**.

node-mssql allows **one request at a time per connection**. Parallel requests →:

`Can't acquire connection for the request. There is another request in progress.`

Errors were often swallowed in `buildQueueIntervals` / `buildBookingIntervals` `.catch(() => [])`, yielding empty busy sets — unsafe under TX.

## Step matrix (create)

| Step | Executor | Nested pool while TX? | Parallel on same conn? | Release |
|------|----------|----------------------|------------------------|---------|
| Early idempotency lookup | pool | n/a | no | immediate |
| create_precheck evaluator | pool | n/a | pool-parallel OK | before begin |
| Branch/services refresh | pool | n/a | no | before begin |
| TX begin | TX holds 1 conn | — | — | commit/rollback |
| Idempotency claim | `transaction.request` | no | no | — |
| Applocks | `transaction.request` | no | no | end of TX |
| Schedule + busy (pre-fix) | TX cast as db | getBarberWorkingWindow pool | **YES Promise.all** | — |
| Customer upsert | `transaction.request` | no | no | — |
| Inserts | `transaction.request` | no | sequential | — |
| Commit | releases TX conn | — | — | — |
| Cache / WhatsApp | memory / post-commit pool | no | no | after commit |

## Fix

1. Serialize busy + override queries when executor is a Transaction.
2. Rethrow busy-query failures under Transaction (no empty-set swallow).
3. Preload timing settings before `begin` where possible.
4. Do **not** raise `pool.max` as first fix (still 10).

## Pool config (effective)

| Setting | Value |
|---------|-------|
| max | 10 |
| min | 2 |
| idleTimeoutMillis | 30000 |
| acquireTimeoutMillis | 60000 |
| connectionTimeout | 60000 |
| requestTimeout | 60000 |

Env overrides: server/user/password only — no pool max override found.

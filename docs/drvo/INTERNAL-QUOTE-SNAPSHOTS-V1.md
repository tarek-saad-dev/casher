# DRVO ERP — Immutable Internal Research Quote Snapshot (DRVO-022)

**Date:** 2026-10-26 · **Operator research only, not a quote offer for sale.**  
**Stacked:** PR #157 (Draft) → PR #154 (awaiting staging), no auto-merge.

## Implemented

- DRVO migration **022** creates `dbo.ModularInternalQuoteSnapshot` with immutable research simulation, expiry, SHA-256 content digest, unique `(TenantId,RequestId,CandidateId)`, a trusted composite `(TenantId,RequestId)` FK, independent candidate FK, strict `internal_only` SQL status and 48-hour expiry limit.
- `POST /api/admin/platform/internal-quote-snapshots` accepts exactly `{requestId,candidateId}` from a platform operator. It ignores/removes all would-be client amount, tenant, app, currency, period and status inputs by refusing unexpected keys.
- The server loads the **authoritative** inquiry and release source inside a tenant-serialized SQL transaction. It rechecks tenant-active/industry, protects `CASHER_BOOT`, requires open inquiry, previously reviewed tariff, pending-policy candidate, matching source digest/research version, complete app catalog and business selection dependencies. Quotes are calculated by the existing pure research engine.
- The full line-item result is frozen with server-generated timestamp (whole seconds) + internal 48-hour TTL and a SHA-256 hash over tenant/request/candidate, research source/version, draft revision, quote totals/lines and creation/expiration times. On reading it recomputes and verifies digest/line arithmetic; edited, malformed and stale-source data fail closed.
- Same tenant/request/candidate inputs return the **existing immutable snapshot**, even if its internal TTL has expired; clients cannot refresh a preview merely by posting again. New quote inquiry/source would be needed. No customer order or subscription results from POST.
- `GET` lists the latest operator-only archive. The UI at `/platform/internal-quote-snapshots` selects the saved inquiry and research candidate, creates a snapshot, and displays research-only EGP line items, source identifiers and current/expired status.
- All responses permanently contain `canIssueCustomerQuote:false`, `canAcceptOrder:false`, `canCheckout:false`, `canActivate:false`, `paid:false`, `orderCreated:false`.

## Non-sale contract

- **48 hours is purely an INTERNAL archive freshness window**, not an approved customer quote expiry policy. There are no customer sale quote records, no legal acceptance workflow, no price approved for sale, order, payment intent, invoice, outbox event or entitlement grant.
- Research excludes taxes, gateway and variable consumption costs. Neither research review nor ten internal policy evidence checks constitute permission to publish pricing.
- `ModularPriceCatalog`, `TenantSubscription`, `TenantAppEntitlement`, `CASHER_BOOT` accounting/booking/payroll data are not changed.

## QA / release gates

1. GitHub CI: DRVO migrations & scoped regressions, tenant isolation, production build.
2. Required **Staging**: migration 022 after 021; DB verify FK/index/constraints and checksum; real operator create/replay/expired & closed inquiry; forged client fields 400; tenant-admin 403; concurrent duplicate submission; stale or modified candidate digest rejected; all preexisting Cut Salon invoice/day-close/booking flows unaffected.
3. Merge requires explicit human commercial readiness/staging approval; while PR #154 is open, PR #157 remains **Draft / NO MERGE**.

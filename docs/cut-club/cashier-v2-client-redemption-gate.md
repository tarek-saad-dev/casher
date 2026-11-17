# CUT CLUB 2.0 — cashier and customer voucher rollout gate (#302)

**DRAFT, not deployed.** No production database connection or SQL writes occurred in this execution.

## Critical legacy issues identified
- Old staff voucher lookup fetched customer details by code without tenant predicate. Old POST marked vouchers USED before the invoice was saved and used a separate read-then-update with no conditional ACTIVE check. Duplicate cashier requests could cause repeated usage logs and customers could lose an entitlement if invoice save failed.
- Cashier phone lookup selected the first matching client even if multiple customers shared the phone.
- The old POS modal called the unsafe use endpoint before applying any actual discount to a saved invoice.

## New implementation
- Cashier UI at /cashier/cut-club: inspect code, show client/name/status, require saved invoice, show supported reward types and clear manual retry instructions.
- Guarded read GET /api/pos/cut-club/vouchers, OFF unless CUT_CLUB_CASHIER_V2_READ_ENABLED=true; valid staff tenant + canOperate active branch, voucher code, tenant-scoped client and legacy SalonID/branch mapping, no-store/private.
- Guarded POST /api/pos/cut-club/redeem, OFF unless CUT_CLUB_CASHIER_V2_REDEEM_ENABLED=true; exact configured trusted HTTPS CASHER_CANONICAL_ORIGIN and same-origin fetch metadata; staff authentication plus tenant/branch; invoice belongs to SAME branch and customer; only FREE_SERVICE with matching zero-priced invoice detail supported.
- SQL SERIALIZABLE transaction obtains voucher locks, checks invoice and service proof, conditionally updates ACTIVE/nonexpired inventory, writes one usage log, and commits. Same-invoice replay returns success without new log. Failures roll back and return non-disclosing error; no Coins mutations.
- Existing unsafe POST now returns 410 (staff only). Old voucher GET is scoped to tenant and branch and removes wildcard CORS. Phone lookup denies ambiguous results. POS modal now links to safe cashier flow instead of consuming the voucher before invoice save.
- Mandatory CI guards and source tests. SQL transaction behavior still needs actual SQL Server two-connection verification.

## Release blockers
1. Operator-verified real DB schema and legacy SalonID-to-active-branch identity. Owner authorized production database as source, but GitHub access does NOT execute SQL. No live DB was accessed.
2. Synthetic real-SQL concurrency, existing vouchers, sales invoice validity and cancellation/reversal tests.
3. Business signoff for post-invoice FREE_SERVICE. Other types (percentage/cash discount, product, bonus Coins, Mystery Box) stay blocked pending proven financial effect/settlement integration.
4. Coordinate legacy route retirement to prevent disruption; reconcile existing pending vouchers, branch switches, POS and customer support.
5. Verified customer session and WhatsApp OTP transport (deferred by owner), authoritative tenant/legacy customer link, wallet BFF and real customer screens.
6. Staging E2E, independent security review, VPS rollback and explicit owner exact-head release go/no-go.

**NO MERGE / NO DEPLOY / NO PRODUCTION CUSTOMER OR FINANCIAL MUTATIONS.**

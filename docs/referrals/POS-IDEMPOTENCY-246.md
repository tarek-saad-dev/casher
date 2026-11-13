# Persistent POST /api/sales Idempotency — Issue #246 (DRAFT)

**Server flag `POS_SALE_IDEMPOTENCY_ENABLED=true` and client build flag `NEXT_PUBLIC_POS_SALE_IDEMPOTENCY_ENABLED=true` both default OFF.** Enabling either independently is prohibited: new client sends UUID and fails 503 if server disabled, server requires UUID and fails 400 if old client disabled.

## Problem addressed

If the card terminal or Wi-Fi drops AFTER a paid invoice commits and BEFORE the cashier receives HTTP 201, repeating POST could create a second paid invoice, duplicate stock deduction/cash and (depending on referral claim state) duplicate money. The in-browser `saveLockRef` protects double-clicks only on one mounted browser, not distributed retries.

## Implemented mechanism

- New DRVO-024 additive, checksum-controlled schema `dbo.TblPosSaleRequest` with unique PK `(TenantId, RequestID)`, staff user+branch binding, immutable SHA-256 request fingerprint, PENDING/COMMITTED state and invoice reference.
- Browser uses `crypto.randomUUID()` once on a new sale; retries after an unknown error keep the same UUID. A **sessionStorage** copy survives a same-tab page reload without storing any customer, cart or payment data. Successful creation/replay clears both the in-memory and stored UUID. Explicit **New Invoice** first asks the cashier to confirm checking recent invoices if the pending key is unresolved, then rotates to a fresh draft. PUT edits do not send the UUID.
- POST authenticates tenant/user/active branch; computes SHA-256 over tenant/user/branch and exact original JSON payload minus `requestId`. Same request ID with different client, amount, service, payment, referrer, voucher or user/branch fails 409. Does not store original PII, only the digest.
- Before asking whether the shift is still open, the route performs a read-only fast lookup of a previously committed request and checks original invoice still exists, is fully paid, active and belongs to the same tenant/branch. A valid replay immediately returns HTTP **200** with original invID and `replayed:true`. A refunded/deleted original invoice results in 409 and is NOT silently recreated.
- Both independent extracted and legacy POS sale writers first acquire SQL `UPDLOCK,HOLDLOCK` on the unique tenant+request key inside their existing **SERIALIZABLE** transaction. Duplicate completed request returns the same persisted invoice and skips stock, payments, referral issuance/redemption, cash and post-commit effects. For new sale, PENDING reservation is created BEFORE any invoice mutation.
- After completed paid invoice, rewards, stock and payments have been saved, both writers atomically update that SAME reservation to COMMITTED + invoice identity *BEFORE transaction.commit*. Failure causes the same rollback as failed sale, including request key reservation.
- The invoice response indicates replay, and the handoff-charge side effect does not run on a replay.

## Caveats / launch gates

- This PR is stacked on **unmerged integration #245**, with schema DRVO-023 and all referral screens, and is NOT safe to merge independently.
- Because two schema migrations (023+024) are needed, first run controlled staging migration + real SQL concurrent same-key paid invoice/refund/payment tests and independent review. Test suites use SQL mocks and static wiring but are not a substitute for a real sale E2E with final money reconciliation.
- Repeated POST without a UUID when the server feature flag is enabled **fails closed**. Existing POS will need a coordinated client+server flag rollout and rebuilt client.
- An unknown response after a Post-Commit handoff side effect may leave a handoff follow-up unprocessed if it failed first time; this handler explicitly prevents the effect from running twice. Reconciliation/manual review for this unrelated side effect is still required.
- **No production DB `last132` access, no merge and no production deployment.** DRVO-024 migration risk MEDIUM with backup required; read-only production PLAN and separately human-approved APPLY required.
- Full 50/20 referral integrated financial E2E, reward refunds and permission review stay hard gates from #245.

## Tests

`src/lib/__tests__/saleRequestIdempotency.test.ts`: disabled/default contract, UUID, stable hash, owner+tenant+branch 409, schema 503, committed same invoice replay, refunded invoice blocked, SQL UPDLOCK/HOLDLOCK and atomic COMMITTED, zero affected rows rollback.

`src/lib/__tests__/saleIdempotencyWiring.test.ts`: route replay order before shift checks, no repeated handoff, both writers reserve before invoice and complete before commit, browser retry UUID stable and SQL UNIQUE composite key.

Full Next build and existing refund/referral/booking/printing CI required; end-to-end schema and financial staging required separately.

- Browser guard regression: `clientSaleRequestId.test.ts` verifies UUID retention on uncertain response/reload, corrupt stored UUID replacement, deliberate/success clearing, and no PII stored. The network retry ID is per browser-tab; unrelated devices or tabs require operational reconciliation.

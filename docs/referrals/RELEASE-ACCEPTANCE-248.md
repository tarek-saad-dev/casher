# CUT Referral 50/20 + Sale Idempotency — Release Acceptance (#248)

**STATUS: NOT APPROVED.** This page is a live release contract, **not** an approval or an assertion that paid-sale E2E passed. #248 is stacked on #245 and contains the whole combined implementation; never merge both overlapping drafts separately.

## Evidence now available
- [CI on previous exact head 35c0bb8](https://github.com/tarek-saad-dev/casher/actions/runs/43532297644): PASS incl. Next production build and mock/static regression suites.
- [Staging on previous exact head 35c0bb8](https://github.com/tarek-saad-dev/casher/actions/runs/43532297575): DRVO-023 / DRVO-024 SQL rollback-only smoke PASS. Overall DRVO staging gate is a *separate* status.
- Stacked gate now runs both 023 and 024, and `scripts/drvo/drvo248-referral-financial-audit-staging.ts` checks persisted financial ledger inconsistencies with **SELECT only**. It is not a real invoice E2E and an empty ledger must never be recorded as E2E pass.
- DRVO-012 historical missing subscription on staging is reconciled **INSERT-only on staging for #248**, via the existing guarded CLI before the commercial smoke. This action must not run against production.

## Mandatory *real paid-sale* acceptance (still unproven)
Use an isolated, disposable **staging tenant**, two test clients, an owned branch, one real service with known list price, legitimate open business day/shift and mock/excluded WhatsApp/payment-gateway integrations. Never use CUT customer records, live payment terminals or production tenant IDs. Test extracted and legacy POS writer separately. Preserve redacted evidence with invoice IDs only from synthetic staging data.

| Scenario | Required verifiable outcome |
| --- | --- |
| Ordinary qualifying first sale | Referrer is fully paid, gets one activated permanent CUT code; payment rows, cash and stock movements match base invoice |
| First-visit referral 50% | Price 200 -> **GrandTotal 100**, exactly 100 collected; first visit only; one APPLIED claim; one 20% voucher for referrer; server ignores forged UI totals |
| 20% subsequent reward | Separate referrer new sale list price 200 -> **GrandTotal 160**; voucher moves ACTIVE -> USED, exactly once, and payment/treasury sum is 160 |
| Split payment | Use two real allowed methods e.g. 60 + 40 on the 100 invoice, or 80 + 80 on 160; clearing transfer nets to one invoice |
| Normal + product stock | Service must not create retail stock outflow; retail quantities and movement ledger must decrement exactly once only when an actual product is sold |
| Retry same POST / same UUID / same user and branch | 200 replay original invoice ID; zero extra invoice, payments, cash, inventory, loyalty, voucher, handoff and notification side effects |
| Race two cashiers / two writers | Same UUID serialized; one COMMITTED sale. Different UUIDs referring same first-visit client cannot both get 50%, and the 20% voucher cannot be double-spent |
| Same UUID changed payload / actor / branch | HTTP 409 and no financial writes |
| Network outcome unknown / same-tab refresh | Browser reuses UUID. Explicit New Invoice asks cashier to reconcile uncertain previous save, never silently double-posts |
| Refund of referred source sale | Audited full refund reverses claim, preserves already earned 20% voucher per approved policy, restores cash/stock consistently |
| Refund of voucher-paid sale | Audited refund restores the *same* voucher, never issues another; payment and stock reconciled; repeat refund cannot duplicate |
| Tenant and branch authorization | Another tenant or branch cannot preview a customer, redeem reward, replay UUID or inspect ledger; anonymous legacy public endpoint returns 410 |
| Failure injection | Each deliberate failure before COMMIT rolls back invoice header/details/payment/cash/stock/request key/claim/voucher together |

**Hard gate:** Reviewers must capture actual SQL queries/counts and expected-vs-actual money for every test, not just CI mocks, schema smoke or screenshots. Verify cleanup for all synthetic invoice/customer/tenant rows and any outbox/stock/loyalty artifacts. Do not clean up by broad destructive queries against real tenants.

## Independent sign-off — pending
- **Financial/accounting reviewer:** validate net revenue, split payment clearing, CashMove uniqueness, 20% liability, employee commissions, inventory and both full refund paths. Record reviewer + evidence link and explicit pass.
- **Security reviewer:** inspect tenant/branch/user binding, unauthorized API requests, code ownership, OTP absence, legacy public endpoint disable, request-payload hash collision assumptions, concurrency and flags.
- **Operations reviewer:** validate POS on mobile/desktop, flags/client rebuild coordination, staff guidance for uncertain saves and rollback procedure.

Self-review by code author or CI green is **not** independent sign-off.

## Production migration governance (not authorized)
1. Choose a single final reviewed release candidate head **#248** (do not merge #245 first); all feature flags OFF, client/server idempotency flags OFF until same deploy.
2. Obtain trusted-control-plane **read-only PLAN** for **DRVO-023 and DRVO-024**, exact SHA, immutable manifest and checksum, applied history and unforeseen pending migrations. This is not a production APPLY.
3. Finance/security sign-off, approved backup reference, confirmation of rollback strategy, and explicit human **APPLY** approval. No agent-initiated production database writes.
4. Coordinate schema migration -> code/rebuild -> tenant flags -> staged cashier trial -> expand with reconciliation metrics. The idempotency client+server pair must be enabled together; enabling one alone intentionally fails closed.
5. If an error occurs, switch business flags OFF; do not drop tables or erase issued vouchers. Follow approved backup/forward-fix strategy and audit all recorded invoice request keys.

## Outstanding release blockers
- Verified **full real staging financial E2E** across both writers and concurrency.
- Independent financial/security review.
- Overall DRVO staging gate incl. DRVO-012/011, cleanup, final verify.
- Trusted production read-only PLAN and explicit independent approval for APPLY.
- Human-only merge/production deploy and coordinated flags. **No merge or production mutation from this PR.**

# Referral Phase 1 — tenant-owned schema and staff preview (#223)

## Scope and status

This change is **foundation only**. It does not turn on a 50% discount in POS, issue a 20% voucher, or generate live customer codes. It includes a paid-invoice code activation helper, but that helper is not wired to either sale writer. Existing public `/api/public/client/referral` is **not a trusted source** (it generates `CUT-{clientId}` without customer authentication). Do not expose it as a valid code or use it for checkout.

Previous pure promotion policy: [PR #222](https://github.com/tarek-saad-dev/casher/pull/222) (still unmerged when this work started). This PR is based independently on `main` per `AGENTS.md`; reconcile pure helper names when #222 merges.

## Permanent schema (DRVO migration 023)

- `dbo.TblReferralCustomerCode`: a permanent cryptographically random `CUT-{24 uppercase hex}` code, unique per `(TenantId, ReferrerClientID)` and `(TenantId, Code)`. `ActivatedAtUtc` remains null until a fully paid visit is confirmed in a future sale transaction.
- `dbo.TblReferralVisitClaim`: unique `(TenantId, ReferredClientID)` across **all statuses**. Composite tenant/client/code FKs prevent referral to a client in another tenant and force the specified code to belong to the specified referrer. Self-referral forbidden by CHECK.
- `dbo.TblReferralDiscountVoucher`: uniquely linked to one claim (one voucher maximum per qualifying referral), strictly 20%, with expiry/consumption/revocation fields and a tenant/client-consistent composite FK.

No fake seed records and no migration of legacy coin-based `TblClientReferral`/`TblReferralReward`. The internal `activateCustomerReferralCodeInSale(transaction, input)` helper verifies a tenant-owned, fully paid persisted sale, serializes issuance through the customer row (`UPDLOCK, HOLDLOCK`), and creates/activates one code inside the caller's transaction. It is **not called in the current checkout path**. The database's unique constraints are the final idempotency guard.

## Staff-only preview

`GET /api/pos/referrals/preview?code=CUT-{24 hex}&referredClientId={SQL int}`

- Requires `requireTenantSession()`; **only** the signed staff session contributes `TenantId`.
- Validates exact referral code shape and positive non-truncated SQL INT for referred customer.
- Validates tenant-owned referred client and tenant-owned code; never returns names/phones. Unknown customer and unknown/foreign code both return the same 404 response.
- Checks activation, paid previous referrer invoice, prior paid referred-customer invoice and **any** existing referred claim. Only successful settled `مبيعات` invoices with `GrandTotal > 0`, full payment, nonpositive PayDue and non-reservation `isActive='no'` count as paid history.
- Result has `previewOnly: true`; **no reservation, invoice mutation, token consumption, discount or rewards**. Before actual checkout, the sale writer must repeat the checks under locks and commit claim/payment/discount/reward together.
- Missing migration returns `503 REFERRALS_NOT_READY`, so merging API code before DB approval cannot silently enable anything.

## Safeguards & remaining prerequisites

1. Run migration via DRVO manifest and verify its checksum/unique indexes/FKs/trusted checks. `control` declares MEDIUM risk, short lock, **backup required**, and additive rollback.
2. Verify against `last132_agent` only; no direct production DB access. An opt-in, staging-authorized executor must run real SQL concurrency and rollback tests before PR is eligible for approval. The current `drvo-staging-gate.yml` PR trigger is limited to named branches and **skips this branch**; do not bypass its credential checks or use production credentials.
3. Before enabling in POS, **wire the new activation helper into both sale writers**, implement transactional first-visit 50% discount and claim, transactional 20% voucher issuance/redeem, idempotent reversal, and prevent voucher consumption on failed invoice. See [#221](https://github.com/tarek-saad-dev/casher/issues/221) and [#223](https://github.com/tarek-saad-dev/casher/issues/223).
4. Old unauthenticated customer loyalty endpoints (#92 / draft PR #93) remain blocked for public launch. Customer-facing referral page should be designed only after authenticated tenant-owned customer identity is available.

**Release gate:** keep PR draft; do not merge until required staging proof and migration approval. Never approve/mutate production schema from the agent.

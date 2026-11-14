# CUT CLUB — legacy reward redemption quarantine (C2)
Source issue: [#270](https://github.com/tarek-saad-dev/casher/issues/270).
Parent: [#243](https://github.com/tarek-saad-dev/casher/issues/243).
Sibling financial-write quarantine: [#264](https://github.com/tarek-saad-dev/casher/issues/264) / [PR #266](https://github.com/tarek-saad-dev/casher/pull/266).
Sensitive personal GET audit: [#269](https://github.com/tarek-saad-dev/casher/issues/269).

## Source-level risk / exact scope
The former public `POST /api/public/client/loyalty/rewards/[rewardId]/redeem` trusted the `clientId` query parameter rather than a verified client session, then prepared a `REDEEM` ledger entry and reduced the customer's Coins balance. Prior code used a timestamp in the idempotency key and generated a redemption code without persisting it; concurrent/idempotency semantics must be re-reviewed before the future authenticated replacement. This is a **source finding**, not proof of live exploitability.

This Draft candidate replaces that legacy POST and OPTIONS with a **generic 403**, `no-store`, no permissive CORS, no cookie, and no DB or business-service access. It cannot be enabled by an environment flag, staff session, body parameter, token or clientId. Public catalog GET and all booking/POS endpoints remain unchanged.

## Customer impact / release blockers
- If this endpoint is in use, actual reward redemption will stop until an authenticated replacement is available. Identify the customer-facing callers and support impact *without exporting PII*. The existing website has a `redeemClientReward` helper and `RewardsGrid` component, but this review has NOT demonstrated that the component is rendered on current live pages or that this API sees live traffic.
- Owner previously approved a temporary pause to **reward purchases and Mystery Box opening only**; this additional reward redemption pause needs **separate business approval** before rollout.
- Do not merge this standalone PR to main: merge triggers production deploy. Do not merge Casher #266 or website #49 until the coordinated VPS/customer-impact release gate is satisfied.
- Legacy personal GETs remain unauthenticated at source; no authenticated Wallet is authorized because of this patch.

## Staging + release acceptance (none of the live checks run)
- [ ] Latest-head CI/tests/build and independent security review
- [ ] Anonymous POST + OPTIONS return generic 403/no-store/no permissive CORS; forged clientId, cookies, token, URL rewardId and body cannot change this
- [ ] Synthetic staging: ledger, balance, voucher, stock remain unchanged; **do not use real accounts**
- [ ] Read-only aggregate traffic/source caller assessment and client messaging
- [ ] Replacement authenticated endpoint design covers tenant-owned customer/session, atomic balance locking, idempotent replay, persisted entitlements/refund workflow and negative cross-account tests
- [ ] Separate owner approval for redemption pause and exact PR release, with frontend compatibility and secure rollback plan

**No real Coins, production or staging database, OTP, voucher or customer information was read or mutated by the branch authoring.** Rollback to the prior anonymous mutating endpoint is **not** a safe default; require explicit security review and a secure replacement.

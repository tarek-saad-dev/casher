# Customer Referral Profile — Issue #237 (Staff POS)

**Status: DRAFT / feature OFF.** This is a read-only piece of the upcoming Cut Salon 50% / 20% referral system, not a live feature.

## User experience

1. Select an existing customer from the POS customer search on mobile or desktop.
2. With `NEXT_PUBLIC_POS_REFERRAL_PROFILE_ENABLED=true`, the small **كود الإحالة والمكافآت** button appears in the customer's card. It opens a popup, avoiding a tall panel in the mobile sticky header.
3. When staff opens the popup, the UI sends exactly one **GET** `/api/pos/referrals/customer-profile?clientId=...` with session cookies and `cache: no-store`. Customer switching remounts by `ClientID` and resets previous data. Closing cancels the lookup and clears the old profile. No POST/PUT/DELETE or voucher consumption is performed.
4. API session (not the browser query) determines `TenantId`. The service first checks the DRVO-023 schema and `TblClient` tenant ownership before reading permanent codes and aggregates; missing/foreign customer 404, schema missing 503, invalid ID 400, flag OFF 503, unknown failure generic 500. Responses are private/no-store.
5. A real `CUT-[24 hex]` code appears **only if** `TblReferralCustomerCode.ActivatedAtUtc` is non-null. The profile is read-only: it does not generate codes, allow manual overrides, or rely on the existing legacy `/api/public/client/referral` prototype, which currently generates static values and has a TODO for authentication.
6. Staff can copy the verified code and share it using the generic **WhatsApp chooser** (`wa.me/?text=...`). The message contains the code and an explicit eligibility caveat for the 50% first visit; **no customer phone, customer ID, private staff information or invented public redemption link**.
7. Aggregates come from the referral ledger: APPLIED claims (successful), REVERSED claims (refunded), total rewarded referrals, earned 20% vouchers, available unexpired ACTIVE 20% vouchers, USED vouchers. A refunded original sale does not revoke the already-earned reward. Counts are nonnegative safe integers and cross-checked.
8. A customer without an activated code sees **الكود لسه مش متفعّل** and a first-paid-sale explanation. There is no fake fallback code. The UI never displays stale data or offers sharing when loading fails.

## Feature switches

- Browser build: `NEXT_PUBLIC_POS_REFERRAL_PROFILE_ENABLED=true` (OFF by default).
- Server: `POS_REFERRAL_PROFILE_ENABLED=true` (OFF by default).
- Independent from `NEXT_PUBLIC_POS_REFERRAL_CHECKOUT_ENABLED`, `POS_REFERRAL_CHECKOUT_ENABLED` and reward redemption switches. Browser flag is not authorization; staff tenant isolation is always server-side.

## Dependencies and delivery

- This branch started from **unmerged draft #236** (`20a90e1b`), incorporating backend #232, #228 and migration #224. The POS 50% Apply (#230) and 20% Wallet UI (#234) are separate draft branches and are **not** yet reconciled into a single integrated application.
- No production DB access or changes. GitHub Actions staging-only and all other existing safety guardrails remain.
- Pending: human-controlled dependency merge/rebase, entire app integration with both POS wallet UI and new customer profile, tenant/branch E2E and a full real paid invoice on staging, financial/permission review, database migration approval and explicit human-controlled production rollout.
- Customer-facing OTP-authenticated public portal and admin reports are **not** part of this staff-only profile; the legacy public stub must not be advertised as a real customer portal.

## Tests

`customerReferralProfile.service.test.ts`: schema/flag guard, tenant ownership, permanent code activation, no fake code, refunded-reward counts, no mutations.

`customerReferralProfile.route.test.ts`: session required, ID validation, cross-tenant prevention, private no-store response and failure codes.

`posCustomerReferralProfile.test.tsx`: popup fetch only on open, valid code copy and WhatsApp share, no PII, incorrect/missing-code state, malformed response rejection, 503 fallback.

Included as a required dedicated step in the normal repository CI. No standalone financial transaction claim is made by these read-only tests.

**Agents never merge.** Main merge automatically deploys; leave this PR DRAFT until all release gates are met.

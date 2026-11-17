# CUT CLUB 2.0 — full product build track / verified member data + growth engine

Date: 2026-11-15. Owner specifically authorized use of the Production DB as an authoritative source. **We have GitHub repo access but no live SQL Server connection in this execution.** Therefore no database connection, production schema query, customer record access or DB mutation has actually occurred. This code runs only synthetic tests. Do not pretend otherwise.

## Business shape
Public: CUT CLUB landing, service catalog and booking accessible to everyone.
Private: after authenticated member ownership, show digital card, real tier, Coins, recent activity, voucher statuses, qualified visits, next booking and personal memberships.
Growth: campuses (schools/universities), doctors/healthcare, corporate partnerships, branch-specific agreements, versioned rules, visit challenges, referrals and in-salon experiences.
Finance: secure reward redemption, stock, mystery box, point spending, refunds, ledger/audit and idempotency. NO financial action before a reviewed end-to-end transactional engine.

## This code slice (#298)
- `memberReadCore.ts`: authenticates only against an authority-backed, persisted, revocable session, then checks tenant/customer ownership. Returns a tightly scoped personal DTO. Data reads never infer ownership from a phone, URL clientId or caller-body fields. Missing/duplicate/foreign accounts, invalid ledger, invalid session or API error fail closed. No voucher codes, customer phone or private notes copied to DTO. Buy/redeem/box actions always OFF.
- `sqlMemberReadSource.ts`: explicit mssql ConnectionPool adapter to existing `TblClient`, `TblClientLoyalty`, `TblLoyaltyTier`, `TblLoyaltyPointLedger`, `TblClientInventory`, `TblLoyaltyStoreItem`. Bounded TOP 20/25 ledger/vouchers, `@clientId` SQL parameters, repeated tenant/customer ownership check before EACH read. No pool initialized or network on import.
- `growthEligibility.ts`: versioned, tenant+partner+branch-scoped membership eligibility (school/university/medical/company), visit milestones with deduplicated qualified completion events, referrals with first-visit and duplicate-settlement controls. **Returns decisions only**; awardAvailable is always false because payments require idempotent durable transaction and budget signoff.
- `production-readonly-metadata.sql`: manually run, operator-reviewed schema-only SQL for actual production environment. Contains explicit verified DB guard and reads ONLY sys metadata. No customer rows, phone numbers, balances or writes. Owner's approval to use prod DB does NOT imply a query was executed or permit untested financial mutation.
- Tests: synthetic two tenants/two customer ownership, wrong/expired sessions, no action ability, PII/voucher privacy, invalid balance, versioned multi-branch policy, visit/reversal deduplication and referral controls, and production SQL safety. Required CI, build and code review before any integration.

## Critical source mapping gate
The repo's default cloud SQL config currently selects DB name from `CLOUD_DB_NAME` / `DB_DATABASE` (fallback `HawaiRestaurant`), which does NOT prove the live Production DB name. DRVO `Tenant.TenantId` is UUID; legacy client `TblClient.ClientID` is INT. No verified relationship between those identities in production exists yet. The SQL member adapter **requires injected `proveTenantCustomerOwnership`** and intentionally does NOT provide a permissive default or create a new API route.

## What MUST be implemented before a real member account
1. Verified tenant-to-legacy customer binding from an approved production schema inspection and non-PII staging fixtures.
2. WhatsApp one-time-code transport/provider, with durable rate limits, OTP verification and revocable session; user elected to DEFER delivery but not identity ownership.
3. Host-only cookie and website BFF with CSRF protections; website #61 policy is not a functioning route.
4. New Casher v2 private member GET endpoints, backed by the read adapter and server-derived identity; integration to website member components via strict DTO and safe loading/error/empty UX.
5. Transactional financial APIs: atomic balance+ledger+voucher/stock with idempotency, tenant-owner scope, concurrency, reversal and staff POS honoring.
6. Growth persistence and budget: membership organizations & proofs, policy versions, referral attribution, qualified events, anti-abuse, review-integrity controls and reporting projections.
7. Real end-to-end testing with synthetic identities on an authorized environment, preserved legacy Coins/voucher history and existing public booking/branches, coordinated old-route shutdown, VPS atomic deploy/rollback proof.
8. Separate exact-head owner Merge/Deploy approval. Production read permission is not approval to merge pending legacy quarantines.

## Suggested scalable data plan (not applied)
- CustomerAuth and Session are separate from loyalty money-like tables.
- `ClubOrganization` scoped to Tenant (type school/university/medical/company), status and verification policies.
- `ClubMemberAffiliation`: Tenant+Customer+Organization, proof/verifiedBy, start/end + consent.
- `ClubPolicyVersion`: Tenant+RuleScope+Version immutable, branch targeting and benefit conditions.
- `ClubEventInbox`: Tenant+ExternalEventId unique, qualifying completed visits and cancellation/reversal linkage.
- `ClubRewardSettlement`: Tenant+Customer+IdempotencyKey unique, immutable outcome; ledger and stock mutation inside same DB transaction.
- `ClubOutbox`: committed business events delivered asynchronously with retries/deduplication to analytics and notifications.
- Per-tenant/branch feature flags, consent, rate/budget caps and canary release.

## Current status
**Business architecture + read-model/growth policy prototypes, NOT full live CUT CLUB.**
No real customer PII, SQL read, Coins/voucher mutation, OTP send, merge or deployment in this branch.

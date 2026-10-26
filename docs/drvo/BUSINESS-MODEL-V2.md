# DRVO ERP — Modular Hybrid SaaS Business Model (Living Document V2)

> **Document ID:** DRVO-BUSINESS-MODEL-V2  
> **Version:** 2.0 — 2026-10-26  
> **Status:** APPROVED DIRECTION: **NO Starter/Growth/Pro TIERS**. Commercial charges, free allowance and implementation require separate validation/approval.  
> **Market:** Egypt · **Initial vertical:** barbershops and salons · **Next:** retail/supermarket packs  
> **Canonical commercial direction** for product design, onboarding, marketing and billing.  
> **Change policy:** edit this document in a reviewed PR before shipping changes; retain decision history.

## 1. What has been decided — do not reinterpret

**[DECIDED]** DRVO ERP will **not** sell fixed, named customer tiers `Starter`, `Growth` or `Pro` as its target business model. The earlier Starter/Growth/Pro feature matrix and proposed price ladders are superseded. Do not create new paid-feature restrictions, marketing cards, offer copy, checkout or payment plans based on those labels.

**[DECIDED]** Keep the overall **Hybrid SaaS** principles already chosen:
- A usable **14-day no-card free trial** at launch; the customer gets real work done with available, safe product paths.
- A **modular, pay-as-you-grow customer experience**: a business chooses the apps/workflows it actually needs, without an arbitrary prebuilt Starter/Growth/Pro tier.
- Transparent charges when the tenant expands to more operating locations or consumes costly services.
- WhatsApp, AI, SMS and similar usage-cost features never receive unlimited unpriced consumption by default.
- Optional, clearly priced guided setup / data migration / training services.
- **Free Forever remains an experiment, NOT a live or guaranteed launch offer.** A useful single-app free offering is a candidate once operating economics justify it.
- Correct accounting, tenant isolation, security, core operational dependencies, data preservation and safe export are mandatory. Never premium-gate financial correctness.

**[UNDECIDED]** The precise **billing unit** (base platform fee vs individual paid apps vs paid feature modules or a hybrid), the free app eligibility/limits, commercial app prices, included branch/operator quotas, usage tariffs, annual savings and tax/refund policy. These are **not invented by this document**; the modular charging framework below is a **design candidate**, not a signed-off invoice schedule.

## 2. Customer journey (target)

1. **Select industry** (salon first; supermarket later). Industry Packs preselect sensible apps and essential dependencies without locking the business into a paid tier.
2. **Select needed apps** from a simple app marketplace/catalog. Installation = technical availability, **not proof of payment**.
3. **Start 14-day free trial** with explicit limits on real-cost APIs, and create a real booking/invoice/shift as supported.
4. **View one transparent quote** composed from the selected paid apps/capabilities plus locations/usage as applicable. Show monthly and yearly totals and what is included. Do not invent charges for mandatory dependencies.
5. **Pay through a verified payment flow** (provider not chosen yet). Until payment verified, the previous subscription/access state remains truthful; requesting a quote is not activation.
6. **Adjust apps later**. Upgrades and added paid components are priced transparently; removal/downgrade follows approved effective-date and refund policies. Never delete historical business data.
7. When a real-cost limit is approached, show actual quota/consumption and an explicit choice. No hidden costs, no surprise invoices.

**Operational prerequisites:** installed app + tenant/branch ownership + commercial entitlement (where applicable) + safe active subscription. Each is a different concern. The system must not use app install/uninstall to pretend a paid entitlement was granted or revoked.

## 3. Proposed modular billing mechanics (not yet priced or approved)

We should test the following building blocks against 15–20 salon owners and direct service costs before choosing a final formula:

| Component | Proposed customer-facing treatment | Status |
| --- | --- | --- |
| **Platform Core** | Identity, tenant, catalog, role safety, data/export, invoice/financial integrity, essential infrastructure must work without separate add-on purchases | Principle decided; commercial base fee TBD |
| **Product Apps** | Customer chooses operational apps such as Booking, POS, Queue, Attendance, Payroll. Evaluate charging by selected app or value-creating advanced capability | Pricing **TO VALIDATE** |
| **Must-have dependencies** | e.g., purchasing requires inventory in code; dependency activation/pricing must be explained once, with no surprise duplicate charge | Principle decided, price allocation TBD |
| **Advanced capabilities** | Distinct paid capabilities, if research supports them, can be sold without forcing broad fixed named tiers | Pricing / gating **TO VALIDATE** |
| **Additional branches** | One clear included amount and optional add-on charge per extra active location; avoid unbounded branch economics | Quantity/rate **TO VALIDATE** |
| **Operators** | Do not charge per employee record, barber, customer, or view-only employee-portal login. Define billable active operational/admin seat only if customer value and costs justify it | Definition/rate **TO VALIDATE** |
| **AI / WhatsApp / SMS** | Standalone add-on and/or transparent prepaid/included usage with caps, unit costs and abuse controls | Commercial availability **HOLD** |
| **Onboarding / migrations** | Optional one-time priced service; customer can still self-serve without paid assistance | Service list decided; rate **TO VALIDATE** |
| **Free Forever** | Hypothesis: one genuinely useful baseline app with small clear quotas/support limits | **DEFERRED / NOT LIVE** |

**No fixed monthly prices, bundles or formulas have been approved in V2.** Research price bands from the historical documents are not current offers. The yearly 10-for-12 idea must also be validated against margins.

### Example scenario (illustration only, not a quote)

A one-branch salon chooses **Booking** and **POS**, and later adds **Queue** and **Payroll**. Its monthly invoice *might* reflect paid app access, approved location add-ons and explicit messaging/AI consumption. A one-branch retail shop could choose POS + Inventory instead. **We have not decided which specific app is free, paid or included, nor its price.**

Avoid building pricing that makes it commercially impossible to use one app safely without accidentally purchasing hidden infrastructure. Basic customer records, services/categories, security and invoice posting cannot be independently paywalled.

## 4. Trial vs permanent free

| Question | Current target decision |
| --- | --- |
| Free trial? | **Yes: 14 days, no credit card.** |
| Trial is usable? | **Yes**, for ready and enabled workflows; cost-generating integrations require explicit limits. |
| One App Free Forever, like Odoo? | **Research candidate only. NOT APPROVED for launch.** |
| Automatic payment or paid activation after the trial? | **No without verified payment.** |
| Does an expired trial delete records? | **Never.** Safe billing/recovery and data export paths must be designed. |
| Can they downgrade without losing data? | **Target: yes.** Preserve old records, correctly restrict future premium actions only. |

Free Forever must pass cost-per-free-tenant, support load, conversions, abuse/quota, and upgrade testing before a public launch decision.

## 5. Salon Pack: audited apps and commercial availability

Source audit: [Salon Feature Inventory V1](./SALON-FEATURE-INVENTORY-V1.md) and `src/packs/salon/manifest.ts`.

| App / workflow | Current pack / code evidence | Availability for new customer | V2 monetization |
| --- | --- | --- | --- |
| Booking | Required salon app; internal + hosted public booking surfaces | Staging proof required; public publication opt-in | Price / future free status TBD |
| Queue | Recommended app; live queue, ETA and operations surfaces | Staging proof required | TBD |
| POS | Recommended app; sales, invoice/shift paths | Staging and finance reconciliation required | TBD |
| Attendance | Recommended; HR APIs and UI | Staging smoke before commercial promise | TBD |
| Payroll | Recommended; ledger/salary/commission API surfaces | Staging money-path proof before commercial promise | TBD |
| Treasury & basic accounting | Recommended app plus platform financial infrastructure | Posting/closing safety always on; advanced views may be separately valued | Core safety free of arbitrary optional-app charges |
| Reports | Recommended; daily/monthly/employee/partner report surfaces | Differentiate core daily view vs separately verified advanced reporting | TBD |
| Inventory | Optional; branch inventory API | Incomplete independent UX/E2E evidence; **HOLD** for full app marketing | TBD |
| Purchasing | Optional; depends on Inventory | API exists, end-to-end proof **HOLD** | TBD |
| Loyalty / CUT CLUB | Legacy-only `CASHER_BOOT` | **NOT SELLABLE** to new tenants until properly isolated | N/A |
| WhatsApp messaging / AI receptionist | Apps / tenancy implementation exist but self-service unavailable | **NOT SELF-SERVICE SELLABLE** before channel + metering + reliability approval | Costed add-on TBD |

**Code existence, an installed app and successful tenant E2E are distinct things.** Never describe an `installed_unverified` app as ready. The Salon feature inventory is **still valid as a technical audit**; only the former tier column assignments are obsolete.

## 6. Today’s code is NOT yet this target model

**[CURRENT CODE as checked 2026-10-26]**

- `src/platform/commercial/pricingCatalog.ts` hardcodes public plan codes `starter`, `growth`, `pro`, with monthly EGP 499/899/1,499 and yearly EGP 4,990/8,990/14,990. This is **legacy implementation state, not current strategy approval**.
- `dbo.SaaSPlan` / `dbo.TenantSubscription` and `src/platform/commercial/limits.ts` enforce branch/user capacity and subscription lifecycle; legacy caps 1/3/10 branches and 5/20/75 memberships, not per-app metering.
- `TenantAppEntitlement` and the Industry Pack manage app installation separately from plan changes.
- `/admin/billing` / `/api/tenant/billing` and operator request queue (former PR #118) accept requests for the old named plans. **These are manual review only, not payments**. They must be redesigned before marketing or collecting money under V2.
- Current platform can still expose old plan labels until a separately approved migration/rollout. **Do not delete plans/rows/keys or rename an existing customer’s subscription to implement V2.**
- `CASHER_BOOT` / Cut Salon is grandfathered internal/active: no repricing, no forced migration, no destructive app changes.
- Feature entitlements per paid capability, price versioning, metered overages, checkout, provider verification, refunds and periodic reconciliation are not implemented merely by adopting this document.

### Delivery safety

No database migration, runtime code change, change to customer subscription, live feature restriction or external price publication is authorized by this docs decision alone. Preserve existing paid obligations, audit trails and historical records. If old signup or billing UI offers outdated Starter/Growth/Pro pricing, treat that as an **implementation backlog issue to fix before new commercial launch**, not a reason to mutate production immediately.

## 7. Business and product validation (required before charging)

Interview **15–20 Egyptian salon owners** (solo, team, multi-location) and then retail owners separately. Ask what concrete job they value and which combinations they'd actually buy.

Experiments to compare rather than pre-decide:
- A small **base subscription plus optional app modules** vs **per-paid-app pricing** vs **paid feature add-ons**; account for dependency cost and price comprehension.
- 14-day all-safe-functions trial, possible useful single-app Free Forever, and clear value from paid conversions.
- Price for one operational location + additional branches; active operational user vs employee record.
- At least 2–3 real app combinations, real pay-now intent, and affordable annual terms.
- Cost to serve each tenant (DB/backup/hosting/operations, payment gateway, support), AI/WhatsApp/SMS costs.

Track activation (first real booking/sale), trial-to-verified-paid, MRR/ARPA, free-to-paid (if Free ships), retention/churn, gross margin, CAC/payback and expansion revenue.

**No final charging formula or free entitlement list until there is a written evidence review and owner approval.**

## Current commercial transition implementation (2026-10-26)

The active work-in-progress **modular-pricing research prototype** is described in [Modular Pricing Research V1](./MODULAR-PRICING-RESEARCH-V1.md). Its versioned per-app and base-plus-app scenarios are **unapproved assumptions**, and the old customer-facing plan selection is closed while preserving historical subscriptions. This is not checkout and does not activate commercial entitlements.

**Commercial schema foundation (shadow-only):** see [Modular Commercial Draft Foundation](./MODULAR-COMMERCIAL-DRAFT-FOUNDATION.md) for migration 015 and its explicitly non-paying/non-authorizing tables. It must not be treated as subscription activation.

## 8. Implementation roadmap — after commercial approval

1. **Confirm V2 charging unit and candidate pricing** with customer research, cost model and founder signoff.
2. **Catalog & quoting model**: versioned app/capability pricing (not named plan codes), branch add-ons, calculated server-side line items, taxes/currency and effective dates, dependency billing policy.
3. **Commercial entitlement isolation**: installed app, paid app/capability, branch allowance and metered balance resolved server-side from authoritative tenant context. Feature checks must live in domain/API boundaries, not only in UI.
4. **Trial, free, expired and grandfather contracts**: safe read/export; never lose invoices; no bypass via legacy endpoints; Cut Salon non-regression.
5. **Provider payment integration**: authenticated callbacks, anti-replay/idempotency, exact amount/currency/tenant/quote reconciliation, receipts/refunds, renewals. Client redirect/plan request never equals paid.
6. **UX**: single uncomplicated selected-apps screen and one clear total, not Starter/Growth/Pro cards; explain usage and add-ons before charging.
7. **Staging two-tenant E2E** and commerce acceptance, then controlled rollout, monitoring and rollback.

## 9. Open commercial decisions

| ID | Decision / question | Status |
| --- | --- | --- |
| MB-01 | Exact charge unit: base + apps vs per-app vs capability | OPEN — product research |
| MB-02 | Which apps included/free; any baseline platform fee | OPEN |
| MB-03 | Prices (EGP), taxes, annual terms and discounts | OPEN |
| MB-04 | Included branches and extra-location price | OPEN |
| MB-05 | Billable operator definition and caps | OPEN |
| MB-06 | Future Free Forever design and launch threshold | DEFERRED |
| MB-07 | AI/WhatsApp/SMS quota and provider costs | HOLD |
| MB-08 | Payment provider, refunds, proration, grace, reconciliation | OPEN |
| MB-09 | Legacy plan → V2 migration and customer grandfather policy | HOLD until terms approved |
| MB-10 | Paid-capability and per-app readiness gates | OPEN, staging evidence |

## 10. Reference documents and supersession

- [Business Model V1](./BUSINESS-MODEL-V1.md) — **SUPERSEDED commercial strategy**, retains historical 3-tier assumptions for audit context only.
- [Salon Pricing & Feature Matrix V1](./SALON-PRICING-FEATURE-MATRIX-V1.md) — **SUPERSEDED tier/price packaging**, not a product requirement.
- [Current Commercial Pricing V1](./COMMERCIAL-PRICING-V1.md) — **legacy runtime/catalog snapshot**, not approved V2 sales offer.
- [Salon Feature Inventory](./SALON-FEATURE-INVENTORY-V1.md) — technical source audit still usable; re-review at each release.
- [DRVO-012 commercial implementation](./DRVO-012-IMPLEMENTATION-NOTE.md) — historical technical design, not V2 commercial authority.
- External benchmark starting points: https://www.odoo.com/pricing ; https://loyverse.com/pricing ; https://erpnext.com/ . Recheck current details before public comparison.

### Change log / decision history

| Date | Version | Decision | Scope |
| --- | --- | --- | --- |
| 2026-10-26 | 2.0 | Founder explicitly rejected Starter/Growth/Pro as target commercial tiers and chose a modular Hybrid SaaS direction. Exact app pricing formula **remains open**. | **Docs / business direction only**; no live commercial change |

### Change control

Any change to this document requires a reviewed PR: update date/version, evidence, customer effects, legacy migration implications, related marketing/code docs and acceptance gates. Never silently reinterpret a research hypothesis as an approved contract.

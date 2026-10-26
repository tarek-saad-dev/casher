# DRVO ERP — Business Model & Pricing Strategy (Living Document)

> **Document ID:** DRVO-BUSINESS-MODEL-V1  
> **Version:** 1.0 · **Last reviewed:** 2026-10-26  
> **Status:** APPROVED STRATEGIC DIRECTION · pricing/limits/feature matrix are **hypotheses pending validation**  
> **Primary market:** Egypt · **Initial vertical:** salons/barbershops · **Later vertical:** small retailers/supermarkets  
> **Owner:** DRVO product/business · **Review trigger:** new field evidence, major cost change, launch milestone, or approved pricing decision.

## 0. How to use this document

This is the **canonical living source of truth for the TARGET commercial model**, not a claim that the application already enforces it.

- `[DECIDED]`: founder-approved business-model direction. Do not silently contradict.
- `[TO VALIDATE]`: proposed price, product packaging, capacities, or implementation detail; not a public promise.
- `[CURRENT CODE]`: how the repository behaves *today*; this may differ from the target and must not be misrepresented.
- `[GATE]`: criterion that must pass before rollout.

**Important distinction:** approval of the Hybrid SaaS direction is **not** authorization to charge customers, turn on free-forever accounts, change legacy tenant subscriptions, or deploy feature restrictions. Those changes each need a separate approved plan, testing and migration.

Related documents:
- [Salon Pack feature inventory (source-backed audit)](./SALON-FEATURE-INVENTORY-V1.md)
- [Salon Pricing & Feature Matrix (proposed; not implemented)](./SALON-PRICING-FEATURE-MATRIX-V1.md)
- [Current, implemented V1 commercial pricing](./COMMERCIAL-PRICING-V1.md)
- [DRVO-012 subscription + app installation model](./DRVO-012-IMPLEMENTATION-NOTE.md)
- [Platform decision register](./DRVO-002-DECISION-REGISTER.md)
- [Public self-service app selection](./AGENT-4-PLATFORM-PUBLIC-APP-SELECTION.md)

## 1. Positioning & who we sell to

**[DECIDED]** DRVO ERP is a modular SaaS that lets small businesses run core operations and expand into more valuable workflows over time. Start by selling a **salon operating system** with a credible, practical workflow; do not position day-one sales as “ERP for every industry.”

**Target first buyer:** Egyptian salon/barbershop owner, starting with a single operating branch, who needs booking, POS, queue and an understandable view of daily results. Expand to salon teams and multiple branches, then retail/supermarkets via their Industry Pack.

**Value proposition:** fewer disconnected tools; reliable day-to-day sales/booking/team workflows; one customer/account; clear activation and onboarding; optional advanced operations without forcing every customer to pay for complexity.

**Not our promise:** cheapest POS everywhere, free unlimited hosting/support, or fully automated WhatsApp/AI at zero usage cost.

## 2. Business-model decision

**[DECIDED] HYBRID SaaS**:
1. **14-day no-card free trial at launch** with a usable, end-to-end experience for the available business workflow; no fake demo-only trial.
2. **Paid Starter / Growth / Pro** tiers whose main differentiator is **value delivered / capabilities unlocked**, not merely a different employee count or an arbitrary number of visible buttons.
3. **Predictable expansion pricing** for extra operating branches and, where genuinely necessary, substantial extra active operator seats.
4. **Separately metered or priced variable-cost services** (WhatsApp, SMS, AI usage, similar external APIs); no unlimited costly usage bundled by default.
5. **Optional one-time services** (guided setup, legacy data migration, training), clearly separate from recurring software.
6. **Free Forever: strategic candidate, NOT launch commitment.** Introduce only after measured economics. The likely design is one useful basic app per tenant with firm resource/support limits.

**[DECIDED]** Do not meter every employee record, barber, read-only employee portal login, or normal historical data export as a paid “seat”. Define a **billable operator seat** separately from a workforce record / customer / view-only employee identity.

**[DECIDED]** Security, financial correctness, tenant isolation, backups/data export rights and reliable historical record preservation are not upsell features.

## 3. Trial and Free Forever

### Launch: 14-day trial [DECIDED direction]

- No card required at signup.
- Trial uses real data and real permitted business operations, not a crippled mock UI.
- Industry-specific ready apps can be selected without promising unreleased messaging/AI services.
- Variable-cost APIs are excluded or given small explicit quotas and abuse/rate limits.
- Show remaining time, the next step and paid options; make the “trial → paid” path understandable.
- Expiry never deletes historical invoices/bookings/workforce records. Keep a safe path to billing, support and export consistent with data-retention rules.
- When trial expires and payment is unverified, **do not automatically grant paid access**.

### Free Forever: controlled experiment [TO VALIDATE / NOT YET SHIPPED]

Proposed examples:

| Vertical | Free core capability hypothesis | Restrictions to test |
| --- | --- | --- |
| Salon | One useful Booking app | 1 branch, small active operator/team scope, basic reporting, no cost-generating automation |
| Retail | Basic POS app | 1 branch, small operator scope, basic reporting, no paid integrations |

- One practical core app can depend on shared platform functions; dependencies should never cause surprise charges.
- A “free” product must complete a meaningful job. Do not make it unusable merely to force conversion.
- Anti-abuse measures, fair-use limits, inactive-account policy, support costs and tenant isolation must be measured **before** launch.
- A trial-to-Free downgrade, if introduced, must only restrict paid features; never destroy data. Existing records and safe export remain available.
- **[GATE]** Approve Free Forever only after per-tenant cost, free-to-paid conversion, support and anti-spam observations justify it. Until then: trial + paid only.

## 4. Proposed pricing & capabilities — hypotheses, not yet approved for sale

**[TO VALIDATE]** Egyptian market **monthly pricing research bands**:

| Package | Monthly hypothesis | Intended customer | Primary reason to upgrade |
| --- | ---: | --- | --- |
| Free (future) | 0 EGP | individual / microbusiness | baseline entry, not a full ERP |
| Starter | 499–699 EGP | single-location business | integrated basic day-to-day operations |
| Growth | 899–1,299 EGP | business with staff / deeper processes | workforce, finance/stock and deeper operational reports |
| Pro | 1,499–2,499 EGP | mature or multi-location business | consolidated oversight, advanced permissions/integrations |

These are **test ranges**, not effective prices. Do not hard-code, advertise or invoice using them without validation and an approval record.

### Proposed salon packaging examples [TO VALIDATE]

| Capability | Free (future) | Starter | Growth | Pro |
| --- | --- | --- | --- | --- |
| Booking basics | Yes, limited | Yes | Yes | Yes |
| POS + queue basic operations | — | Yes | Yes | Yes |
| Daily operational reporting | Basic | Core | Detailed | Consolidated |
| Staff attendance & payroll advanced workflows | — | — / simplified only | Yes | Yes |
| Inventory & purchasing advanced workflows | — | Optional/upgrade | Yes | Yes |
| Multi-location rollups | — | — | Upgrade/add-on | Yes |
| Advanced permission controls / integrations | — | Standard safety roles | Selected | Extended |

**Packaging rule:** a tenant **installing an app** is different from the tenant being **entitled to a paid advanced capability within that app**. The Industry Pack is a recipe for modules; the commercial tier is a source of feature/capacity entitlements. Do not conflate these concepts in the DB or on the UI. All trial/free/paid availability must have authoritative server-side enforcement and accurate UI explanation.

**Retail/supermarket** needs its own Starter/Growth/Pro matrix after research and testing; do not copy salon assumptions blindly.

### Annual and branch pricing [TO VALIDATE]

- Candidate yearly offer: pay for **10 months, receive 12** (two months free) — verify gross-margin sustainability.
- Charge additional branches transparently. **Do not treat 10 branches as “free forever” just because Pro includes a 10-branch technical limit.**
- Choose an explicit included branch count by tier, then an approved monthly amount for each extra location. The amount is **not yet decided**.
- A team record or employee portal read-only identity is not a billable seat. An actively operating admin/POS identity may be subject to generous and clear fair-use/seat tiers, subject to validation.
- Usage-based add-ons need visible included units, caps, overage rates and customer consent; no silent unlimited AI usage.

## 5. Current code vs. target strategy: DO NOT CONFUSE

**[CURRENT CODE as reviewed 2026-10-26]**

| Area | Existing implementation | Proposed target / next decision |
| --- | --- | --- |
| Public plans | `starter`, `growth`, `pro` | Keep names initially, redefine and validate package value |
| Posted/catalog prices | 499 / 899 / 1,499 EGP monthly; 4,990 / 8,990 / 14,990 annual | These are legacy/current *catalog* prices, not founder-approved future feature-based matrix |
| Plan scope | Controls capacity (branches/users) and subscription lifecycle | Add explicit capability entitlements, then capacity/add-on policies |
| Existing capacity seeds | Starter 1 branch / 5 users; Growth 3 / 20; Pro 10 / 75 | Review included branches, operator-seat definition and price per extra branch |
| Installed apps | Industry Pack + TenantAppEntitlement, independent from plan changes | Retain module installation separation; add a distinct paid-feature gate |
| Signup | Trial defaults to Starter, typically 14 days | Keep 14-day no-card trial; improve conversion & trial exhaustion UX |
| Trial expiry | Existing subscription access gate may block product routes | Preserve safe billing + export/recovery path; do not drop records |
| Collection | Historically manual/operator managed | Payment-provider integration after pricing policy approval |
| Self-service plan requests | PR [#118](https://github.com/tarek-saad-dev/casher/pull/118) remains a separate implementation/review track | A plan request is **not payment**, not an activation and not the canonical pricing decision |
| Free Forever | Not implemented | Explicitly gated experiment; no unreviewed launch |

**Cut Salon / `CASHER_BOOT` grandfather protection:** keep legacy live operations and existing paid/operational state unchanged. Do not automatically migrate or re-price the bootstrap tenant. Any feature-gate changes must have tenant-isolation, compatibility and rollback verification.

## 6. Subscription life cycle & payment invariants

**[DECIDED principles]**
- A submitted plan request, screenshot, redirect success page, “payment initiated” or untrusted client callback **must never activate** a subscription.
- Only a **trusted verified provider transaction / reconciled operator approval** can make a paid entitlement active; payment reference, amount, currency, correct tenant, replay/idempotency and audit must be checked.
- Payment method/provider selection is an implementation decision still open.
- An **upgrade** should apply immediately **after verified payment and explicit price calculation**; an eligible **downgrade** should take effect at the next renewal boundary, not delete the current period’s benefits.
- Cancellations, grace periods, failed renewals and refunds must be distinguishable from “paid”.
- Do not confuse `request_received`, `awaiting_payment`, `paid`, `active`, `past_due`, `cancelled` in UI, accounting or logs. These are distinct commercial vs subscription lifecycle concepts.
- Retain immutable payment/refund/audit records and the tenant's historical operational data; follow documented retention/export/access policies.

**[TO DESIGN]** proration, VAT/tax invoicing, refund windows, grace length, reactivation rules, and exactly which capabilities remain accessible after downgrade/cancellation. Do not invent policies in the payment integration.

## 7. Unit economics: do not sell a loss leader accidentally

For each tier and add-on, record these **real monthly per-tenant direct costs**:

- Hosting/compute/storage and backup overhead.
- Payment gateway fees/failed payment/reconciliation cost.
- WhatsApp/SMS/AI/token and other API variable consumption.
- Onboarding and ongoing support time, in cost per account.
- Refund/chargeback or operational servicing costs.

Key metrics to follow:
1. **Activation:** % trial accounts completing a meaningful real booking or sale.
2. **Trial → Paid conversion:** % eligible trials becoming verified paying customers.
3. **Retention and churn:** monthly paid account survival and reasons for cancellation.
4. **Gross margin:** `(recognized subscription + add-on revenue - direct cost to serve) / recognized revenue`.
5. **ARPA**, **CAC** and **payback period** when sales spending begins; expansion revenue per location.

**[GATE]** Free Forever, yearly discounts, included branch count and uncapped features require observed costs — *never assumed margins*.

## 8. Research/validation protocol

**Initial research:** interview **15–20 Egyptian salon owners** (mix of solo, small staff, multi-location). Later run separate retailer interviews.

Ask:
- What tool/process do you use today? What costs time, lost sales or money?
- Which workflow would make you switch? Which product must work perfectly on day one?
- What actual price would you agree to **pay now**, and for which exact outcome? Capture real purchase intent, not just a “reasonable price” opinion.
- What would make you pay for Growth/Pro? Extra site? Payroll? Stock? Financial oversight?
- What does it cost you to migrate, train the staff, and maintain internet/technical support?

Test candidates (not final commitments): 14-day trial onboarding, baseline paid Starter, candidate Growth/Pro capabilities, annual discount, branch add-on, and optionally a free single app.

**Required output before public pricing release:** evidence summary, package matrix, included locations/seats, overage/add-on rates, cost model, final price approval, rollout/rollback plan and UI copy consistency review.

## 9. Rollout roadmap and commercial gates

| Stage | What ships | Exit gate |
| --- | --- | --- |
| 0. Preserve existing workflow | Keep current trial and installed-app architecture; maintain existing commercial behavior | No Cut Salon/other tenant regressions |
| 1. Validate business model | Owner interviews, pricing experiment, segmentation, cost calculations | Owner approves **effective** package matrix and rates |
| 2. Commercial entitlements | Define paid feature flags separately from installed apps; prove server-side gates | Cross-tenant tests, downgrade/data-preservation tests and UX review |
| 3. Payments | Select provider; verified payments, idempotent events, receipts/refunds, renewal handling | End-to-end sandbox + settlement reconciliation |
| 4. Self-service activation | Signup → select apps → trial → paid checkout → onboarding → dashboard | Staging acceptance incl. expired trials and failed payments |
| 5. Free Forever experiment (optional) | One core app, bounded support/resources, anti-abuse | Measured unit economics and leadership approval |
| 6. Expansion | Branch add-ons, more industries, AI/WhatsApp products | Unit economics and support capacity positive |

**Do not** implement Stage 2 restrictions or Stage 3 charging solely because this document has an approved strategic direction.

## 10. Research benchmarks (pattern only, not imported pricing)

Reviewed conceptually in Oct 2026: Odoo's one-app-free/per-user paid suite; Loyverse's free basic POS and charged advanced features; ERPNext's open-source/self-hosted versus paid hosting; Booksy/Fresha's trial and salon-focused paid operations; Egyptian regional accounting/POS vendors (Wafeq, Daftra, Foodics). Their promotions, currencies and included limits change and require rechecking before citing publicly.

Primary reference sites: https://www.odoo.com/pricing · https://loyverse.com/pricing · https://erpnext.com/ · https://www.zoho.com/one/pricing/ · https://www.booksy.com/ · https://www.fresha.com/ · https://www.daftra.com/ · https://www.wafeq.com/ · https://www.foodics.com/

## 11. Decisions still open / change register

| ID | Question | Status | Required evidence/owner |
| --- | --- | --- | --- |
| BM-01 | Exact Starter/Growth/Pro prices | OPEN | owner + interviews + margin |
| BM-02 | Exact features by tier / retail matrix | OPEN | product + implementation feasibility |
| BM-03 | Number of included branches and location add-on price | OPEN | cost + target customer |
| BM-04 | Who counts as billable operator and seat limits | OPEN | usage + UX |
| BM-05 | Free Forever rollout timing, app and quotas | DEFERRED | per-tenant economics |
| BM-06 | Annual discount and refund/grace/proration rules | OPEN | margin + payment policy |
| BM-07 | AI/WhatsApp included quotas and overage | OPEN | supplier costs / anti-abuse |
| BM-08 | Payment provider, fees, accounting/tax invoicing | OPEN | verification + compliance |

### How changes are made

1. Update **this file first** in a reviewed PR and edit the status/date/version.
2. State what changed, why, expected business impact and source/evidence.
3. Update affected docs, marketing copy, pricing catalog, entitlements, DB migrations and tests only **after** approval.
4. Keep existing customers protected; identify whether a migration or grandfather rule is required.
5. Document release/rollback and verify no claims of “paid” without verifiable payment.

### Change log

| Date | Version | Change | Approval |
| --- | --- | --- | --- |
| 2026-10-26 | 1.0 | Adopted Hybrid SaaS direction: 14-day no-card trial, value/feature-oriented paid tiers, branch expansion, variable-cost add-ons; Free Forever gated to later experiment. Price bands and exact gates remain hypotheses. | Founder-approved direction in project discussion; no code or price change authorized |

# DRVO ERP — Modular Pricing Research & Safe Transition (V1)

> Date: 2026-10-26 · Status: **RESEARCH ONLY**. This document does not approve, advertise or launch tariffs.  
> Owner direction: [Modular Business Model V2](./BUSINESS-MODEL-V2.md) — **no fixed Starter/Growth/Pro tiers**.  
> Prototype route: `/platform/modular-pricing` (platform operators only).

## 1. What changed in this implementation

- **Public landing `/drvo`** no longer shows Starter/Growth/Pro or legacy subscription prices. It explains choosing apps with a 14-day free trial and honestly states that final prices are being prepared.
- **Tenant `/admin/billing`** no longer advertises/selects deprecated tiers; it shows actual subscription status and historical plan request records and links to the app manager when commercial access is active.
- **`GET /api/tenant/billing`** remains authorized to tenant admins, including expired-trial admins; no longer lists obsolete purchasable plans; returns `commercialModel: modular_transition`, `newPaidRequestsEnabled: false`, `paymentMode: no_checkout`. Existing subscription and requests are unchanged.
- **`POST /api/tenant/billing`** returns `409 LEGACY_PLAN_REQUESTS_CLOSED` after authenticated tenant-admin check. This endpoint has **no writes** and cannot submit new legacy-plan requests, invoice, accept payment, or activate a subscription.
- Previously submitted requests remain readable and may still be reviewed by authorized operators; this release does not auto-refund, auto-cancel, reprice, or auto-approve them.
- **`/platform/modular-pricing`** is a platform-operator-only internal sandbox. Its `POST /api/admin/platform/modular-pricing-preview` calculates server-side **research scenario math only**, never a customer quote or stored order.
- No DB migration, payments, new feature gates, or changes to current existing tenant subscription records. `CASHER_BOOT` stays protected.

## 2. Versioned pure quote engine (second phase)

**[Implemented in this stacked PR]** The generic `src/platform/commercial/modularQuoteEngine.ts` now underpins the research tool instead of doing amounts in scattered UI or route code:

- A server-owned catalog identifies **catalogId + version + research_only state + EGP**; only the operator preview selects it.
- Prices are in **integer piasters** (not floating-point EGP), with overflow rejection, an explicit research-only currency, deterministic app ordering and exact line-item totals.
- **Required apps / dependencies** must be present, and unsupported or HOLD apps are rejected rather than silently priced at zero.
- Supports one included branch plus separately itemized extra branches; a candidate **base platform fee** is a separate line, never hidden in another app price.
- Annual scenarios use a catalog-defined number of paid months; tax, payment gateway fees and usage-based services are explicitly excluded (not assumed zero).
- A pure **before/after comparison** reports difference and app additions/removals, but **does not prorate, change entitlements, collect payment, or guarantee a refund**.
- The existing operator-only preview continues to return `canCheckout:false`, `canActivate:false` and does not expose a customer-payable quote.
- Two unapproved strategy hypotheses are internally selectable: **per-app (0 base)** vs **base 149 EGP + app unit rates reduced by 20%**. These are for founder/customer research, not executable offers.

Engineering scope: **no database tables or migrations**, no commercial entitlement enforcement, no payment/refund/checkout code, and no changed tenant subscriptions or app installation. Existing legacy pricing stays for compatibility; it is *not* a V2 tariff.

## 3. Research hypotheses and price assumptions (NOT APPROVED)

**Candidate pricing logic to validate:** no separate platform base fee, one app charge per tenant, first branch included, modest additional branch charge, metered third-party services as separate add-ons. No promised Free Forever at launch; 14-day no-card trial remains the decided launch entry.

| Research module (salon) | Illustrative monthly EGP | Readiness |
| --- | ---: | --- |
| Booking | 199 | Source exists; E2E validation needed |
| POS | 299 | Source exists; finance validation needed |
| Queue | 99 | Source exists; E2E validation needed |
| Attendance | 99 | Source exists; staging proof needed |
| Payroll | 199 | Source exists; staging proof needed |
| Treasury advanced analysis views only (not core financial posting/closing) | 99 | Source exists; core financial safety cannot be separately blocked |
| Reports advanced (not basic daily sales) | 149 | Source exists; validate tenant report correctness |
| Extra active branch (after first) | 199 | **Research-only expansion assumption**, not effective cap |
| Inventory, Purchasing | **Not priced** | On hold pending sellable E2E |
| Loyalty / CUT CLUB | **Not priced** | Legacy-only for CASHER_BOOT |
| Messaging / WhatsApp / AI | **Not priced** | Not available to new tenants, cost controls needed |

**Commercial example:** Booking + POS + Queue → **597 EGP/month assumed**; with 3 branches → 995 EGP/month assumed. Annual equivalent under a hypothetical pay-10-for-12 experiment → **9,950 EGP for that same 3-branch combination**. These numbers are not quotations to clients and exclude tax/gateway fees. Do not copy to customer pages, emails, receipts, plans DB or checkout.

**Research comparison required:** alternative (A) no base fee, per-app pricing; (B) small base fee + cheaper app rates; (C) pricing by operational value capability. Check each against direct cost and customer comprehension, then choose a model with written approval.

## 4. Rules before real customer pricing

- Decide first genuinely *free* app only after Free Forever economics are confirmed; today free means **14-day trial**, not unlimited free subscription.
- Essential tenant identity, data, access security, financial correctness, shift closing and read/export are not paid app add-ons even if Treasury is not installed.
- `TenantAppEntitlement` means installed, not paid. Never infer a paid right merely from `status=installed`.
- No charging for historical employee records / barbers / read-only portal seats; decide billable operator seat definition separately.
- Additional branches need an approved rate and atomic commercial permission. Do not silently switch existing caps from 1/3/10 and harm grandfathered tenants.
- A refund/cancel/downgrade must never silently delete business records.
- Plan request history and subscription status are distinct from provider-verified paid activation.
- Internal scenarios use a fixed checked-in experiment version and only allow Salon-ready **research-priceable** apps; unsafe/hold modules are rejected, not assigned a false zero price.

## 5. Validation and launch checklist

- [x] Clear old public marketing tier cards and prevent new legacy-plan request submissions.
- [x] Preserve tenant billing history and manual operator review of old pending requests.
- [x] Add protected read-only scenario engine/API/UI with scenario only (no checkout).
- [x] Document current scenario rates as **research assumptions**, not approved tariffs.
- [x] Move pricing math into a separately versioned pure integer-minor-unit engine with explicit internal-only state and tests.
- [x] Add both pricing regression suites to mandatory pull-request CI (`.github/workflows/ci.yml`), not just stand-alone local tests.
- [x] Compare no-base versus base-plus-app research alternatives in the operator-only interface.
- [ ] Verify PR CI + staging acceptance, and smoke current expired-trial, admin, non-admin and CASHER_BOOT paths.
- [ ] Interview 15–20 owners with actual pay-now pricing exercises and app combinations.
- [ ] Measure hosting/support and payment/AI/WhatsApp direct unit costs.
- [ ] Approve a *single* final model and versioned per-app rates, required core/free dependencies, taxes and annual discount policy.
- [ ] Implement transactional tenant modular entitlement/quote/order/payment lifecycle with signature/replay defenses.
- [ ] Migrate/grandfather existing plan-coded subscriptions without changing their rights or deleting historical data.
- [ ] E2E staging tests: independent tenants, booking, POS, invoice/shift close, expired trial, chargebacks, disabled app and refund.
- [ ] Launch customer-facing final pricing and checkout only after all gates pass.

## 6. Known transition limits

- Current signup/onboarding and existing `TenantSubscription` still use legacy plan identifiers and capacity rules internally. Not yet a tierless commercial subscription engine.
- Operator legacy plan editing remains possible for managed existing subscriptions; not a new customer tariff.
- Existing backend historical pricing test helpers are retained for compatibility/audit, not imported by V2 onboarding or UI as offers.
- Tenant My Apps is still an installation manager, not an invoice builder.
- Research scenario does **not** inspect tenant installed apps or usage; operator explicitly chooses a hypothetical combination. It is **not a live tenant price**.
- A ready-to-install app is not necessarily tested end-to-end for new tenants.

## Change log

| Date | Version | Decision |
| --- | --- | --- |
| 2026-10-26 | 1.0 | First modular research scenario, internal simulator and customer-facing legacy tier sales freeze; exact rates still unapproved. |
| 2026-10-26 | 1.1 | Versioned minor-unit quote engine; option to compare no-base vs base-plus-app pricing; safe before/after calculation. Research-only; no sale. |

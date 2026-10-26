# DRVO ERP — Salon Pricing & Feature Matrix (Proposal V1)

> ⚠️ **SUPERSEDED / ARCHIVED (2026-10-26):** All Starter/Growth/Pro feature columns and price ranges below are historical hypotheses, not the target product spec or live pricing. The canonical commercial model is [Business Model V2 — Modular Hybrid SaaS](./BUSINESS-MODEL-V2.md). The separate [Salon Feature Inventory V1](./SALON-FEATURE-INVENTORY-V1.md) remains technical evidence.

> **Document ID:** SALON-PRICING-FEATURE-MATRIX-V1  
> **Version:** 1.0 · **Last reviewed:** 2026-10-26  
> **Status:** **PROPOSED FOR PRODUCT / CUSTOMER VALIDATION** — **NOT** final prices or implemented feature gates  
> **Canonical strategy:** [BUSINESS-MODEL-V1](./BUSINESS-MODEL-V1.md) · **Evidence:** [SALON-FEATURE-INVENTORY-V1](./SALON-FEATURE-INVENTORY-V1.md)  
> **Audience:** DRVO ERP product, founders, engineering, pricing, sales.

## 1. Executive decision frame

**Already decided in the parent Business Model:** Hybrid SaaS; a usable **14-day no-card free trial** at launch; tier by increasing *customer value/features*; transparent extra locations; usage-priced WhatsApp/AI/SMS; optional onboarding; **Free Forever only as a future gated experiment**.

**Not yet decided:** exact feature cut-offs, marketed prices, billable operator count, extra-branch prices, service quotas, yearly discounts, tax, settlement, and a Free Forever launch. All cells below are **packaging hypotheses** requiring commercial signoff and tenant E2E proof.

**Foundational boundary:** `TenantAppEntitlement` = installed app, not permission to use all its advanced features. A commercially unavailable paid feature may be visible as an honest upgrade prompt, but an installed app must never be silently uninstalled or its data destroyed on plan change.

## 2. Pricing hypothesis (Egypt, EGP)

| Offering | Monthly research range | Who it serves | Customer upgrade reason | Rollout |
| --- | ---: | --- | --- | --- |
| **Free** | 0 | solo very small salon | Needs complete POS/queue operations | **FUTURE / DISABLED**, not an offer at launch |
| **Starter** | 499–699 | single-branch salon | Booking + basic checkout/queue in one place | Trial then paid; unvalidated |
| **Growth** | 899–1,299 | salon managing a team | Payroll/attendance, stock and deeper owner reports | Trial then paid; unvalidated |
| **Pro** | 1,499–2,499 | group / multi-location management | Consolidated management & advanced integration capabilities | Trial then paid; unvalidated |

**Important:** code currently has catalog prices **499 / 899 / 1,499 EGP monthly** and **4,990 / 8,990 / 14,990 yearly** and existing caps **1/3/10 branches**, **5/20/75 memberships**. These are **current implemented catalog/limits**, not the approved target matrix. No code change is permitted solely from these proposed ranges.

### Proposed customer-friendly plan cards (copy hypothesis)

- **Starter — شغّل محلك:** حجوزاتك، الدور، فواتيرك، متابعة المبيعات اليومية من مكان واحد.
- **Growth — امسك شغلك بذكاء:** Starter + إدارة الفريق والرواتب، عمليات المخزون والمشتريات *بعد تأكيد جاهزيتها*، وتحليلات أعمق.
- **Pro — سيطر على كل فروعك:** Growth + الإدارة المركزية للفروع، تقارير المقارنة، وتكاملات متقدمة *بعد تأكيد جاهزيتها*.
- **Free Forever:** **Not for marketing or checkout at launch.** Future idea: useful basic Booking, one branch, reasonable fair-use limits.

Never use marketing copy for inventory/purchasing, partner analytics or advanced integrations until their specific new-tenant release gate passes. During pre-release, hide/label unsupported cells honestly rather than presenting them as available.

## 3. Feature-tier blueprint (all cells TARGET, not enforced)

Legend: **✓** intended inclusion; **—** not included; **△** candidate/limited subject to research; **HOLD** code path exists but **do not advertise until validated**; **N/A** future plan not active.

| Capability / feature key (proposed) | Free (future) | Starter | Growth | Pro | Evidence/constraint |
| --- | --- | --- | --- | --- | --- |
| **CORE: identity, role security, owned data, backup/export** `core.safe_access` | ✓ | ✓ | ✓ | ✓ | Mandatory baseline, never premium |
| **CORE: services, categories, employee/team records, branding** `core.business_setup` | ✓ | ✓ | ✓ | ✓ | Shared data/tenant branding |
| **CORE: business day, required shift/invoice posting and fixes** `core.financial_integrity` | Only if relevant | ✓ | ✓ | ✓ | Do not break POS due to app/plan tier |
| Booking calendar, create, management `booking.core` | ✓ (limited) | ✓ | ✓ | ✓ | Booking required by Salon Pack; prove trial/Free gates |
| Hosted public booking link `booking.public` | △ | ✓ | ✓ | ✓ | Explicit public-branch publication + release proof |
| Barber selection, time-slot settings `booking.scheduling` | △ | ✓ | ✓ | ✓ | Workforce schedule safety remains foundational |
| Combined appointment + walk-in operations `operations.core` | — | ✓ | ✓ | ✓ | Composed surface, not separate charged app |
| Live queue, ticket & ETA `queue.core` | — | ✓ | ✓ | ✓ | Verify operator branch/team scope |
| POS sales, invoices & packages `pos.core` | — | ✓ | ✓ | ✓ | Complete financial correctness in paid tier |
| Daily owner sales snapshot `reports.daily_basic` | △ | ✓ | ✓ | ✓ | If not installed, provide basic sales view without advanced reports entitlement |
| Attendance/absence admin workflow `workforce.attendance` | — | — | ✓ | ✓ | Source-backed, staging proof required |
| Payroll, commissions, advances/ledger `workforce.payroll` | — | — | ✓ | ✓ | Source-backed, stage cash impact proof |
| Employee self-service read-only view `workforce.self_view` | △ | ✓ | ✓ | ✓ | Not automatically a paid operator seat |
| Inventory branch operations `stock.core` | — | — | **HOLD** | **HOLD** | API visible; complete end-user UX must be validated |
| Purchase workflows `stock.purchasing` | — | — | **HOLD** | **HOLD** | Requires installed inventory; check purchase-to-stock E2E |
| Detailed payroll/employee performance reports `reports.workforce` | — | — | **HOLD** | **HOLD** | Verify reporting SQL under multiple tenants |
| Period treasury analytics `reports.treasury_advanced` | — | — | △ | ✓ (HOLD) | Basic treasury safety still in Starter |
| Multi-branch dashboards/comparisons `reports.multibranch` | — | — | △ paid add-on | ✓ (HOLD) | Prove independent branch data isolation |
| Advanced central control/integrations `integrations.advanced` | — | — | △ | **HOLD** | No broad integration promise from nav entry alone |
| Custom enterprise onboarding/migration `services.guided_setup` | Add-on | Add-on | Add-on | Add-on | One-time quoted/explicit charge |
| Loyalty / CUT CLUB `loyalty.core` | — | — | — | **HOLD / NOT SELLABLE** | Legacy-only to CASHER_BOOT; not new tenant |
| WhatsApp messaging `messaging.whatsapp` | — | Add-on only when ready | Add-on only when ready | Add-on only when ready | Unavailable self-service; usage/provider costs |
| AI receptionist `ai.receptionist` | — | Add-on only when ready | Add-on only when ready | Add-on only when ready | Unavailable self-service; quota + per-tenant channel |
| Billing self-service requests `billing.request` | ✓ if plan exists | ✓ | ✓ | ✓ | Existing manual review only; not payment/activation |

**Trial:** intended to demonstrate all **staging-proven** features available for that tenant, with explicit resource quotas for expensive integrations. Trial does not by itself grant `loyalty`, messaging or AI while they are restricted. Feature-tier restrictions must not be implemented by disabling required bookkeeping or data retention.

## 4. Included quantities and add-ons — unapproved experiments

| Metric | Free future | Starter target | Growth target | Pro target | Why |
| --- | --- | --- | --- | --- | --- |
| Included operating branches | 1 | 1 | **1** + paid extras | **2** + paid extras | Avoid effective per-branch ARPA collapsing on scale; all quantities are hypotheses |
| Billable operator seats | Very small cap TBD | Generous cap TBD | Higher cap TBD | Higher/negotiated TBD | Do not conflate with total members |
| Employee & barber records | Not charged by row | Not charged by row | Not charged by row | Not charged by row | Operationally essential |
| Read-only employee portal accounts | Not charged by row | Not charged by row | Not charged by row | Not charged by row | Viewing own data is not a seat meter |
| Included AI/WhatsApp usage | None | None by default | None by default | None by default | Price an explicit add-on & limit |
| Historical data and export | Retained/safe export | Retained/safe export | Retained/safe export | Retained/safe export | Never destructive on downgrade |
| Extra branch monthly fee | Not supported | TBD | TBD | TBD | Requires pricing and atomic capacity entitlements |

**Do not deploy these branch caps:** today's `SaaSPlan.MaxBranches` is 1 / 3 / 10. Switching to the target 1 / 1 / 2 would be a commercial breaking change; it requires grandfather policy + manual approval + tests.

Yearly candidate: **10 months paid for 12** subject to margin. Do not assume taxes, proration, refunds or grace policy before approval.

## 5. Tier boundaries: what a customer must be able to achieve

| Tier | “First value” milestone | Upgrade trigger |
| --- | --- | --- |
| Trial | Finish setup, create a booking, run a safe invoice/shift in a test tenant | Move to verified payment to continue without interruption |
| Future Free | Publish/use a real basic booking with practical limits | Need walk-ins, POS or staff operations |
| Starter | Single-location booking + queue + selling + daily numbers reliably | Need workforce payroll, stock and deeper insights |
| Growth | Run and supervise team compensation + stock workflow (once shipping), and review performance | Need central group/multi-location control |
| Pro | Compare and manage multiple locations while preserving permissions and tenant boundaries | Additional paid locations, dedicated support or integrations |

**Product principle:** selling a more expensive tier must solve a meaningfully more complex *job*, not merely remove arbitrary caps. A missing tier feature must show a clear explanation/upgrade CTA rather than a generic broken page.

## 6. Engineering handoff — implementation design, not authorization to build

### A. Stable feature identities (proposed)

Use app-scoped capability keys above (e.g. `booking.core`, `pos.core`, `workforce.payroll`, `reports.multibranch`). Distinguish:
1. `installedApps` — existing source for app installation and route-family gate.
2. `subscriptionStatus` / `paidPeriod` — active commercial access.
3. `planCapabilities` — future authoritative commercial feature grants with versioned catalog.
4. `tenantPurchasedAddOns` — extra branches and metered services with auditable units/cycle.
5. `effectiveEntitlements` — resolved server-side, fail-closed except protected compatibility baseline.

Do not create a second commercial `TenantApp` table that silently overrides installed apps, and do not use client-side hiding as security.

### B. Server-side enforcement seam

- Enforce at **domain use-case / mutation boundary** with authoritative `tenantId`, plus route-level guards where appropriate. Same endpoint may serve Starter core and Growth advanced workflows; pathname-only app gating is insufficient.
- Read/list/search/export must also be scoped; never open cross-tenant records because a feature is unavailable.
- Data creation correctness (sale, cash posting, cancellation, employee ledger, shift closing) is **not** tier-controlled. Only genuinely advanced optional actions may be denied.
- Never double-bill purchased branch capacity; transactional increment under tenant commercial lock; avoid race conditions.
- Handle trial, active, expired, past_due, cancelled, grandfathered `internal` separately. **CASHER_BOOT** must retain functioning workflows irrespective of new-tier experiments.
- Explicit non-destructive downgrades: premium history remains; newly forbidden writes are blocked consistently; safe read/export remains; promote reactivation rather than deleting rows.
- Record audit events for entitlement changes; invalidate cache and refresh tenant shell.

### C. UX / marketing contract

- Customer-visible card is derived from the **approved** feature catalog, not a hard-coded list that contradicts backend.
- If a capability is **HOLD/unverified**, do not show a promise, purchase CTA or “active” green status.
- Keep My Apps as a module manager. Do not claim “installing this app” automatically grants paid features.
- Show quotas, included branches, trial end, current active tier, pending requests and verified payment status distinctly.
- No checkout activation on plan-request creation; existing `/api/tenant/billing` is **manual review only**.

### D. Release and acceptance gates

- [ ] Product/founder approves exact Starter/Growth/Pro feature cuts and prices after customer interviews.
- [ ] Staging proves first booking, public booking, queue, POS and shift close with two different tenants.
- [ ] Payroll/attendance/stock/purchases/reports individually pass tenant E2E before marketing promises.
- [ ] Add DB model for plan-feature entitlements without changing legacy entitlements; migration forward-safe.
- [ ] Server tests: lower tier cannot perform premium mutation even by direct API; paid tier can; invalid subscription blocked; no cross-tenant access.
- [ ] E2E trial → paid, upgrade, end-of-period downgrade, cancellation, expired billing + safe export, refund/reversal.
- [ ] Cut Salon/CASHER_BOOT end-to-end regression (sales/invoices/closing/bookings/HR/WhatsApp) and explicit no-repricing.
- [ ] Compare implemented billing price, website page, receipts and operator console with approved terms before any public release.

## 7. Validation plan (business, not engineering alone)

Interview **15–20 Egyptian salon owners** across solo/single-branch/growing/multi-branch. Test concrete pay-now pricing and tier-specific upgrade motivation rather than “does this look okay?” Gather:
- first-value job, alternatives, friction switching/migrating;
- actual willingness to pay at tested price points;
- payroll/stock/analytics demand as upgrade triggers;
- what counts as an operator; staff read-only accounts;
- support, infrastructure, payment processing and messaging costs;
- expected price of extra branches and acceptable annual discount.

Document decisions and evidence in [BUSINESS-MODEL-V1.md](./BUSINESS-MODEL-V1.md), and promote approved cells to a versioned market offer only afterwards.

## 8. Decision register

| ID | Decision | Current state |
| --- | --- | --- |
| SP-01 | Proposed features in Starter, Growth, Pro | **DRAFT / TO VALIDATE** |
| SP-02 | Price ranges and tax/frequency policy | **DRAFT / TO VALIDATE** |
| SP-03 | Included branches and each extra-branch rate | **DRAFT / TO VALIDATE** |
| SP-04 | Billable operator seat definition/count | **DRAFT / TO VALIDATE** |
| SP-05 | Public booking in future Free tier and fair-use quotas | **DEFERRED**, no Free Forever launch |
| SP-06 | Payroll / inventory / reports staging E2E eligibility | **RELEASE HOLD** |
| SP-07 | Payment gateway and auto-activation | **SEPARATE IMPLEMENTATION GATE** |
| SP-08 | Loyalty / WhatsApp / AI commercial rollout | **RESTRICTED** |

## Change log

| Date | Version | Summary |
| --- | --- | --- |
| 2026-10-26 | 1.0 | Proposed Salon tier matrix, source-backed inventory crosslinks, readiness holds, and feature-entitlement engineering handoff; **no runtime gating or pricing changes**. |

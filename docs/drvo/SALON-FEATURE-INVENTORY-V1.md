# DRVO ERP — Salon Pack: Evidence-Based Feature Inventory (V1)

> **Commercial update (2026-10-26):** This source-code feature audit remains usable, but Starter/Growth/Pro packaging was superseded by [Business Model V2 — Modular Hybrid SaaS](./BUSINESS-MODEL-V2.md).

> **Living document** · Date: 2026-10-26 · Audited against `main@811bdbf68d982998fdd9cca010facb7193fe3879`  
> **Status:** repository-level functional inventory; **not** end-to-end certification or a production sales promise.  
> **Companion:** [Proposed Salon Pricing & Feature Matrix](./SALON-PRICING-FEATURE-MATRIX-V1.md) · [Business Model](./BUSINESS-MODEL-V1.md).

## 1. Vocabulary — do not mix these up

- **S — Source-backed surface:** implementation/API or UI is visible in repository. **Does not imply new-tenant staging proof.**
- **T — Tenancy work documented:** tenancy/scoping effort and tests are documented for the capability. **Does not imply a real customer has completed it on staging.**
- **U — Unverified:** installed/possible in code, but specific per-app setup/use evidence is missing. **Not a launch claim.**
- **R — Restricted:** explicitly unavailable to self-service or legacy-only. **Do not put on public pricing cards.**
- **F — Future/commercial design:** not presently implemented as a feature entitlement; examples below are proposals only.

App installation (`TenantAppEntitlement`) is not subscription-based feature access; plan changes presently do not unlock/disable capabilities. `S/T` below describe code and documentation, not proof of an E2E purchase or daily operation for new tenants.

## 2. Pack and onboarding inventory (source-of-truth)

**`src/packs/salon/manifest.ts`**:

| Category | Registered apps | What it means |
| --- | --- | --- |
| Required | `booking` | New Salon tenant must keep installed. |
| Recommended | `queue`, `pos`, `attendance`, `payroll`, `treasury`, `reports` | Defaults for newly selected Salon pack, removable under app rules. |
| Optional | `inventory`, `purchasing`, `messaging`, `ai-receptionist` | Not all options are available to self-service users. |
| Separate/legacy | `loyalty` | Registered globally but legacy-only for CASHER_BOOT. |
| Surface | `operations` | Composed UI surface, **not** a separately entitled app. |

**`src/platform/apps/appCatalog.ts`**: `purchasing` requires `inventory`. `loyalty` is legacy-only; `messaging` and `ai-receptionist` are excluded from tenant self-service. Do **not** infer that POS requires Treasury as an installed app; payment posting infrastructure must work independently. Do **not** infer payroll hard-depends on attendance.

**`src/platform/publicSignup/appSelection.ts`**: signup displays only pack-declared self-service-available apps. **`src/packs/salon/onboardingPreset.ts`**: optional demo records are freshly generated for that tenant; real mode does not seed fictional customers/employees/services, and public booking publication is off by default.

## 3. Capability audit — code-backed surfaces

| Code | Customer-facing job / feature | Repository evidence | State | Commercial caution |
| --- | --- | --- | --- | --- |
| SL-BOOK-01 | Maintain internal appointments (list, create, details) | `src/app/bookings/{page.tsx,new/, [id]/}`; `src/app/api/bookings` | S/T | Staging booking/create/cancel regression required. |
| SL-BOOK-02 | View calendar and appointment availability | `src/app/bookings/calendar`; `src/app/api/admin/booking/v2` | S/T | Verify slots, availability, timezone. |
| SL-BOOK-03 | Hosted public booking page per branch | `src/app/book/[branchCode]`; `docs/drvo/DRVO-019-IMPLEMENTATION-NOTE.md` | S/T | Must enable PUBLIC_LIVE separately and verify CORS/tenant isolation. |
| SL-BOOK-04 | Public booking cancellation & lookup | `docs/drvo/DRVO-019-IMPLEMENTATION-NOTE.md`; public booking APIs | S/T | Prove ownership and cancellation conditions on staging. |
| SL-BOOK-05 | Booking employee selection & scheduling preferences | `src/packs/salon/onboardingPreset.ts`; `src/app/api/admin/booking-settings` | S | Prove configurations for new tenant. |
| SL-BOOK-06 | Service/package booking combinations | `src/app/api/operations/booking-packages`; `src/app/admin/packages` | S | Package price/tax/availability testing needed. |
| SL-QUEUE-01 | Live walk-in queue display & new ticket | `src/app/queue/{live,new}`; `src/app/api/queue` | S/T | Validate branch + employee matching and closing. |
| SL-QUEUE-02 | Queue ETA / estimates | `src/app/api/queue/estimate` | S | Evaluate actual accuracy under load. |
| SL-QUEUE-03 | Combined operations board for booking & queue | `src/app/operations`; `src/app/api/operations/{overview,flow-board,queue,bookings}` | S | Cross-app UI does not represent a separately billable app. |
| SL-POS-01 | POS cash/invoice issue & recent sales | `src/app/income/pos`; `src/app/api/sales` | S/T | Verify posting, discounts, day/shift, payments, split payments. |
| SL-POS-02 | POS packages and service combination | `src/app/api/pos/packages`; `src/app/admin/packages` | S | Verify separate/combined line items and revenue. |
| SL-POS-03 | Basic daily sales view | `src/app/sales`; `src/app/api/sales/today` | S | Basic owner-visible daily proof should not require advanced Reports. |
| SL-CORE-01 | Branch creation and active location | `src/app/admin/branches`; `src/platform/commercial/limits.ts` | S/T | Current plan branch cap applies. |
| SL-CORE-02 | Catalog: services, categories, prices | `src/app/admin/services`, `src/app/admin/categories` | S/T | Shared domain required by Booking/POS; never surprise-charge for setup. |
| SL-CORE-03 | Employees, service providers and bookable team | `src/app/admin/employees`; `src/packs/salon/onboardingPreset.ts` | S/T | Employee records are not automatically billable seats. |
| SL-CORE-04 | Tenant admin, user identities and role safety | `src/app/admin/users`; `src/platform/commercial/limits.ts` | S/T | Essential security/least privilege must not be behind Pro. |
| SL-CORE-05 | Business day, shift open/close | `src/app/admin/day`; `src/app/treasury/shift-close`; `src/app/api/operations/shift` | S/T | Financial integrity required in every paid POS tier. |
| SL-CORE-06 | Tenant brand and receipt identity | `src/app/admin/tenant`; `docs/drvo/DRVO-017-IMPLEMENTATION-NOTE.md` | S/T | Basic tenant identity cannot require Pro. |
| SL-HR-01 | Employee attendance and absences | `src/app/admin/attendance`; `src/app/api/admin/attendance` | S/T | Staging smoke noted as pending in DRVO-016 docs. |
| SL-HR-02 | Staff scheduling / availability | `src/app/admin/workforce`; `src/app/api/admin/hr` | S/T | Distinguish core booking schedule from advanced HR policies. |
| SL-HR-03 | Salary, commissions, daily payroll | `src/app/api/payroll`; `src/app/api/admin/hr/daily-payroll` | S/T | Staging payroll posting to cash and tenant scoping required. |
| SL-HR-04 | Employee ledger, advances and monthly statements | `src/app/api/admin/hr/employee-ledger`; `src/app/api/admin/hr/employee-monthly-sheet` | S/T | Validate monetary balances and corrections. |
| SL-HR-05 | Employee self-view / employee portal | `src/app/employee-portal`; `src/app/api/admin/hr/employee-portal-accounts` | S | Read-only employees are not per-seat monetization targets. |
| SL-FIN-01 | Expenses, deductions and simple cash movement | `src/app/expenses`; `src/app/deductions`; `src/app/treasury/movement` | S | Basic invoice/shift correctness cannot be paywalled. |
| SL-FIN-02 | Daily/shift treasury and reconciliation views | `src/app/treasury/{daily,shift-close,summary}`; `src/app/api/treasury` | S/T | Differentiate safety reconciliation vs optional advanced analyses. |
| SL-FIN-03 | Period treasury and consolidated branches | `src/app/treasury/{period-summary,group-daily}` | S | Multi-location commercial gate requires reliable location scoping. |
| SL-REPORT-01 | Monthly / full-day reports | `src/app/reports/monthly`; `src/app/admin/reports/full-day` | S/U | Reports app routes present; readiness not established per app. |
| SL-REPORT-02 | Employee performance and service reports | `src/app/admin/reports/{employee-monthly-work-revenue,employee-services}` | S/U | Prove per-tenant report SQL joins before commercial release. |
| SL-REPORT-03 | Partner reports and adjustments | `src/app/admin/reports/partners`; `src/app/admin/partners` | S/U | Financial/partner scope sensitive; not assumed tenant-safe from route existence. |
| SL-INV-01 | Inventory branch data/counters | `src/app/api/inventory/branch`; `src/apps/inventory/public` | S/U | No comparable standalone inventory UI located at `src/app/inventory`; don't market a finished inventory app. |
| SL-PUR-01 | Purchase recording APIs | `src/app/api/purchases/route.ts`; `src/apps/purchasing/public` | S/U | Requires inventory installed; no comparable `src/app/purchases` page located. |
| SL-LOY-01 | Loyalty, client inventory and vouchers | `src/app/admin/loyalty`; `src/platform/apps/appCatalog.ts` | R | Explicitly CASHER_BOOT legacy-only for new tenant signup. |
| SL-MSG-01 | WhatsApp inbox/templates | `src/app/admin/whatsapp`; `docs/drvo/DRVO-018-IMPLEMENTATION-NOTE.md` | R | Per-tenant channel not approved for self-service activation. |
| SL-AI-01 | AI salon concierge | `src/app/admin/ai-concierge`; `docs/drvo/DRVO-018-IMPLEMENTATION-NOTE.md` | R | Requires tenant-specific channel config + metering + commercial readiness. |
| SL-APP-01 | Add/disable apps after signup | `src/app/admin/apps`; `src/platform/apps/selfServiceAppManager.ts` | S/T | Installed app != plan-feature entitlement. |
| SL-BILL-01 | Request monthly/annual plan | `src/app/admin/billing`; `src/app/api/tenant/billing` | S | Manual review **only**; no gateway payment or auto activation. |

**Scope caution:** navigation or API presence is not an E2E contract. This is deliberately not an assertion that every module above is fully released to arbitrary new tenants. The `workspaceReadiness` projection has startup evidence rules for **Booking, Queue and POS**; most other installed apps are `installed_unverified` (see `src/platform/tenant/workspaceReadiness.ts`). Note that workspace evidence is **informational**, not authorization.

## 4. Gaps to resolve before changing commercial entitlements

| Gap | Finding from code | Required treatment |
| --- | --- | --- |
| Feature-tier access | `src/platform/commercial/types.ts` and `tenantAccessGate.ts`: subscription + installed-app checks, not Starter/Growth/Pro feature IDs | Define a separate fail-closed feature/capability model. |
| App installation | Signup/My Apps choose installable apps independently of plan | Keep independence; explain locked premium action inside apps, never surprise-uninstall. |
| Seat billing | `src/platform/commercial/limits.ts` counts all non-deleted tenant user memberships | Define billable operational users separately from employees/read-only identities; migrate safely. |
| Branch billing | `SaaSPlan.MaxBranches` is a cap, not a per-location billing ledger | Decide included branches/add-on price and enforce paid expansions transactionally. |
| Accounting safety | POS and shift/treasury infrastructure interlock | Never gate sale posting or closing behind optional Reports/Treasury premium capability. |
| Public booking | New salon trial starts with public booking off by default | Require explicit onboarding publication and staged smoke tests. |
| Inventory/purchasing | APIs/source are present; standalone end-user workflows not established in page audit | Product walkthrough + E2E tests before listing as fully sellable. |
| Loyalty | Explicit legacy-only new-tenant restriction | Exclude from catalog until tenant isolation and release. |
| Messaging & AI | Explicit self-service restriction, metering not billing | Channel onboarding, cost controls and operational proof before commercial release. |
| Data preservation | Trial and cancellation use subscription access gates | Safe billing, customer data export, historical invoices/records and reactivation must be designed/tested. |

## 5. Audit acceptance checklist

- [x] Salon industry pack required/recommended/optional classification read from code.
- [x] Self-service unavailable and legacy-only app rules identified.
- [x] Existing routes and UI entries inventoried as **source-backed**, not deployment-proven.
- [x] Distinction between installed app, allowed feature, and trial/paid commercial state recorded.
- [ ] Two-tenant staging acceptance for every feature being sold in the public card.
- [ ] Founder and salon-owner validation of proposed tier boundaries.
- [ ] Pricing/unit-economics approval.
- [ ] Server enforcement proof, cross-tenant tests and Cut Salon regression for feature gates.

## Change log

| Date | Version | Change |
| --- | --- | --- |
| 2026-10-26 | 1.0 | First source-backed Salon Pack feature inventory and readiness caveats. |

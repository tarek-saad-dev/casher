# DRVO ERP — Internal Quote Lab (research only)

> 26 October 2026 · Operator-only, **NONPAYABLE, NO CUSTOMER QUOTE, NO ORDER**.

## Purpose
Before the business approves commercial tariffs, operators need to evaluate how a specific tenant's *existing, immutable* app-selection inquiry would price under an *independently reviewed research proposal*. This allows internal feasibility work without marketing hypotheses as customer promises.

## Delivered
- Pure `simulateModularResearchInquiry` in `src/platform/commercial/modularQuoteLab.ts`:
  - Requires open (`awaiting_pricing`) existing inquiry; Salon-only matching research industry.
  - Requires tariff proposal already `reviewed_research` by a **different** actor, with note and timestamp.
  - Revalidates complete app prices (in integer EGP piasters), selected apps, required booking, dependencies, 1–20 branch count, annual cycle, version and overflow.
  - Uses the shared `calculateModularResearchQuote` arithmetic engine, explicitly constructed with `state: 'research_only'`. Research-only rates can include deliberate zero-price hypotheses; **missing app rates still fail closed**.
  - Returns itemized monthly and period amounts, but with **permanent false flags**: `canIssueCustomerQuote`, `canAcceptOrder`, `canCheckout`, `canActivate`, `paid`, `orderCreated`, `subscriptionChanged`.
- DB-backed `simulateStoredModularInquiry` reads source rows by exact IDs. Only the server reads trusted persisted price/selection snapshots; the browser **cannot supply tenant identity, app selection, prices, catalog states or payment fields**.
- Operator-only `POST /api/admin/platform/modular-quote-lab`: strict `{requestId,proposalId}` input, `requirePlatformOperator()`, `Cache-Control: no-store`, safe errors. **No GET endpoint and no DB writes**.
- A new operator console screen `/platform/modular-quote-lab` selecting an open inquiry and a reviewed research version; shows itemized hypothetical totals, source metadata, and explicit commercial blockers. Linked from operator navigation.
- Mandatory CI tests for arithmetic, mismatched industry, stale/closed or unreviewed source, missing price, trial state, auth and read-only boundary.

## Blockers explicitly attached to every result
1. **UNAPPROVED_COMMERCIAL_TARIFF** — no tariff approved for selling.
2. **TAX_AND_GATEWAY_FEES_UNRESOLVED** — taxes, gateway and related amounts remain unresolved, not zero.
3. **TRIAL_FREE_ALLOWANCE_AND_USAGE_TARIFFS_UNRESOLVED** — trial, included baseline and variable-cost WhatsApp/AI modules not priced.
4. **REFUNDS_PRORATION_AND_TERMS_UNRESOLVED** — upgrade/downgrade timing, refunds, tax and subscriptions terms not approved.
5. **CHECKOUT_SETTLEMENT_AND_ENTITLEMENTS_NOT_LIVE** — no verified gateway, order, invoice or paid-entitlement issuance.

## Security and deployment
- Operator RBAC is enforced before queries, not only by hiding menu links. Tenants are never given the research amounts.
- **Existing tenant billing UI and API are not changed.** No new migration, production DB DDL, subscription updates, installed-app state or customer finance tables.
- Lab depends on existing migrations 017 (inquiries) and 019 (internal reviewed tariff research). Apply/reconcile those via standard migration approval process before using in staging.
- Required staging E2E: a valid Salon inquiry + independent research reviewer, test unsupported supermarket, invalid app, stale/closed inquiry, tenant-admin 403, operator-only prices, and no outbox/order/invoice/subscription mutation.
- Cut Salon's POS invoices, shift close, booking and payroll are untouched by the lab.

## Separate next phase (requires explicit commercial decisions)
Approve and publish immutable customer-rate catalogs **outside the research tables**, including taxes/fees/free allowance/annual/refund rules, with audit and dual signoff. Then design real customer-facing quotes with expiry, explicit acceptance, order ledger, settlement verification and paid entitlements. None of those can be inferred from a `reviewed_research` status.

## Change history
- 2026-10-26: Internal quote lab and guarded pure quote integration; zero-rate research hypothesis compatibility.

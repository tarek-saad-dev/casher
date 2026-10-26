# DRVO ERP — Tariff Research Governance (V1)

> 2026-10-26. **INTERNAL RESEARCH ONLY**. This is **not** a commercial price approval or billable quote/order system. Priced customer offers cannot be issued from it.

## Why
The modular hybrid SaaS model and 14-day no-card trial are approved directions, but exact tariffs for paid apps, included locations, extra branches, annual terms, base fee and taxes **are not decided**. Existing operator research assumptions are **not** a fee schedule. Do not silently promote research costs to public entitlements or invoices.

## Delivered
- **Migration 019** creates a standalone `ModularTariffResearchProposal` table, without seeds or changes to `ModularPriceCatalog`, `ModularPriceCatalogItem`, `TenantSubscription`, `TenantAppEntitlement` or tenant financial tables. It has unique `(IndustryCode,Version)`, immutable scenario inputs, creator and reviewer identity and constrained research states.
- **Only statuses:** `submitted`, `reviewed_research`, `changes_requested`. There is intentionally **no** `approved`, `active` or `paid` path.
- **Operator editor** at `/platform/tariff-research`. Fields start blank: app-price assumptions, base fee, extra branch fee, included branches, annual months charged, pricing model. Research restricted to **Salon** V1; no default prices, no supermarket commercialization.
- Server validates all proposed amounts as non-negative **integer EGP piasters**, rejects missing/unrecognized apps and missing assumptions, bounds location and annual terms, checks arithmetic overflow.
- `GET/POST/PATCH /api/admin/platform/tariff-research` protected by `requirePlatformOperator` on every method. POST accepts only explicitly allowed candidate fields. Server owns actor, version and currency. Each POST creates a new immutable version under a global transaction-owned app lock.
- **Two-person review**: reviewer must not equal creator; note mandatory; locked atomic status review; exact retry is idempotent, conflicting attempts rejected. SQL check constraint independently enforces different identities and complete review fields.
- Separate internal research table is **not** read by tenant billing, customer quote inquiry, payment, subscription or app entitlement code. API/UI explicitly say `approvedForSale:false` and `canCheckout:false`.

## Scope / guardrails
- The research price for an item `treasury` or `reports` does not license restricting core financial correctness; fee design for *advanced* features remains hypothetical.
- Tax, gateway charges, refund terms, proration and usage-based AI/WhatsApp charges are excluded, **not assumed zero**.
- No operator can "approve for sale" by choosing `reviewed_research`. This means only *the research proposal was checked*, not that any price has been adopted by the business.
- Revisions never overwrite prior research figures; separate creator/reviewer identities are stored for audit. There is no external customer pricing or contract acceptance.
- Actor cannot bypass review by editing API payload `approved`, `paid`, or passing user ID; these are rejected at the route.

## Required deployment evidence
1. Merge only after passing mandatory GitHub CI.
2. Stage migration 019 after 018, check checksum and verify table constraints/indexes. **No production DB migration is executed just by merging a PR.**
3. Two distinct operator users create/review; attempt self-review must return 403; concurrent review must record one result; identical replay unchanged; conflicting replay 409.
4. Tenant-admin/public sessions cannot see this data or API; Cut Salon financial, booking, and shift-close flows unchanged.
5. Live commercial catalog remains empty/unapproved and tenant quote inquiry remains price-free.

## Next commercial gate (requires explicit business approval)
Record signed-off per-app rates, included/free baseline, branch units, tax and annual/refund rule in BUSINESS-MODEL-V2's decisions. **Only then**, design a new independent approval-to-publication step with immutable catalog digest, four-eyes release signoff, controlled rollout flags, expiration/terms, and financial reconciliation. Follow with explicit customer acceptance → order → verified settlement → auditable entitlement.

## History
- 2026-10-26: Draft internal tariff proposals, separate reviewer, nonpayable table and operator UI.

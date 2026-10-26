# DRVO Hybrid SaaS — Entitlement Shadow Contract V1

> 2026-10-26 · FOUNDATION ONLY — NOT A PRICING APPROVAL OR PRODUCTION GATE.

## Commercial source precedence

1. **Business Model V2**: the latest merged implementation direction is a **tierless modular Hybrid SaaS**; 14-day no-card trial is approved as a principle.
2. **Business Model V1** from `docs/drvo-business-model-hybrid-v1` records the earlier Hybrid SaaS research, including tentative Starter/Growth/Pro packages and Free Forever *as a deferred experiment*, not approved prices.
3. Supersede V1's Starter/Growth/Pro target catalog via V2; preserve existing legacy codes for operational compatibility. Do not migrate/reprice tenants implicitly.
4. **Free Forever is not live or approved in either source.** Candidate single basic app requires unit-economics, usage limits, approval and rollout plan.
5. Exact tariff, app-to-free mapping, add-ons and limits remain **undecided**. No customer-facing charges, offers or enablement may be derived from research numbers.

## Pure entitlement planner

`src/platform/commercial/hybridEntitlementShadow.ts` models four possible access bases:
- `platform_core`: financial correctness, safe records, secure identity and exports must not be premium-gated.
- `trial`: explicit start/end window; only installed/technically ready functionality, external variable-cost usage still independently limited.
- `free_forever`: only when a separately approved, enabled policy explicitly lists eligible features.
- `paid`: only when a grant for the exact capability is **verified** and within its time window.

Every evaluation emits `mode:shadow_only`, `canCharge:false`, `canActivate:false`, `changesCurrentAccess:false`. It does not access SQL, touch route middleware, or change a plan. `accessRecommended` is **planning-only**, NOT an authorization result.

## Implementation gates

- [x] Clarify precedence and source decisions in a dedicated contract.
- [x] Add pure rules + regression tests for trials, free approval, paid verification, installation separation and core safety.
- [ ] Approve Free Forever apps, limits and abuse controls.
- [ ] Approve tariff catalog/locations/variable usage and refund rules.
- [ ] Add source-of-truth paid grant storage with audit and provider settlement verification.
- [ ] Stage-gated tenant-aware integration and regressions before any enforcement.
- [ ] Protect CASHER_BOOT and historical tenants; never reinterpret installed-app flags as paid.

## Next implementation

Design an additive commercial-policy/version registry, explicit grants and settlement-proof state with canonical tenancy, audit and no runtime enforcement by default. Approved pricing must be a separate review from the shadow contract.

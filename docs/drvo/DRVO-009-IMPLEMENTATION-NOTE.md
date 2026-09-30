# DRVO-009 implementation note

## Two-layer cutover

### Stage 1 — compatibility-first DB migration (this PR)

Migration `ins-cash-move-sales-guard` replaces `InsCashMoveSales` with the branch-ownership set-based body plus a coexistence guard. Directions stay `مبيعات` in, `مبيعات بالكارت` out, `م.مبيعات` out, `م.مبيعات بالكارت` in. Legacy behavior is unchanged until Treasury pre-posts a sale CashMove.

Production: apply via Migration Control Plane PLAN/APPLY **before** activating app Treasury posting.

### Stage 2 — application cutover (separate activation PR)

Set `pos-sale-treasury.rollout = extracted` in `moduleManifest.ts` after Stage 1 is live and verified.

Until then, default `rollout: legacy` keeps trigger-only sale CashMove.

## App changes

| Component | Role |
| --- | --- |
| `postSaleCashMove` | Treasury-owned sale insert using sale invID + registry Kind=sale |
| `legacySaleCreateAdapter` | When flag on: post Treasury CashMove after allocateInvID, before head insert |
| `InsCashMoveSales` guard | Skips when registry sale row exists for invID+invType |

## Rollback

- App: set `pos-sale-treasury.rollout = legacy` (or `DRVO_FORCE_POS_SALE_TREASURY_PATH=legacy`)
- DB: restore backup or re-apply prior trigger body from audit SQL

## Staging smoke

`npx tsx scripts/drvo-009-pos-sale-treasury-staging-smoke.ts`

Requires `DRVO_STAGING_DB_PASSWORD` and SSH tunnel to `last132_agent` as `drvo_agent`.

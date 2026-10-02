# DRVO-010 implementation note

## Registry lifecycle — Option A (mutable sale registry row)

Treasury update/delete uses **Option A**: the existing `Kind=sale` registry row for
`pos-sale:{invType}:{saleInvId}` is updated atomically on replace (`CashMoveId` +
`Fingerprint`) or deleted on remove after reversal.

Rationale:

- Matches DRVO-009 idempotency key model (one sale key per invoice).
- Avoids orphan registry rows pointing at deleted CashMove IDs.
- Preserves reversal audit rows (`Kind=reverse`) without silent history deletion.

## Two-layer cutover

### Stage 1 — this PR

- `replaceSaleCashMove` / `removeSaleCashMove` Treasury seams + tests + staging smoke.
- `pos-sale-treasury-mutation.rollout = legacy` — production update/delete behavior unchanged.
- POS repository keeps legacy CashMove SQL when the mutation flag is off.
- Extracted update reverses and replaces a treasury-owned sale movement. A sale with no `Kind=sale` registry row is treated like the delete fallback: split transfers are reversed, then legacy sale `TblCashMove` rows are hard-deleted in the same transaction before the replacement post.
- Each replace reversal is keyed by the current live CashMove id (`pos-sale:replace-reverse:{invType}:{saleInvId}:{priorCashMoveId}`).
- Each replacement outbox event is `treasury.sale.replaced:{saleKey}:{priorCashMoveId}`.
- A replace that must insert because no registry row exists publishes `treasury.sale.posted:{saleKey}:{cashMoveId}` so it does not collide with the original create event.
- A zero-total replace reverses the live sale movement and deletes the `Kind=sale` registry row. The reversal child is a new `TblCashMove` on a different `invID` with `ReversalOfCashMoveId` pointing at the original. `FK_TblCashMove_ReversalOf` is `NO ACTION`.
- Extracted delete after that replace sees no registry. It **preserves the reversal pair** and deletes only live invoice cash rows (`ISNULL(IsReversed, 0) = 0 AND ReversalOfCashMoveId IS NULL`). Deleting the reversed original would fail the FK. Deleting only that original would also leave the offset in the payment-method balance, because balance sums every row by `inOut` and does not apply the live-cash filter. The flag-off delete is unchanged.
- `classification` is `legacy` because Stage 1 production update/delete still uses the legacy SQL path. `rollout` stays `legacy` until Stage 2.

### Stage 2 — activation PR

- `pos-sale-treasury-mutation.rollout = extracted` in `moduleManifest.ts` after Stage 1 staging smoke, independent review, and production `drvo:verify` passed with rollout still legacy.
- Activation changes only the source-controlled business path. No production DB migration is applied by application deploy.
- Emergency rollback remains `DRVO_FORCE_POS_SALE_TREASURY_MUTATION_PATH=legacy` or a source-controlled rollback PR to `rollout=legacy`.

## App changes

| Component | Role |
| --- | --- |
| `replaceSaleCashMove` | Reverse prior sale movement when fingerprint changes; insert replacement; update registry |
| `removeSaleCashMove` | Reverse sale movement; delete `Kind=sale` registry row |
| `legacySaleRepository` | Treasury-owned update skips hard sale CashMove DELETE. Non-registry update hard-deletes unreversed legacy sale CashMove rows after split reversal. Extracted delete of a non-owned sale keeps a prior reversal pair and deletes only live invoice cash rows |
| `updateSale` / `deleteSale` | Wire replacer/remover when `isPosSaleTreasuryMutationEnabled()` |

## Staging smoke

`npx tsx scripts/drvo-010-pos-sale-treasury-mutation-staging-smoke.ts`

Requires `DRVO_STAGING_DB_PASSWORD` and SSH tunnel to `last132_agent` as `drvo_agent`.

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
- POS repository skips direct `TblCashMove` DELETE/INSERT when mutation flag is extracted.

### Stage 2 — activation PR (after staging evidence)

- Set `pos-sale-treasury-mutation.rollout = extracted` in `moduleManifest.ts`.
- Human merge required; no automatic production DB mutation.

## App changes

| Component | Role |
| --- | --- |
| `replaceSaleCashMove` | Reverse prior sale movement when fingerprint changes; insert replacement; update registry |
| `removeSaleCashMove` | Reverse sale movement; delete `Kind=sale` registry row |
| `legacySaleRepository` | Treasury path: split reverse before payment delete; no hard sale CashMove DELETE |
| `updateSale` / `deleteSale` | Wire replacer/remover when `isPosSaleTreasuryMutationEnabled()` |

## Staging smoke

`npx tsx scripts/drvo-010-pos-sale-treasury-mutation-staging-smoke.ts`

Requires `DRVO_STAGING_DB_PASSWORD` and SSH tunnel to `last132_agent` as `drvo_agent`.

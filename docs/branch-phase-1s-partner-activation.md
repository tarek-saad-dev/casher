# Phase 1S — Partner activation

## Approved shares

أ/ عايدة 40 · أ/ طارق 20 · أ/ زياد 20 · أ/ عمر 20

## Activation

`activateBranchPartnerShares({ branchId, effectiveFrom, actorUserId })`

- Validates draft totals 100%
- Sets IsActive=1, EffectiveFrom=real date (not 2099)
- Strips `PHASE1O_DRAFT_PENDING_OPENING_DATE`
- Sets `InternalLiveEffectiveDate` on setup policy
- Never mutates GLEEM BranchID=1

## API / UI

- `POST .../setup/partner-shares/activate`
- `/admin/branches/[id]/setup/partners`

Clears `biz.partner_shares_effective_date` when active non-draft rows exist.

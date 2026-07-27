# Booking Phase 2 — Deleted service audit

**Live DB:** last132 · **Action:** read-only (no restores in this task)

## Soft-deleted rows (15)

| ProID | Name | Category | Type | Notes | Recommendation |
|------:|------|----------|------|-------|----------------|
| 30 | عائد للخزنه (كاش) | إداريات | serv | Internal vault | Keep deleted |
| 45 | Threading / فتلة | Beard Cut | serv | Old service | Keep deleted unless ops reintroduces |
| 1053 | Hair Cut / حلاقة شعر | (none) | null | Duplicate/legacy incomplete | Keep deleted |
| 1063 | [SMOKE CC] Haircut | Hair & Beard Cut | serv | Smoke | Keep deleted |
| 1064 | [SMOKE CC] Product | منتجات اونكس | pro | Smoke product | Keep deleted |
| 1065–1066 | [SMOKE 1O] Cut 12/13 | (none) | serv | Smoke | Keep deleted |
| 1067–1072 | [SMOKE 1SR] Haircut/Product pairs | mixed | serv/pro | Smoke | Keep deleted |
| 1075–1076 | [TEST] 1U Product 27/28 | (none) | pro | Test products | Keep deleted |

## Classification of deleted set

| Class | Approx. count |
|-------|--------------:|
| Smoke/test | 11 |
| Internal/admin ledger | 1 |
| Legitimate retired / duplicate | 2–3 |
| Accidental deletes needing restore | **0 confirmed** |

## Public API

Soft-deleted rows never appear in `GET /api/public/booking/services`. Restore via admin remains available but **does not bypass** eligibility (duration/price/product/test rules).

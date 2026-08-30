# Salon Concierge Brain V1.1

## Principle
Help like a premium receptionist. **Never invent salon facts.** Voice is style only.

Authority: LIVE ERP > curated owner knowledge > reviewed imported > model (salon claims forbidden).

Production SoT: `TblSalon*` via SQL repository. Fixtures are **test-only**.

## Flag
`SALON_CONCIERGE_BRAIN_V1=true|false` (default OFF)

Hooks into V4 `processKernelTurn`. Never mutates booking plans.

## Admin
`/admin/ai-concierge`

APIs: `GET /api/admin/salon-concierge`, `POST .../mutate`, `POST .../preview`, `POST/PATCH .../knowledge`

Preview does not mutate conversations or knowledge gaps.

## Migrations
1. `db/migrations/create-tbl-salon-concierge.sql`
2. `db/migrations/add-tbl-salon-concierge-v11.sql`

Additive, idempotent. Do not apply without approval.

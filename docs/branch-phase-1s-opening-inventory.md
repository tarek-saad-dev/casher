# Phase 1S — Opening inventory

## Options

| Code | Meaning | Clears blocker? |
|---|---|---|
| ZERO_STOCK | Explicit zero approval | Yes after approve |
| NEW_PURCHASE | Record choice; movements required | Not until movements exist |
| TRANSFER_FROM_GLEEM | 1J dual movement | Not until transfer complete |

## API / UI

- `GET/POST /api/admin/branches/[id]/setup/opening-inventory`
- `/admin/branches/[id]/setup/opening-inventory` (executable)

Lib: `selectOpeningInventoryOption` / `isOpeningInventoryResolved`

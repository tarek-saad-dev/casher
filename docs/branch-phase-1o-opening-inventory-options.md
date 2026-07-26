# Phase 1O — Opening Inventory Options

**Module:** `openingInventoryDecision`  
**Status:** Options UI **A/B/C** delivered · decision still **BLOCKER** (`biz.opening_inventory`)

## Options (no stock invented)

| Option | Label | Movements | Clears blocker |
|---|---|---|---|
| A `ZERO_STOCK` | Start with zero stock | None | Only after explicit `approveZeroStock=true` |
| B `NEW_PURCHASE` | Enter newly purchased opening stock | Yes (qty, unit cost, supplier, date) | After real movements — not auto |
| C `TRANSFER_FROM_GLEEM` | Transfer from GLEEM (1J controlled) | Yes (GLEEM out + CC in, same ref) | After transfer history — never silent qty copy |

## Still OPEN

| Decision | Status |
|---|---|
| Opening inventory option (A/B/C) | **OPEN** |
| Quantities / unit costs | **OPEN** |
| Approval / movements | Not recorded on live CC apply |

Phase 1O must not invent opening inventory quantities or costs.

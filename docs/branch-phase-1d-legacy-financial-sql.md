# Phase 1D — Legacy Financial SQL

| Object | Classification | Phase 1D action |
|---|---|---|
| `InsCashMoveSales` | Active production trigger | Rewritten: multi-row + Branch/Day inherit |
| `sp_Loyalty_EarnPointsFromSale` | Active post-sale | Unchanged (loyalty global) |
| `trg_TblinvServDetail_WhatsAppNotification` | Disabled | None |
| Owner/partner report SQL in app | Report-only | Deferred; comment markers |
| Historical SSMS scripts under `sql/` | Legacy / not runtime | Do not treat as live; live OBJECT_DEFINITION is source of truth |
| Views on financial tables | None critical found in live audit for ops | Re-check if added later |

Active operational procedures that write financial rows live in the Next.js API layer (not legacy SPs), and were updated in this phase.

# Phase 1R — Flow Board Integration

`GET /api/operations/flow-board` filters barbers with `listResolvedOperationalEmpIdsForBranch`.

After transfer:

- Source board drops employee (not in resolved set).
- Destination board includes employee with `isEmergencyTransfer`.

Refresh via existing `onApplied` / flow-board fetch — day-state version bumped by `invalidateTemporaryTransferCaches`.
